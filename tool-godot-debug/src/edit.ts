/**
 * The bounded variable editing: while paused at the first frame-bearing stop,
 * the tool applies model-specified `scene:set_object_property` edits to the
 * stop's top-level object variables and verifies each one by re-inspecting
 * the target object. The engine sends NO acknowledgement for set (pinned
 * T6.0 fact 1) and failures are silent (fact 5), so verification is the only
 * judgment: re-inspect, find the property, compare the decoded value with the
 * parsed request value (facts 2/4: bare and `Members/`-prefixed labels both
 * work; int properties truncate float values, string properties reject int
 * values — the parse rules below match the engine).
 * @module @deepseek-ai/dsh-tool-godot-debug/edit
 */

import type { DebugController } from './controller.ts'
import { GodotError } from './error.ts'
import { ObjectId, RID } from './variants.ts'
import type { DecodedVariant } from './variant-decoder.ts'

/** The value types the tool can write. */
export type EditValueType = 'int' | 'float' | 'string' | 'bool'

/** One requested edit: a top-level object variable, a property, and a value. */
export interface EditRequest {
  /** The top-level variable name to edit (locals/members/globals, e.g. `self`, `player`). */
  target: string
  /** The property name on that object (bare or `Members/`-prefixed; both work, T6.0 fact 2). */
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

/**
 * Parse a raw string into the typed value sent to the engine. Rules match the
 * engine's own coercion (T6.0 fact 4): `int` truncates like the engine does
 * (`12.5` → 12), `float` accepts finite decimals, `bool` accepts
 * `true`/`false`/`0`/`1` (source-plugin forms), `string` passes through.
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
 * tolerance covers non-binary-exact values).
 * @param actual - the decoded property value from the re-inspect response.
 * @param requested - the parsed request value.
 * @returns true when equal (within tolerance for numbers).
 */
export function valueEquals(actual: unknown, requested: number | string | boolean): boolean {
  if (typeof requested === 'number') {
    return typeof actual === 'number' && Math.abs(actual - requested) <= Math.max(1, Math.abs(requested)) * 1e-6
  }
  return actual === requested
}

/**
 * Find the property row whose name matches `property` (bare or prefixed; the
 * engine echoes `Members/`-prefixed names, T6.0 facts 2/4), and return its
 * decoded value.
 * @param props - the re-inspect response's props array.
 * @param property - the requested property name.
 * @returns the decoded value, or `undefined` when the property is absent.
 */
export function findPropValue(props: DecodedVariant[] | undefined, property: string): unknown {
  if (!Array.isArray(props)) return undefined
  const bare = property.replace(/^(Members|Constants)\//, '')
  for (const prop of props) {
    if (!Array.isArray(prop) || typeof prop[0] !== 'string') continue
    if (prop[0] === property || prop[0].replace(/^(Members|Constants)\//, '') === bare) return prop[5]
  }
  return undefined
}

/**
 * Apply the edits serially: for each request, resolve the target object,
 * send `scene:set_object_property`, re-inspect the object, and compare the
 * property's new value. Runs only while paused (the tool layer gates it).
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
    const id = findEditTarget(vars, edit.target)
    if (id === null) {
      truncated = true
      results.push({ target: edit.target, property: edit.property, requested: parsed, type, ok: false, detail: `variable "${edit.target}" is not an editable object in this stop` })
      continue
    }
    const waitMs = Math.min(options.idleTimeoutMs, remaining)
    try {
      controller.send('scene:set_object_property', [id, edit.property, parsed])
      // Verify by re-inspecting the object (no ack exists, T6.0 fact 1): the
      // engine answers nothing for set, so we must actively re-request.
      controller.send('scene:inspect_object', [id])
      const resp = await controller.waitForMessage(
        m => m[0] === 'scene:inspect_object' && normalizeVerifyId(Array.isArray(m[2]) ? m[2][0] : null) === id,
        waitMs,
        options.signal,
        'scene:inspect_object verify',
      )
      const params = resp[2]
      const props = Array.isArray(params) && Array.isArray(params[2]) ? params[2] : []
      const actual = findPropValue(props, edit.property)
      if (actual === undefined || !valueEquals(actual, parsed)) {
        truncated = true
        results.push({
          target: edit.target,
          property: edit.property,
          requested: parsed,
          type,
          ok: false,
          detail: actual === undefined
            ? `property "${edit.property}" not found after edit (did the engine accept it?)`
            : 'value unchanged (engine rejected or coerced the write)',
        })
        continue
      }
      results.push({ target: edit.target, property: edit.property, requested: parsed, type, ok: true })
    } catch (error) {
      if (error instanceof GodotError && error.code === 'GODOT_ABORTED') throw error
      if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE') throw error // disconnected
      truncated = true // timeout or malformed: skip this edit
      results.push({ target: edit.target, property: edit.property, requested: parsed, type, ok: false, detail: 'verify timed out' })
    }
  }
  return { results, truncated }
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
