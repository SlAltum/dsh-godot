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
import { ObjectId, RID } from './variants.ts'
import type { DecodedVariant } from './variant-decoder.ts'

/** One expanded object: the source variable name, its id, the class name
 *  from the response, and the rendered property rows. */
export interface ExpandedEntry {
  name: string
  id: string
  className: string
  rows: { name: string; value: string }[]
}

/** The expansion outcome for one stop. */
export interface ExpansionResult {
  /** The expanded objects, in request order. */
  entries: ExpandedEntry[]
  /** Successful expansions (entries.length). */
  expandedObjects: number
  /** Any object skipped, property truncated, selection sliced, or budget spent. */
  expansionTruncated: boolean
}

/** The expansion bounds, assembled by the tool layer from config and budget. */
export interface ExpandOptions {
  /** Max objects expanded on the first frame-bearing stop (0 = disabled). */
  maxObjects: number
  /** Max property rows kept per object. */
  maxProps: number
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
 * Parse one `scene:inspect_object` response's property list into render rows.
 * Pinned T5.0 facts: tuples are `[name, typeCode, hint, hintString, usage,
 * value]`; `usage === 128` marks a category grouping element (skipped; the
 * following properties already carry their group prefix); `Members/` and
 * `Constants/` prefixes are stripped (source-plugin rule), other prefixes
 * (`Node/`) are kept as display names.
 * @param props - the response's props array.
 * @param maxProps - the row cap.
 * @param options - the render bounds.
 * @returns the rows and whether any tuple/row was dropped.
 */
export function parseInspectProps(
  props: DecodedVariant[],
  maxProps: number,
  options: RenderOptions,
): { rows: { name: string; value: string }[]; truncated: boolean } {
  const rows: { name: string; value: string }[] = []
  let truncated = false
  for (const prop of props) {
    if (!Array.isArray(prop) || prop.length < 6 || typeof prop[0] !== 'string') {
      truncated = true // malformed tuple (defensive; T5.0 fact 9 saw none)
      continue
    }
    if (prop[4] === 128) continue // category grouping element, not a variable
    let name: string = prop[0]
    if (name.startsWith('Members/')) name = name.slice('Members/'.length)
    else if (name.startsWith('Constants/')) name = name.slice('Constants/'.length)
    if (rows.length >= maxProps) {
      truncated = true
      continue
    }
    rows.push({ name, value: renderValue(prop[5], 0, options) })
  }
  return { rows, truncated }
}

/**
 * Run the serial, budgeted expansion for one stop's raw vars. Runs only while
 * the game is paused (pinned: a running game answers with silence). Failure
 * taxonomy (plan D4): per-object timeout/malformed = skip + flag; disconnect
 * (GODOT_UNAVAILABLE) = propagate (the run loop ends and returns the partial
 * result); cancellation = propagate (GODOT_ABORTED).
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
  const entries: ExpandedEntry[] = []
  let expansionTruncated = false
  const start = Date.now()
  for (const { name, id } of selected) {
    const remaining = options.budgetMs - (Date.now() - start)
    if (remaining <= 0) {
      expansionTruncated = true // budget spent: skip the rest, keep partial result
      break
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
      const { rows, truncated } = parseInspectProps(props, options.maxProps, options.render)
      if (truncated) expansionTruncated = true
      entries.push({ name, id: id.toString(), className, rows })
    } catch (error) {
      if (error instanceof GodotError && error.code === 'GODOT_ABORTED') throw error
      if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE') throw error // disconnected
      expansionTruncated = true // timeout or malformed: skip this object
    }
  }
  return { entries, expandedObjects: entries.length, expansionTruncated }
}
