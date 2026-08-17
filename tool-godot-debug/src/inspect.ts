/**
 * The bounded variable expansion: after the first stop that has a frame, the
 * tool serially requests `scene:inspect_object` for the stop's top-level
 * `ObjectId` values and renders their property tuples into the report. This
 * replaces the source plugin's interactive VariablesManager/GodotObjectPromise
 * machinery with a one-shot, budgeted variant (plan D1/D5). Protocol facts
 * pinned in `.context/t5/facts.md`: responses carry the requested id as an
 * INT64 (compare with the requested UINT64 bigint; negative values are
 * unsigned-normalized), property tuples are `[name, typeCode, hint,
 * hintString, usage, value]` with `usage === 128` category markers, RID
 * inspect returns an empty response, and a running (non-paused) game answers
 * with silence — hence expansion only runs while paused, object-level
 * failures skip with `expansionTruncated`, and a disconnect ends the run.
 * @module @deepseek-ai/dsh-tool-godot-debug/inspect
 */

import type { DebugController } from './controller.ts'
import { GodotError } from './error.ts'
import { renderValue, type RenderOptions } from './snapshot.ts'
import { ObjectId, RID, RawObject, StringName } from './variants.ts'
import type { DecodedVariant } from './variant-decoder.ts'

/** One expanded object: the source variable name, its id, the class name
 *  from the response, the rendered property rows, and the object's
 *  `__repr__` display name when it declares one (T13.0 fact 1; raw value —
 *  references to this object render it instead of `Object<id>`). Nested
 *  object values (direct properties, array elements, dictionary values) that
 *  were expanded recursively appear as `children` (Phase 8); `children` is
 *  absent when the object has no expanded nested objects. */
export interface ExpandedEntry {
  name: string
  id: string
  className: string
  repr?: string
  rows: { name: string; value: string }[]
  children?: ExpandedEntry[]
}

/** The expansion outcome for one stop. */
export interface ExpansionResult {
  /** The expanded objects, in request order (children nested within). */
  entries: ExpandedEntry[]
  /** Successful object expansions this run (top level + nested). */
  expandedObjects: number
  /** Any object skipped, property truncated, selection sliced, or budget spent. */
  expansionTruncated: boolean
}

/** The expansion bounds, assembled by the tool layer from config and budget. */
export interface ExpandOptions {
  /** Max top-level objects expanded (0 = disabled). */
  maxObjects: number
  /** Max property rows kept per object. */
  maxProps: number
  /** Max expansion depth (1 = top level only, the Phase 5 behavior; 2 =
   *  nested objects in properties are expanded too; deeper stays a
   *  placeholder). */
  maxDepth: number
  /** The render bounds for property values. */
  render: RenderOptions
  /** Per-object wait budget (pinned: real responses are 12-21 ms). */
  idleTimeoutMs: number
  /** Whole-expansion budget (min of remaining run budget and the cap). */
  budgetMs: number
  /** Caller cancellation. */
  signal: AbortSignal
}

/**
 * Normalize a decoded response id to the unsigned form used for comparison.
 * Pinned T5.0 fact 1: normal payloads arrive as a non-negative INT64 already
 * equal to the requested UINT64; the +2^64 conversion is defensive.
 * @param value - the decoded id parameter (bigint or integer).
 * @returns the unsigned id, or null when not an integer.
 */
export function normalizeId(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value < 0n ? value + (1n << 64n) : value
  if (typeof value === 'number' && Number.isInteger(value)) {
    const big = BigInt(value)
    return big < 0n ? big + (1n << 64n) : big
  }
  return null
}

/**
 * Select the expandable top-level object values from one stop's raw vars.
 * `RID` values are excluded (pinned: RID inspect returns an empty response,
 * plan D9); freed objects already decode as null (no id to inspect).
 * @param vars - the raw `stack_frame_var` params arrays.
 * @param maxObjects - the selection cap (0 = none).
 * @returns the selected `{ name, id }` pairs in first-seen order, deduplicated.
 */
export function selectExpandableIds(
  vars: DecodedVariant[][],
  maxObjects: number,
): { name: string; id: bigint }[] {
  const seen = new Set<string>()
  const out: { name: string; id: bigint }[] = []
  if (maxObjects <= 0) return out
  for (const entry of vars) {
    const value = entry[3]
    if (!(value instanceof ObjectId) || value instanceof RID) continue
    const key = value.id.toString()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: typeof entry[0] === 'string' ? entry[0] : '', id: value.id })
    if (out.length >= maxObjects) break
  }
  return out
}

/**
 * Resolve one raw property name to its display name (T13.0 fact 7, aligned
 * with the source plugin's category handling): a category marker
 * (usage === 128) NAMES the group of the following bare props (the marker
 * itself is not a variable); while a category is active its name prefixes
 * every following prop (`Node/process_mode`, `Node/script`, `RefCounted/
 * script`); without a category, `Members/`/`Constants/` prefixes are stripped
 * (T5.0 fact 2) and other baked prefixes (`Node/path`) are kept.
 * @param rawName - the raw prop name.
 * @param usage - the prop usage flag.
 * @param category - the active category name ('' = none).
 * @returns the display name ('' for a category marker) and the next category.
 */
export function propDisplayName(rawName: string, usage: number, category: string): { name: string; category: string } {
  if (usage === 128) return { name: '', category: rawName }
  if (category !== '') return { name: `${category}/${rawName}`, category }
  if (rawName.startsWith('Members/')) return { name: rawName.slice('Members/'.length), category }
  if (rawName.startsWith('Constants/')) return { name: rawName.slice('Constants/'.length), category }
  return { name: rawName, category }
}

/**
 * The display text of a dictionary KEY inside a location path (T16, aligned
 * with the source plugin's get_sub_values rendering): StringName keys render
 * the reference `&'x'` form, ObjectId keys their id (repr key names depend on
 * expansion timing — recorded, revisited with T15), everything else verbatim.
 * The path doubles as an edit target: `findMapEntry` accepts the `&'x'` form
 * back (edit round-trip stays closed).
 * @param key - the decoded key.
 * @returns the key text used inside `dict["..."]`.
 */
export function keyDisplay(key: unknown): string {
  if (key instanceof StringName) return `&'${key.value}'`
  if (key instanceof ObjectId) return String(key.id)
  if (typeof key === 'string') return key
  return String(key)
}

/**
 * Parse one `scene:inspect_object` response's property list into render rows.
 * Pinned facts: tuples are `[name, typeCode, hint, hintString, usage, value]`;
 * `usage === 128` marks a category marker that names the group of the
 * following bare props (T5.0 fact 8 / T13.0 fact 7); `Members/`/`Constants/`
 * prefixes are stripped (source-plugin rule), other prefixes (`Node/`) are
 * kept as display names.
 * @param props - the response's props array.
 * @param maxProps - the row cap.
 * @param options - the render bounds.
 * @param resolveRepr - optional resolver turning an ObjectId value into its
 *  target object's `__repr__` display name (T13.0 facts 1/2); without it
 *  (or for unknown ids) ObjectIds render as `Object<id>`.
 * @returns the rows and whether any tuple/row was dropped.
 */
export function parseInspectProps(
  props: DecodedVariant[],
  maxProps: number,
  options: RenderOptions,
  resolveRepr?: (id: bigint) => string | undefined,
): { rows: { name: string; value: string }[]; truncated: boolean } {
  const rows: { name: string; value: string }[] = []
  let truncated = false
  let category = ''
  for (const prop of props) {
    if (!Array.isArray(prop) || prop.length < 6 || typeof prop[0] !== 'string') {
      truncated = true // malformed tuple (defensive; T5.0 fact 9 saw none)
      continue
    }
    const { name, category: nextCategory } = propDisplayName(prop[0], prop[4] as number, category)
    category = nextCategory
    if (name === '') continue // category marker, not a variable
    if (rows.length >= maxProps) {
      truncated = true
      continue
    }
    rows.push({ name, value: renderValue(prop[5], 0, options, resolveRepr) })
  }
  return { rows, truncated }
}

/**
 * Collect the expandable ObjectIds inside one decoded property value, with
 * their display paths. Pinned T8.0 facts: containers decode as `Array`
 * (elements) and `Map` (values); dictionary KEYS are NOT expanded (the
 * source plugin only renders them, facts 1); RID values are excluded (their
 * inspect returns an empty response, T5.0 fact 5); the same id can appear at
 * top level AND nested (dedup is the caller's job, fact 2). Keys display via
 * {@link keyDisplay} (T13.0 fact 3 — StringName keys are not `[object Object]`).
 * @param value - the decoded property value.
 * @param basePath - the display path of the value (e.g. `player`, `arr`,
 *   `dict`), extended per element/key (`arr[0]`, `dict["k"]`).
 * @returns the nested `{ path, id }` pairs, in traversal order.
 */
export function collectNestedIds(value: unknown, basePath: string): { path: string; id: bigint }[] {
  const out: { path: string; id: bigint }[] = []
  visit(value, basePath)
  return out

  function visit(v: unknown, path: string): void {
    if (v instanceof ObjectId) {
      if (!(v instanceof RID)) out.push({ path, id: v.id })
      return
    }
    // RawObject (an inline-decoded object, extends Map) is NOT traversed: its
    // members are the object's own properties, not nested containers to
    // expand (the t8 probe walked only __type__-tagged values, matching this).
    if (v instanceof RawObject) return
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) visit(v[i], `${path}[${i}]`)
      return
    }
    if (v instanceof Map) {
      for (const [key, val] of v) visit(val, `${path}["${keyDisplay(key)}"]`)
    }
  }
}

/**
 * One fetched object in the expansion's two-phase pipeline (Phase 13): the
 * protocol phase retains the RAW property tuples; the render phase resolves
 * `__repr__` display names and renders the rows. Retaining raw props is
 * bounded by the protocol message size (`maxMessageBytes`); `maxProps`
 * truncation still applies at render time (same semantics as before).
 */
interface FetchedEntry {
  name: string
  id: bigint
  className: string
  props: DecodedVariant[]
  children: FetchedEntry[]
}

/**
 * Run the serial, budgeted expansion for one stop's raw vars. Two phases
 * (Phase 13, T13.0 facts 1/2): FETCH first — send `scene:inspect_object`
 * serially for every selected/nested id (budget, dedup, skip and
 * disconnect/cancel semantics identical to Phase 8), retaining raw props —
 * then RENDER — index each object's `__repr__` member and render rows with
 * references to expanded objects resolved to their repr display name
 * (`Object<id>` fallback; the source plugin resolves these lazily via its
 * VariablesManager — the one-shot tool resolves only what it expanded, a
 * documented divergence). Runs only while the game is paused (pinned: a
 * running game answers with silence). Failure taxonomy (plan D4/D5):
 * per-object timeout/malformed = skip + flag; disconnect
 * (GODOT_UNAVAILABLE) = propagate; cancellation = propagate (GODOT_ABORTED).
 * @param vars - the stop's raw vars.
 * @param controller - the protocol controller (send + waitForMessage).
 * @param options - the expansion bounds and budget.
 * @returns the expansion result.
 */
export async function expandObjects(
  vars: DecodedVariant[][],
  controller: DebugController,
  options: ExpandOptions,
): Promise<ExpansionResult> {
  const selected = selectExpandableIds(vars, options.maxObjects)
  if (selected.length === 0) {
    return { entries: [], expandedObjects: 0, expansionTruncated: false }
  }
  const roots: FetchedEntry[] = []
  let expandedObjects = 0
  let expansionTruncated = false
  const expandedIds = new Set<string>()
  const start = Date.now()

  /** Fetch one object (recursively per maxDepth); returns null on skip. */
  async function fetchOne(id: bigint, name: string, depth: number): Promise<FetchedEntry | null> {
    const remaining = options.budgetMs - (Date.now() - start)
    if (remaining <= 0) {
      expansionTruncated = true // budget spent: skip, keep partial result
      return null
    }
    const waitMs = Math.min(options.idleTimeoutMs, remaining)
    try {
      controller.send('scene:inspect_object', [id])
      const resp = await controller.waitForMessage(
        m => m[0] === 'scene:inspect_object' && normalizeId(Array.isArray(m[2]) ? m[2][0] : null) === id,
        waitMs,
        options.signal,
        'scene:inspect_object',
      )
      const params = resp[2]
      const className = Array.isArray(params) && typeof params[1] === 'string' ? params[1] : ''
      const props = Array.isArray(params) && Array.isArray(params[2]) ? params[2] : []
      expandedObjects++
      const children: FetchedEntry[] = []
      if (depth < options.maxDepth) {
        // Recurse into nested ObjectIds found in the property values; the
        // display name follows the category rules (T13.0 fact 7).
        let category = ''
        for (const prop of props) {
          if (!Array.isArray(prop) || prop.length < 6 || typeof prop[0] !== 'string') continue
          const { name: propName, category: nextCategory } = propDisplayName(prop[0], prop[4] as number, category)
          category = nextCategory
          if (propName === '') continue // category marker
          for (const nested of collectNestedIds(prop[5], propName)) {
            const key = nested.id.toString()
            if (expandedIds.has(key)) continue // cross-level dedup (T8.0 fact 2)
            expandedIds.add(key)
            const child = await fetchOne(nested.id, nested.path, depth + 1)
            if (child !== null) children.push(child)
          }
        }
      }
      return { name, id, className, props, children }
    } catch (error) {
      if (error instanceof GodotError && error.code === 'GODOT_ABORTED') throw error
      if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE') throw error // disconnected
      expansionTruncated = true // timeout or malformed: skip this object
      return null
    }
  }

  // Top-level selection wins: pre-reserve every selected id so the nested
  // recursion skips them (T8.0 fact 2 — a top-level object that also appears
  // inside a property is expanded once, at top level).
  for (const { id } of selected) expandedIds.add(id.toString())

  for (const { name, id } of selected) {
    const fetched = await fetchOne(id, name, 1)
    if (fetched !== null) roots.push(fetched)
  }

  // Render phase: build the repr index from every fetched object's props
  // (T13.0 fact 1: the member arrives as `Members/__repr__`, display name
  // after category rules is `__repr__`; fact 2: string values render raw).
  const reprById = new Map<string, string>()
  const resolveRepr = (id: bigint): string | undefined => reprById.get(id.toString())
  const indexReprs = (entries: FetchedEntry[]): void => {
    for (const entry of entries) {
      let category = ''
      for (const prop of entry.props) {
        if (!Array.isArray(prop) || prop.length < 6 || typeof prop[0] !== 'string') continue
        const { name: propName, category: nextCategory } = propDisplayName(prop[0], prop[4] as number, category)
        category = nextCategory
        if (propName === '__repr__' && !reprById.has(entry.id.toString())) {
          const value = prop[5]
          reprById.set(entry.id.toString(), typeof value === 'string' ? value : renderValue(value, 0, options.render, resolveRepr))
        }
      }
      indexReprs(entry.children)
    }
  }
  indexReprs(roots)

  const renderEntry = (fetched: FetchedEntry): ExpandedEntry => {
    const { rows, truncated } = parseInspectProps(fetched.props, options.maxProps, options.render, resolveRepr)
    if (truncated) expansionTruncated = true
    const repr = reprById.get(fetched.id.toString())
    const children = fetched.children.map(renderEntry)
    return {
      name: fetched.name,
      id: fetched.id.toString(),
      className: fetched.className,
      ...(repr !== undefined ? { repr } : {}),
      rows,
      ...(children.length > 0 ? { children } : {}),
    }
  }
  return { entries: roots.map(renderEntry), expandedObjects, expansionTruncated }
}
