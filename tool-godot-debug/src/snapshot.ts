/**
 * The stop snapshot renderer: bounded, model-facing projection of the raw
 * `stack_dump` + `stack_frame_var` payloads. Display rules follow the source
 * plugin's variables manager (toFixed(5) floats, quoted strings,
 * `(len) [preview]` arrays, `Dictionary(n)` maps) with the v1 simplification
 * that typed values render as `type_name + stringify_value` — no lazy object
 * fetch (plan D5); only the top-level var list is available per stop.
 * @module @deepseek-ai/dsh-tool-godot-debug/snapshot
 */

import type { DecodedVariant } from './variant-decoder.ts'
import { GDObject, ObjectId, RID, StringName, formatNumber } from './variants.ts'

/** One stack frame after rendering. */
export interface SnapshotFrame {
  file: string
  line: number
  func: string
}

/** One variable after rendering (name + display value). */
export interface RenderVar {
  name: string
  value: string
}

/** The three variable scopes the protocol reports. */
export interface RenderScopes {
  locals: RenderVar[]
  members: RenderVar[]
  globals: RenderVar[]
}

/** Bounds applied while rendering one stop. */
export interface RenderOptions {
  /** Max container nesting depth; deeper containers render as a truncation marker. */
  maxDepth: number
  /** Max variables kept per scope; the rest are dropped and flagged. */
  maxVarsPerScope: number
  /** Max characters of one rendered value; longer values get an ellipsis. */
  maxValueLength: number
}

/** The rendered projection of one stop. */
export interface StopSnapshot {
  frames: SnapshotFrame[]
  scopes: RenderScopes
  /** Which scopes lost variables to `maxVarsPerScope`. */
  scopeTruncated: { locals: boolean; members: boolean; globals: boolean }
}

const MAX_PREVIEW_ITEMS = 10

/**
 * Strip `Members/` / `Constants/` prefixes the game adds to member names.
 * @param name - the raw variable name.
 * @returns the display name.
 */
export function displayName(name: string): string {
  if (name.startsWith('Members/')) return name.slice('Members/'.length)
  if (name.startsWith('Constants/')) return name.slice('Constants/'.length)
  return name
}

/**
 * Render the dump + vars payloads of one stop into a bounded snapshot.
 * @param dump - the `stack_dump` params: `[N, file, line, func, ...]`.
 * @param vars - the `stack_frame_var` params arrays: `[name, scope, type, value, className?]`.
 * @param options - the render bounds.
 * @returns the snapshot.
 */
export function renderSnapshot(
  dump: DecodedVariant[],
  vars: DecodedVariant[][],
  options: RenderOptions,
): StopSnapshot {
  const frames: SnapshotFrame[] = []
  for (let i = 1; i + 2 < dump.length; i += 3) {
    const file = dump[i]
    const line = dump[i + 1]
    const func = dump[i + 2]
    frames.push({
      file: typeof file === 'string' ? file : '',
      line: typeof line === 'number' ? line : 0,
      func: typeof func === 'string' ? func : '',
    })
  }

  const scopes: RenderScopes = { locals: [], members: [], globals: [] }
  const truncated = { locals: false, members: false, globals: false }
  for (const entry of vars) {
    if (typeof entry[0] !== 'string' || typeof entry[1] !== 'number') continue
    const scope = [scopes.locals, scopes.members, scopes.globals][entry[1]]
    if (scope === undefined) continue
    if (scope.length >= options.maxVarsPerScope) {
      if (entry[1] === 0) truncated.locals = true
      else if (entry[1] === 1) truncated.members = true
      else truncated.globals = true
      continue
    }
    scope.push({ name: displayName(entry[0]), value: renderValue(entry[3], 0, options) })
  }

  return { frames, scopes, scopeTruncated: truncated }
}

/**
 * Render one value with the source plugin's display rules and the bounds.
 * Phase 13 (T13.0 facts 1/3): StringNames render `&'x'` (2.7.0 form); array
 * preview items render their ACTUAL values — math types as bare
 * stringify_value (`(11, 12)`, matching the source plugin's preview),
 * StringNames as `&'x'`, ObjectIds resolved through `resolveRepr` when known.
 * Top-level/row values keep the `type_name + stringify_value` form
 * (`Vector2(10, 20)`).
 * @param value - the decoded protocol value.
 * @param depth - current container nesting depth.
 * @param options - the render bounds.
 * @param resolveRepr - optional resolver turning an ObjectId into its target
 *  object's `__repr__` display name (expansion rows only; scope-level values
 *  have no fetch budget and keep `Object<id>`).
 * @returns the display text.
 */
export function renderValue(
  value: unknown,
  depth: number,
  options: RenderOptions,
  resolveRepr?: (id: bigint) => string | undefined,
): string {
  if (depth > options.maxDepth) return '…'
  let rendered = ''
  if (typeof value === 'number') {
    // Phase 9: significant digits (7) instead of the old toFixed(5).
    rendered = formatNumber(value)
  } else if (typeof value === 'bigint' || typeof value === 'boolean') {
    rendered = String(value)
  } else if (typeof value === 'string') {
    rendered = `'${value}'`
  } else if (value === null || value === undefined) {
    rendered = 'null'
  } else if (Array.isArray(value)) {
    const preview = value
      .slice(0, MAX_PREVIEW_ITEMS)
      .map(item => renderPreview(item, depth + 1, options, resolveRepr))
      .join(', ')
    const ellipsis = value.length > MAX_PREVIEW_ITEMS ? ', …' : ''
    rendered = `(${value.length}) [${preview}${ellipsis}]`
  } else if (value instanceof Map) {
    rendered = `Dictionary(${value.size})`
  } else if (value instanceof StringName) {
    rendered = `&'${value.value}'`
  } else if (value instanceof ObjectId) {
    // Object references (T13.0 facts 1/2): the target's `__repr__` display
    // name when the expansion resolved it, else the id form. RIDs keep the
    // GDObject rendering (`RID<id>`) — no inspect exists for them.
    const repr = value instanceof RID ? undefined : resolveRepr?.(value.id)
    rendered = repr !== undefined ? repr : `${value.type_name()}<${value.id}>`
  } else if (typeof (value as GDObject).type_name === 'function') {
    const obj = value as GDObject
    try {
      rendered = `${obj.type_name()}${obj.stringify_value()}`
    } catch {
      rendered = '<unrenderable value>'
    }
  } else if (typeof value === 'symbol') {
    rendered = value.toString()
  } else if (typeof value === 'object') {
    rendered = '<opaque value>'
  } else if (typeof value === 'function') {
    rendered = '<function>'
  } else {
    // oxlint-disable-next-line typescript/no-base-to-string -- primitive-only remainder; TS cannot prove it for `unknown`
    rendered = String(value)
  }
  if (rendered.length > options.maxValueLength) {
    return `${rendered.slice(0, options.maxValueLength)}…`
  }
  return rendered
}

/**
 * Render one ARRAY PREVIEW item (source-plugin parity, T13.0 fact 3): math
 * types as bare `stringify_value()` — no type prefix (`(11, 12)`, not
 * `Vector2i(11, 12)`); StringNames `&'x'`; ObjectIds resolve through repr
 * when known; primitives use the top-level rules. Nested arrays/maps keep
 * the full {@link renderValue} rules (the source plugin's preview is
 * shallow; our recursion is bounded by `maxDepth`).
 * @param value - the array item.
 * @param depth - the current nesting depth.
 * @param options - the render bounds.
 * @param resolveRepr - the expansion repr resolver (may be undefined).
 * @returns the item's display text.
 */
function renderPreview(value: unknown, depth: number, options: RenderOptions, resolveRepr?: (id: bigint) => string | undefined): string {
  if (depth > options.maxDepth) return '…'
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'bigint' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return `'${value}'`
  if (value === null || value === undefined) return 'null'
  if (value instanceof StringName) return `&'${value.value}'`
  if (value instanceof ObjectId) {
    if (!(value instanceof RID)) {
      const repr = resolveRepr?.(value.id)
      if (repr !== undefined) return repr
    }
    return `${value.type_name()}<${value.id}>`
  }
  if (Array.isArray(value)) return renderValue(value, depth, options, resolveRepr)
  if (value instanceof Map) return `Dictionary(${value.size})`
  if (typeof (value as GDObject).type_name === 'function') {
    try {
      return (value as GDObject).stringify_value()
    } catch {
      return '<unrenderable value>'
    }
  }
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'object') return '<opaque value>'
  if (typeof value === 'function') return '<function>'
  // oxlint-disable-next-line typescript/no-base-to-string -- primitive-only remainder
  return String(value)
}
