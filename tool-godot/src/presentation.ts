/**
 * Result-time card presentation for `godot_validate` and `godot_format`.
 * The canonical value never crosses the wire — only the model-facing render
 * text and the JSON `meta` do — so the structured shape a UI renders MUST
 * ride in `meta`. This module owns the value→`presentationMeta` projections
 * each tool declares and the defensive `meta`→view narrowings each tool's
 * `presentResult` reads back on replay. All functions are pure: no I/O, no
 * clock, no session state.
 *
 * @module @deepseek-ai/dsh-tool-godot/presentation
 */

import type { DiffResultView, GenericResultView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { GodotIssue, ValidateResult } from './validate.ts'
import type { FormatResult } from './format.ts'

/** Per-message cap applied when projecting validate meta (bounded JSON meta). */
const MESSAGE_CAP_BYTES = 4096

/** Per-side cap applied when projecting format diff meta. */
const FORMAT_META_MAX_BYTES = 65_536

/**
 * Bound a UTF-8 string to `maxBytes` without splitting a multi-byte
 * character, and mark the cut.
 *
 * @param text - the input text.
 * @param maxBytes - the byte budget.
 * @returns the bounded text and whether bytes were cut.
 */
export function capUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  let bytes = 0
  let cut = 0
  for (const ch of text) {
    const len = Buffer.byteLength(ch, 'utf8')
    if (bytes + len > maxBytes) break
    bytes += len
    cut += ch.length
  }
  return { text: text.slice(0, cut), truncated: true }
}

/**
 * The `godot_validate` tool/result `meta` payload: the retained issues and the
 * outcome flags. Object-literal type alias (not an interface) so the value is
 * assignable to the `JsonValue` index signature `presentationMeta` returns.
 */
export type ValidateMeta = {
  ok: boolean
  issuesTruncated: boolean
  issues: GodotIssue[]
}

/**
 * Project the canonical `godot_validate` result to its replayable meta. The
 * issue count is already capped by the tool's inline cap
 * (`validateMaxErrors`); each message is bounded to {@link MESSAGE_CAP_BYTES}
 * so the serialized meta stays bounded.
 *
 * @param value - the canonical result.
 * @returns the meta payload.
 */
export function validateMeta(value: ValidateResult): ValidateMeta {
  return {
    ok: value.ok,
    issuesTruncated: value.issuesTruncated,
    issues: value.issues.map(issue => ({ ...issue, message: capUtf8(issue.message, MESSAGE_CAP_BYTES).text })),
  }
}

/** One issue in the JSON-assignable validate meta. */
type MetaIssue = { kind: string; message: string; path?: string; line?: number; column?: number }

/** The JSON-assignable shape of {@link ValidateMeta} (object-literal aliases). */
type ValidateMetaJson = { ok: boolean; issuesTruncated: boolean; issues: MetaIssue[] }

/**
 * Narrow a replayed `presentationMeta` back to a validate card. Defensive:
 * malformed or absent metadata (an obsolete or hand-edited replayed log)
 * yields `undefined` so the UI falls back to the generic card.
 *
 * @param meta - the opaque replayed metadata.
 * @returns the generic result view, or `undefined` for the fallback.
 */
export function validateViewFromMeta(meta: JsonValue | undefined): GenericResultView | undefined {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const value = meta as ValidateMetaJson
  if (typeof value.ok !== 'boolean' || typeof value.issuesTruncated !== 'boolean' || !Array.isArray(value.issues)) return undefined
  // Replayed metadata is unvalidated JSON; narrow through unknown[] so the
  // runtime guards stay necessary (and lint-clean).
  const issues = (value.issues as unknown[]).filter((issue): issue is MetaIssue => {
    if (typeof issue !== 'object' || issue === null) return false
    const record = issue as Record<string, unknown>
    return typeof record.kind === 'string' && typeof record.message === 'string'
  })
  const title = `Godot validation ${value.ok ? 'passed' : 'failed'}`
  if (issues.length === 0) {
    return { card: 'generic', title, content: [{ type: 'text', text: 'No issues reported.' }] }
  }
  const body = issues
    .map((issue) => {
      const where = [issue.path, issue.line, issue.column].filter(part => part !== undefined).join(':')
      return `${where} [${issue.kind}] ${issue.message}`
    })
    .join('\n')
  const note = value.issuesTruncated ? `\n(showing the first ${issues.length} issues)` : ''
  return { card: 'generic', title, content: [{ type: 'text', text: `${body}${note}` }] }
}

/**
 * The `godot_format` tool/result `meta` payload: the before/after text for the
 * diff card. Object-literal type alias (not an interface) so the value is
 * assignable to the `JsonValue` index signature `presentationMeta` returns.
 */
export type FormatMeta = {
  path: string
  oldText: string
  newText: string
}

/**
 * Project the canonical `godot_format` result to its replayable meta. Both
 * text sides are bounded to {@link FORMAT_META_MAX_BYTES} so a very large
 * file cannot balloon the persisted meta; a truncated diff is a documented
 * v1 limitation (the model-facing result still carries the full text).
 *
 * @param value - the canonical result.
 * @returns the meta payload.
 */
export function formatMeta(value: FormatResult): FormatMeta {
  return {
    path: value.file,
    oldText: capUtf8(value.original, FORMAT_META_MAX_BYTES).text,
    newText: capUtf8(value.formatted, FORMAT_META_MAX_BYTES).text,
  }
}

/**
 * Narrow a replayed `presentationMeta` back to a format diff card. Defensive:
 * malformed or absent metadata yields `undefined` so the UI falls back to the
 * generic card.
 *
 * @param meta - the opaque replayed metadata.
 * @returns the diff result view, or `undefined` for the fallback.
 */
export function formatViewFromMeta(meta: JsonValue | undefined): DiffResultView | undefined {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const value = meta as FormatMeta
  if (typeof value.path !== 'string' || typeof value.oldText !== 'string' || typeof value.newText !== 'string') return undefined
  return { card: 'diff', title: `Format ${value.path}`, diffs: [{ path: value.path, oldText: value.oldText, newText: value.newText }] }
}
