/**
 * The bounded variable editing: while paused at the first frame-bearing stop,
 * the tool applies model-specified `scene:set_object_property` edits and
 * verifies each one by re-inspecting the target object. Since Phase 12 the
 * `property` parameter accepts a NESTED PATH (`arr[0]`, `dict["k"]`,
 * `arr[0].x`, `arr[0][1]`), not just a plain property name:
 *
 * - A path ending in a plain property edits that property on the resolved
 *   object (top-level object, or any nested object reached through container
 *   members) — the Phase 6 flow against the resolved id.
 * - A path ending in a container member (index/key) rebuilds the WHOLE
 *   outermost container with the change applied and writes it back to the
 *   owning object's property (the source plugin's `changes_parent` semantics,
 *   `.context/t14/facts.md` items 1/2). Containers holding non-rebuildable
 *   values (object references, NodePath/Callable/Signal) fail explicitly —
 *   the engine silently rejects such writes (fact 7), so the gate is not
 *   optional.
 *
 * The engine sends NO acknowledgement for set (pinned T6.0 fact 1) and
 * failures are silent (fact 5), so verification is the only judgment:
 * re-inspect, walk to the value, compare with the parsed request value.
 * Pinned facts: bare and `Members/`-prefixed labels both work (fact 2); int
 * properties truncate float values while UNTYPED container members do not
 * (facts 4/9); StringName-typed properties echo as StringName (fact 3); a
 * typed container rejects the whole write on a wrong-typed element (fact 5);
 * typed/packed containers accept plain-array rebuilds with convertible
 * elements (fact 5).
 * @module @deepseek-ai/dsh-tool-godot-debug/edit
 */

import type { DebugController } from './controller.ts'
import { GodotError } from './error.ts'
import {
  ObjectId, RID, RawObject, StringName, Vector2, Vector2i, Vector3, Vector3i,
  Vector4, Vector4i, Rect2, Rect2i, Basis, AABB, Transform3D, Transform2D,
  Plane, Quat, Projection, Color,
} from './variants.ts'
import type { DecodedVariant } from './variant-decoder.ts'

/** The value types the tool can write. */
export type EditValueType = 'int' | 'float' | 'string' | 'bool'

/** One requested edit: a variable/object target, a property path, and a value. */
export interface EditRequest {
  /** The top-level variable name to edit (locals/members/globals, e.g. `self`, `player`). */
  target: string
  /** The property name or a nested path: `health`, `arr[0]`, `dict["k"]`,
   *  `arr[0].x`, `arr[0][1]` — container members are written by rebuilding
   *  the whole outermost container (changes_parent semantics). */
  property: string
  /** The raw string value to parse per {@link type}. */
  value: string
  /** How to parse `value`; `'string'` when omitted. */
  type?: EditValueType
}

/** One edit's outcome: success or a model-readable failure detail. */
export interface EditResult {
  target: string
  property: string
  /** The parsed value sent (JSON-assignable: number | string | boolean). */
  requested: number | string | boolean
  type: EditValueType
  ok: boolean
  /** Why the edit failed, when `ok` is false (e.g. `value unchanged`, `property not found`). */
  detail?: string
}

/** The edit bounds, assembled by the tool layer from config and budget. */
export interface EditOptions {
  /** Max edits applied (0 = disabled; handled by the tool layer). */
  maxEdits: number
  /** Per-edit verify budget (pinned: real round-trips are 12-21 ms, T6.0 fact 7). */
  idleTimeoutMs: number
  /** Whole-edits budget (min of remaining run budget and the cap). */
  budgetMs: number
  /** Caller cancellation. */
  signal: AbortSignal
}

/** One segment of an edit path (`arr[0].x` = prop, index, prop). */
export type EditPathSegment =
  | { kind: 'prop'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'key'; key: string }

/** The resolution of one edit path against the stop's variables. */
export type ResolvedEdit =
  /** A plain property on the resolved object (the Phase 6 flow). */
  | { kind: 'property'; id: bigint; name: string }
  /** A container member: rebuild `container` with `memberPath` applied and
   *  write it back to `ownerId`'s property `label` (changes_parent). */
  | { kind: 'member'; ownerId: bigint; label: string; container: unknown[] | Map<unknown, unknown>; memberPath: EditPathSegment[] }

/**
 * Parse an edit path: a leading property name (bare or `Members/`-prefixed,
 * matching the Phase 6 spelling), then any sequence of `[index]`, `["key"]`
 * (with `\"` / `\\` escapes) and `.property` segments.
 * @param property - the raw `property` parameter.
 * @returns the segments, or null when the path does not parse.
 */
export function parseEditPath(property: string): EditPathSegment[] | null {
  const full = /^[A-Za-z_][A-Za-z0-9_/]*(?:(?:\[\d+\])|(?:\["(?:[^"\\]|\\.)*"\])|(?:\.[A-Za-z_][A-Za-z0-9_]*))*$/.exec(property)
  if (full === null) return null
  const segments: EditPathSegment[] = []
  const first = /^[A-Za-z_][A-Za-z0-9_/]*/.exec(property)
  if (first === null) return null
  segments.push({ kind: 'prop', name: first[0] })
  const tail = /\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]|\.[A-Za-z_][A-Za-z0-9_]*/g
  const rest = property.slice(first[0].length)
  let m: RegExpExecArray | null
  while ((m = tail.exec(rest)) !== null) {
    if (m[1] !== undefined) {
      segments.push({ kind: 'index', index: Number(m[1]) })
    } else if (m[2] !== undefined) {
      segments.push({ kind: 'key', key: m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\') })
    } else {
      const name = m[0].slice(1) // strip the leading dot
      segments.push({ kind: 'prop', name })
    }
  }
  return segments
}

/**
 * Parse a raw string into the typed value sent to the engine. Rules match the
 * engine's own coercion for TYPED properties (T6.0 fact 4): `int` truncates
 * like the engine does (`12.5` → 12), `float` accepts finite decimals, `bool`
 * accepts `true`/`false`/`0`/`1` (source-plugin forms), `string` passes
 * through. Untyped container members apply NO coercion (T14.0 fact 4) — the
 * parse rules are the model-facing contract; the verify catches the
 * difference.
 * @param type - the declared value type (`'string'` when omitted).
 * @param raw - the raw string input.
 * @returns the parsed value, or null when unparseable.
 */
export function parseEditValue(type: EditValueType | undefined, raw: string): number | string | boolean | null {
  switch (type ?? 'string') {
    case 'int': {
      if (raw.trim() === '') return null // empty input is not 0
      const n = Number(raw)
      return Number.isFinite(n) ? Math.trunc(n) : null
    }
    case 'float': {
      if (raw.trim() === '') return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    case 'bool': {
      if (raw === 'true' || raw === '1') return true
      if (raw === 'false' || raw === '0') return false
      return null
    }
    case 'string':
      return raw
  }
}

/**
 * Find the target object's id in one stop's raw vars. Only `ObjectId` values
 * are editable (pinned T6.0 fact 10: scalar variables carry no object id and
 * the engine has no mechanism for them); `RID` values are excluded (inspect
 * returns an empty response for them, T5.0 fact 5).
 * @param vars - the raw `stack_frame_var` params arrays.
 * @param target - the top-level variable name to edit.
 * @returns the object id, or null when missing or not an object.
 */
export function findEditTarget(vars: DecodedVariant[][], target: string): bigint | null {
  // stack_frame_var names are bare (`self`, `player`); a caller-supplied
  // `Members/` prefix is tolerated by stripping it on both sides.
  const bareTarget = target.replace(/^(Members|Constants)\//, '')
  for (const entry of vars) {
    if (typeof entry[0] !== 'string') continue
    if (entry[0].replace(/^(Members|Constants)\//, '') === bareTarget) {
      const value = entry[3]
      if (value instanceof ObjectId && !(value instanceof RID)) return value.id
    }
  }
  return null
}

/**
 * Whether the decoded verify value equals the parsed request value. The
 * engine already coerced/truncated the written value, so a plain equality is
 * the right base — the int parse above truncates identically (T6.0 fact 4).
 * Numbers compare with a relative tolerance because float values are encoded
 * as float32 on the wire: a request of `0.1` comes back as
 * `0.10000000149011612` and strict equality would misreport a successful
 * write (T6.0 fact 3 measured exact float32 round-trips for 2.5; the
 * tolerance covers non-binary-exact values). StringName-typed properties echo
 * as StringName (T14.0 fact 3) — compare against the plain string.
 * @param actual - the decoded property value from the re-inspect response.
 * @param requested - the parsed request value.
 * @returns true when equal (within tolerance for numbers).
 */
export function valueEquals(actual: unknown, requested: number | string | boolean): boolean {
  if (typeof requested === 'number') {
    return typeof actual === 'number' && Math.abs(actual - requested) <= Math.max(1, Math.abs(requested)) * 1e-6
  }
  if (typeof requested === 'string' && actual instanceof StringName) return actual.value === requested
  return actual === requested
}

/**
 * Find the property row (name + decoded value) whose name matches `property`.
 * Matching order: exact raw name first (a baked prefix like `Node/path` is a
 * real property name), then `Members/`/`Constants/`-prefix-insensitive
 * (T6.0 facts 2/4 — the engine echoes prefixed names), then a
 * category-tracked display prefix stripped from the REQUEST side
 * (T13.0 fact 7: the expansion displays `Node/process_mode` for the raw
 * `process_mode` row). The verbatim row name is what the rebuild write must
 * use as the label.
 * @param props - the re-inspect response's props array.
 * @param property - the requested property name (display or raw form).
 * @returns the row tuple, or `undefined` when the property is absent.
 */
export function findPropRow(props: DecodedVariant[] | undefined, property: string): DecodedVariant[] | undefined {
  if (!Array.isArray(props)) return undefined
  const bare = property.replace(/^(Members|Constants)\//, '')
  const stripped = property.replace(/^[^/]+\//, '')
  for (const prop of props) {
    if (!Array.isArray(prop) || typeof prop[0] !== 'string') continue
    if (prop[0] === property) return prop
    if (prop[0].replace(/^(Members|Constants)\//, '') === bare) return prop
    if (prop[0] === stripped) return prop
  }
  return undefined
}

/**
 * Find a dictionary entry by its display key: exact match, plain string,
 * StringName value, or numeric key stringified (`dict["5"]` addresses a
 * numeric key 5 — T14.2 path semantics).
 * @param map - the decoded dictionary.
 * @param key - the requested key from the path.
 * @returns the entry (actual key + value), or undefined.
 */
export function findMapEntry(map: Map<unknown, unknown>, key: string): { key: unknown; value: unknown } | undefined {
  for (const [k, v] of map) {
    if (k === key) return { key: k, value: v }
    if (typeof k === 'string' && k === key) return { key: k, value: v }
    if (k instanceof StringName && k.value === key) return { key: k, value: v }
    if (typeof k === 'number' && String(k) === key) return { key: k, value: v }
  }
  return undefined
}

/** Walk a member path inside a container to the final value (verification). */
function getPathValue(container: unknown[] | Map<unknown, unknown>, memberPath: EditPathSegment[]): unknown {
  let cur: unknown = container
  for (const seg of memberPath) {
    if (seg.kind === 'index') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[seg.index]
      continue
    }
    if (seg.kind !== 'key') continue
    if (!(cur instanceof Map)) return undefined
    const entry = findMapEntry(cur, seg.key)
    if (entry === undefined) return undefined
    cur = entry.value
  }
  return cur
}

/**
 * Why a decoded value cannot be re-encoded into a container rebuild, or null
 * when it can. The engine SILENTLY rejects whole-container writes carrying
 * object references (T14.0 fact 7), so ObjectId/RawObject/NodePath/Callable/
 * Signal members must fail the edit up front with a readable detail. Math
 * types and packed arrays (which decode as plain arrays, fact 5) are
 * rebuildable.
 * @param value - the decoded value to re-encode.
 * @returns a failure reason, or null when rebuildable.
 */
export function rebuildReason(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean' || typeof value === 'string') return null
  if (value instanceof StringName) return null
  if (Array.isArray(value)) {
    for (const element of value) {
      const reason = rebuildReason(element)
      if (reason !== null) return reason
    }
    return null
  }
  if (value instanceof Map && !(value instanceof RawObject)) {
    for (const [k, v] of value) {
      const reason = rebuildReason(k) ?? rebuildReason(v)
      if (reason !== null) return reason
    }
    return null
  }
  // Math types (Vector2/3/4, Rect2, Basis, AABB, Transform2D/3D, Plane, Quat,
  // Projection, Color) are encodable — anything else (object references,
  // NodePath/Callable/Signal) is not.
  if (isEncodableMath(value)) return null
  if (value instanceof ObjectId || value instanceof RawObject) return 'object references'
  return 'non-rebuildable values (NodePath/Callable/Signal)'
}

/** Whether the value is one of the math types the encoder can write (T14.2). */
function isEncodableMath(value: unknown): boolean {
  return value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4
    || value instanceof Rect2 || value instanceof Basis || value instanceof AABB
    || value instanceof Transform3D || value instanceof Transform2D || value instanceof Plane
    || value instanceof Quat || value instanceof Projection || value instanceof Color
    || value instanceof Vector2i || value instanceof Vector3i || value instanceof Vector4i
    || value instanceof Rect2i
}

/**
 * Clone a container (arrays/maps cloned; other values shared — the rebuild
 * only replaces one member, so sharing is safe) and apply `memberPath` with
 * `value` at the final position. The original decoded container is never
 * mutated.
 * @param container - the outermost container to rebuild.
 * @param memberPath - the member segments from the container down.
 * @param value - the new member value.
 * @returns the rebuilt container.
 */
export function rebuildContainer(
  container: unknown[] | Map<unknown, unknown>,
  memberPath: EditPathSegment[],
  value: unknown,
): unknown[] | Map<unknown, unknown> {
  const clone = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clone)
    if (v instanceof Map && !(v instanceof RawObject)) {
      const out = new Map<unknown, unknown>()
      for (const [k, val] of v) out.set(clone(k), clone(val))
      return out
    }
    return v
  }
  const rebuilt = clone(container) as unknown[] | Map<unknown, unknown>
  let cur: unknown = rebuilt
  for (const seg of memberPath.slice(0, memberPath.length - 1)) {
    if (seg.kind === 'index') {
      if (!Array.isArray(cur)) throw new Error('rebuildContainer: index into non-array')
      cur = cur[seg.index]
      continue
    }
    if (seg.kind !== 'key') continue
    if (!(cur instanceof Map)) throw new Error('rebuildContainer: key into non-map')
    const entry = findMapEntry(cur, seg.key)
    if (entry === undefined) throw new Error(`rebuildContainer: key "${seg.key}" missing`)
    cur = entry.value
  }
  const last = memberPath[memberPath.length - 1]
  if (last === undefined) return rebuilt
  if (last.kind === 'index') {
    if (!Array.isArray(cur)) throw new Error('rebuildContainer: index into non-array')
    cur[last.index] = value
    return rebuilt
  }
  if (last.kind === 'key') {
    if (!(cur instanceof Map)) throw new Error('rebuildContainer: key into non-map')
    const entry = findMapEntry(cur, last.key)
    if (entry === undefined) throw new Error(`rebuildContainer: key "${last.key}" missing`)
    cur.set(entry.key, value)
  }
  return rebuilt
}

/**
 * Resolve one edit path against the stop's variables with LIVE inspects: the
 * target object's id comes from the stack vars; each `.property` segment
 * inspects the current object; `[index]`/`["key"]` segments descend into
 * decoded containers. Budget: one bounded inspect per object segment.
 * @param vars - the stop's raw vars.
 * @param target - the top-level variable name.
 * @param segments - the parsed path.
 * @param controller - the protocol controller.
 * @param waitMs - per-inspect wait budget.
 * @param signal - caller cancellation.
 * @returns the resolved edit, or an `{ error }` failure description.
 */
async function resolveEditPath(
  vars: DecodedVariant[][],
  target: string,
  segments: EditPathSegment[],
  controller: DebugController,
  waitMs: number,
  signal: AbortSignal,
): Promise<ResolvedEdit | { error: string }> {
  const targetId = findEditTarget(vars, target)
  if (targetId === null) return { error: `variable "${target}" is not an editable object in this stop` }

  const first = segments[0]
  if (first === undefined || first.kind !== 'prop') return { error: 'path must start with a property name' }

  /** Inspect one object; null on timeout/malformed (GODOT_ABORTED/UNAVAILABLE propagate). */
  const inspectObject = async (id: bigint): Promise<DecodedVariant[] | null> => {
    controller.send('scene:inspect_object', [id])
    try {
      const resp = await controller.waitForMessage(
        m => m[0] === 'scene:inspect_object' && normalizeVerifyId(Array.isArray(m[2]) ? m[2][0] : null) === id,
        waitMs,
        signal,
        'scene:inspect_object path',
      )
      const params = resp[2]
      return Array.isArray(params) && Array.isArray(params[2]) ? params[2] : []
    } catch (error) {
      if (error instanceof GodotError && (error.code === 'GODOT_ABORTED' || error.code === 'GODOT_UNAVAILABLE')) throw error
      return null
    }
  }

  /** Descend from an object into a `.property` segment. */
  const stepProp = async (id: bigint, name: string): Promise<{ id: bigint; value: unknown; label: string } | { error: string }> => {
    const props = await inspectObject(id)
    if (props === null) return { error: 'target inspect timed out' }
    const row = findPropRow(props, name)
    if (row === undefined) return { error: `property "${name}" not found` }
    return { id, value: row[5], label: typeof row[0] === 'string' ? row[0] : name }
  }

  let currentId = targetId
  let currentValue: unknown
  let container: unknown[] | Map<unknown, unknown> | null = null // the outermost container on the current object
  let containerLabel: string | null = null
  let lastPropLabel = first.name
  const memberPath: EditPathSegment[] = []

  // A single-segment path is a plain Phase 6 property edit on the target
  // object: no pre-inspect needed (the target id comes from the stack vars),
  // keeping the Phase 6 request shape unchanged (one set + one verify).
  // EXCEPT a category-tracked display prefix (T13.0 fact 5): the engine
  // SILENTLY rejects `Node/...` labels, so the RAW property name must be
  // resolved by a live inspect first. Bare and `Members/`/`Constants/`-
  // prefixed names are sent verbatim (T6.0 facts 2/4 — the pinned shape).
  if (segments.length === 1) {
    if (/^[^/]+\//.test(first.name) && !/^(Members|Constants)\//.test(first.name)) {
      const props = await inspectObject(currentId)
      if (props === null) return { error: 'target inspect timed out' }
      const row = findPropRow(props, first.name)
      if (row === undefined) return { error: `property "${first.name}" not found` }
      return { kind: 'property', id: currentId, name: typeof row[0] === 'string' ? row[0] : first.name }
    }
    return { kind: 'property', id: currentId, name: first.name }
  }

  // First segment: a property on the target object.
  const stepped = await stepProp(currentId, first.name)
  if ('error' in stepped) return stepped
  currentValue = stepped.value
  lastPropLabel = stepped.label

  for (const [offset, seg] of segments.slice(1).entries()) {
    const i = offset + 1
    if (seg.kind === 'prop') {
      // At an object: the current value must be an ObjectId.
      if (!(currentValue instanceof ObjectId) || currentValue instanceof RID) {
        return { error: `cannot descend into "${describeValue(currentValue)}": not an object` }
      }
      currentId = currentValue.id
      container = null
      const next = await stepProp(currentId, seg.name)
      if ('error' in next) return next
      currentValue = next.value
      lastPropLabel = next.label
      if (i === segments.length - 1) return { kind: 'property', id: currentId, name: seg.name }
      continue
    }
    // index/key: inside a container.
    if (container === null) {
      if (!Array.isArray(currentValue) && !(currentValue instanceof Map)) {
        return { error: `cannot index into "${describeValue(currentValue)}": not a container` }
      }
      container = currentValue
      containerLabel = lastPropLabel
      memberPath.length = 0
    }
    const path = [...memberPath, seg]
    const member = getPathValue(container, path)
    if (member === undefined) {
      const detail = seg.kind === 'index' ? `index ${seg.index} out of range` : `key "${seg.key}" not found`
      return { error: detail }
    }    memberPath.push(seg)
    if (i === segments.length - 1) {
      if (containerLabel === null) return { error: 'internal: container label missing' }
      return { kind: 'member', ownerId: currentId, label: containerLabel, container, memberPath: [...memberPath] }
    }
    if (member instanceof ObjectId && !(member instanceof RID)) {
      currentId = member.id
      currentValue = member
      container = null
    } else if (Array.isArray(member) || member instanceof Map) {
      // Stay inside the same outermost container; the path keeps growing.
      currentValue = member
    } else {
      return { error: `cannot descend into "${describeValue(member)}": not an object or container` }
    }
  }
  return { error: 'internal: path walk did not resolve' }
}

/** A short model-readable description of a decoded value (error details). */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (value instanceof ObjectId) return 'object reference'
  if (typeof value === 'string') return `"${value.slice(0, 20)}"`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `array (length ${value.length})`
  if (value instanceof Map) return `dictionary (size ${value.size})`
  return typeof value
}

/**
 * Apply the edits serially: for each request, resolve the target object and
 * path (live inspects), then either write the property (Phase 6 flow) or
 * rebuild the whole container and write it back (Phase 12 member edits), and
 * verify by re-inspecting. Runs only while paused (the tool layer gates it).
 * Failure taxonomy (plan D5): per-edit parse/target/timeout/mismatch = record
 * the failure + flag truncation; disconnect (GODOT_UNAVAILABLE) = propagate
 * (the run loop ends and returns the partial result); cancellation =
 * propagate (GODOT_ABORTED).
 * @param edits - the requested edits.
 * @param vars - the stop's raw vars (target resolution).
 * @param controller - the protocol controller (send + waitForMessage).
 * @param options - the edit bounds and budget.
 * @returns the per-edit results and whether anything was truncated/failed.
 */
export async function applyEdits(
  edits: EditRequest[],
  vars: DecodedVariant[][],
  controller: DebugController,
  options: EditOptions,
): Promise<{ results: EditResult[]; truncated: boolean }> {
  const results: EditResult[] = []
  let truncated = false
  if (options.maxEdits <= 0) return { results, truncated }
  const selected = edits.slice(0, options.maxEdits)
  if (selected.length < edits.length) truncated = true
  const start = Date.now()
  for (const edit of selected) {
    const remaining = options.budgetMs - (Date.now() - start)
    if (remaining <= 0) {
      truncated = true // budget spent: skip the rest, keep partial results
      break
    }
    const type = edit.type ?? 'string'
    const parsed = parseEditValue(type, edit.value)
    if (parsed === null) {
      truncated = true
      results.push({ target: edit.target, property: edit.property, requested: edit.value, type, ok: false, detail: `cannot parse "${edit.value}" as ${type}` })
      continue
    }
    const segments = parseEditPath(edit.property)
    if (segments === null) {
      truncated = true
      results.push({
        target: edit.target,
        property: edit.property,
        requested: parsed,
        type,
        ok: false,
        detail: `cannot parse property path "${edit.property}": use a property name or a path like arr[0] / dict["k"] / arr[0].x`,
      })
      continue
    }
    const waitMs = Math.min(options.idleTimeoutMs, remaining)
    let resolved: ResolvedEdit | { error: string }
    try {
      resolved = await resolveEditPath(vars, edit.target, segments, controller, waitMs, options.signal)
    } catch (error) {
      if (error instanceof GodotError && (error.code === 'GODOT_ABORTED' || error.code === 'GODOT_UNAVAILABLE')) throw error
      truncated = true
      results.push({ target: edit.target, property: edit.property, requested: parsed, type, ok: false, detail: 'path resolution timed out' })
      continue
    }
    if ('error' in resolved) {
      truncated = true
      results.push({ target: edit.target, property: edit.property, requested: parsed, type, ok: false, detail: resolved.error })
      continue
    }
    try {
      if (resolved.kind === 'property') {
        await applyPropertyEdit(resolved, edit, parsed, type, controller, waitMs, options.signal, results, (t) => { truncated = t })
      } else {
        const reason = rebuildReason(resolved.container)
        if (reason !== null) {
          truncated = true
          results.push({
            target: edit.target,
            property: edit.property,
            requested: parsed,
            type,
            ok: false,
            detail: `container "${resolved.label}" contains ${reason} — member edits rebuild the whole container and the engine rejects such writes`,
          })
          continue
        }
        const rebuilt = rebuildContainer(resolved.container, resolved.memberPath, parsed)
        await applyMemberEdit(resolved, rebuilt, edit, parsed, type, controller, waitMs, options.signal, results, (t) => { truncated = t })
      }
    } catch (error) {
      if (error instanceof GodotError && (error.code === 'GODOT_ABORTED' || error.code === 'GODOT_UNAVAILABLE')) throw error
      truncated = true // timeout or malformed: skip this edit
      results.push({ target: edit.target, property: edit.property, requested: parsed, type, ok: false, detail: 'verify timed out' })
    }
  }
  return { results, truncated }
}

/** The Phase 6 flow against a resolved object id: set + re-inspect + compare. */
async function applyPropertyEdit(
  resolved: { id: bigint; name: string },
  edit: EditRequest,
  parsed: number | string | boolean,
  type: EditValueType,
  controller: DebugController,
  waitMs: number,
  signal: AbortSignal,
  results: EditResult[],
  setTruncated: (value: boolean) => void,
): Promise<void> {
  controller.send('scene:set_object_property', [resolved.id, resolved.name, parsed])
  // Verify by re-inspecting the object (no ack exists, T6.0 fact 1): the
  // engine answers nothing for set, so we must actively re-request.
  controller.send('scene:inspect_object', [resolved.id])
  const resp = await controller.waitForMessage(
    m => m[0] === 'scene:inspect_object' && normalizeVerifyId(Array.isArray(m[2]) ? m[2][0] : null) === resolved.id,
    waitMs,
    signal,
    'scene:inspect_object verify',
  )
  const params = resp[2]
  const props = Array.isArray(params) && Array.isArray(params[2]) ? params[2] : []
  const actual = findPropValue(props, resolved.name)
  if (actual === undefined || !valueEquals(actual, parsed)) {
    setTruncated(true)
    results.push({
      target: edit.target,
      property: edit.property,
      requested: parsed,
      type,
      ok: false,
      detail: actual === undefined
        ? `property "${resolved.name}" not found after edit (did the engine accept it?)`
        : 'value unchanged (engine rejected or coerced the write)',
    })
    return
  }
  results.push({ target: edit.target, property: edit.property, requested: parsed, type, ok: true })
}

/** The Phase 12 member flow: whole-container write + path walk verification. */
async function applyMemberEdit(
  resolved: { ownerId: bigint; label: string; container: unknown[] | Map<unknown, unknown>; memberPath: EditPathSegment[] },
  rebuilt: unknown[] | Map<unknown, unknown>,
  edit: EditRequest,
  parsed: number | string | boolean,
  type: EditValueType,
  controller: DebugController,
  waitMs: number,
  signal: AbortSignal,
  results: EditResult[],
  setTruncated: (value: boolean) => void,
): Promise<void> {
  controller.send('scene:set_object_property', [resolved.ownerId, resolved.label, rebuilt])
  controller.send('scene:inspect_object', [resolved.ownerId])
  const resp = await controller.waitForMessage(
    m => m[0] === 'scene:inspect_object' && normalizeVerifyId(Array.isArray(m[2]) ? m[2][0] : null) === resolved.ownerId,
    waitMs,
    signal,
    'scene:inspect_object verify',
  )
  const params = resp[2]
  const props = Array.isArray(params) && Array.isArray(params[2]) ? params[2] : []
  const row = findPropRow(props, resolved.label)
  const actual = row === undefined ? undefined : getPathValue(row[5] as unknown[] | Map<unknown, unknown>, resolved.memberPath)
  if (actual === undefined || !valueEquals(actual, parsed)) {
    setTruncated(true)
    results.push({
      target: edit.target,
      property: edit.property,
      requested: parsed,
      type,
      ok: false,
      detail: actual === undefined
        ? 'member not found after edit (did the engine accept the whole-container write?)'
        : 'value unchanged (engine rejected or coerced the write)',
    })
    return
  }
  results.push({ target: edit.target, property: edit.property, requested: parsed, type, ok: true })
}

/**
 * Find the property row whose name matches `property` (bare or prefixed) and
 * return its decoded value. Kept for the Phase 6 verify path.
 * @param props - the re-inspect response's props array.
 * @param property - the requested property name.
 * @returns the decoded value, or `undefined` when the property is absent.
 */
export function findPropValue(props: DecodedVariant[] | undefined, property: string): unknown {
  const row = findPropRow(props, property)
  return row === undefined ? undefined : row[5]
}

/**
 * Normalize a decoded response id to the unsigned form used for comparison
 * (same rule as inspect.ts — the re-inspect response carries the object id,
 * T5.0 fact 1).
 * @param value - the decoded id parameter (bigint or integer).
 * @returns the unsigned id, or null when not an integer.
 */
function normalizeVerifyId(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value < 0n ? value + (1n << 64n) : value
  if (typeof value === 'number' && Number.isInteger(value)) {
    const big = BigInt(value)
    return big < 0n ? big + (1n << 64n) : big
  }
  return null
}
