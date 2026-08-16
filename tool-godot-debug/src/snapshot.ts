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
import { GDObject, StringName } from './variants.ts'

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
 * @param value - the decoded protocol value.
 * @param depth - current container nesting depth.
 * @param options - the render bounds.
 * @returns the display text.
 */
export function renderValue(value: unknown, depth: number, options: RenderOptions): string {
  if (depth > options.maxDepth) return '…'
  let rendered = ''
  if (typeof value === 'number') {
    rendered = Number.isInteger(value) ? String(value) : String(Number.parseFloat(value.toFixed(5)))
  } else if (typeof value === 'bigint' || typeof value === 'boolean') {
    rendered = String(value)
  } else if (typeof value === 'string') {
    rendered = `'${value}'`
  } else if (value === null || value === undefined) {
    rendered = 'null'
  } else if (Array.isArray(value)) {
    const preview = value
      .slice(0, MAX_PREVIEW_ITEMS)
      .map(item => renderValue(item, depth + 1, options))
      .join(', ')
    const ellipsis = value.length > MAX_PREVIEW_ITEMS ? ', …' : ''
    rendered = `(${value.length}) [${preview}${ellipsis}]`
  } else if (value instanceof Map) {
    rendered = `Dictionary(${value.size})`
  } else if (value instanceof StringName) {
    rendered = `StringName'${value.value}'`
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
