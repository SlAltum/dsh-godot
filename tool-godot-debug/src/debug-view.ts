/**
 * The structured card view of one debug run (T20): a JSON-safe, byte-bounded
 * projection of the normalized run result that rides the tool's
 * `presentationMeta` so the client card can render per-stop sections, frame
 * lists, scope lines, scene trees, and the expansion tree instead of one text
 * blob. The input contract is the EXECUTE-NORMALIZED value (what
 * `presentationMeta` actually receives): null carriers are absent fields,
 * bigint ids are already strings, and every value is lossless-JSON — this
 * module never sees bigints (H4, adversarial review).
 *
 * Size parity with the text report: scope lines (`varsLines`) render only on
 * the FIRST frame-bearing stop, exactly like `renderDebugOutput`'s full-detail
 * stop; the byte budget cuts `varsLines` first, then scene-tree lines, and
 * flags `viewTruncated` (H2).
 * @module @deepseek-ai/dsh-tool-godot-debug/debug-view
 */

import type { GodotRuntimeError } from './controller.ts'
import type { EditResult } from './edit.ts'
import type { ExpandedEntry } from './inspect.ts'
import type { RenderScopes } from './snapshot.ts'
import type { DebugStop } from './tool.ts'

/** Serialized-view byte budget; the first cut is the scope lines (H2). */
export const VIEW_MAX_BYTES = 256 * 1024

/** Output tail kept in the view (parity with the text report). */
const OUTPUT_TAIL_MAX = 20

/** Error lines kept in the view (parity with the text report). */
const ERRORS_MAX = 5

/** The normalized run result, exactly as `presentationMeta` receives it:
 *  `stops` keep their full rendered snapshots; `exit`/`expansion`/`edits`/
 *  `sceneTrees` are optional carriers with nulls already removed; bigint ids
 *  are strings. A `type` (not an interface) so it satisfies JsonValue's index
 *  signature when the meta rides `presentationMeta`. */
export type StructuredDebugInput = {
  stops: DebugStop[]
  output: string[]
  errors: GodotRuntimeError[]
  detached: boolean
  exit?: { exitCode?: number; signal?: string }
  expansion?: { stopIndex: number; expandedObjects: number; entries: ExpandedEntry[] }
  edits?: { stopIndex: number; results: EditResult[] }
  sceneTrees?: { stopIndex: number; lines: string[] }[]
  expandedObjects: number
  expansionTruncated: boolean
  editsApplied: number
  editsTruncated: boolean
  sceneTreeCount: number
  sceneTreeTruncated: boolean
  outputTruncated: boolean
  varsTruncated: boolean
}

/** One stop's structured card slice. A `type` for JsonValue assignability. */
export type DebugViewStop = {
  index: number
  reason: string
  isUserBreakpoint: boolean
  /** The paused thread id (1 = main, T10.0). */
  threadId: number
  frames: { file: string; line: number; func: string }[]
  /** Rendered scope lines (locals/members/globals), present ONLY on the first
   *  frame-bearing stop (size parity with the text report); may be `[]` when
   *  the stop had no variables. */
  varsLines?: string[]
  scopeTruncated?: { locals: boolean; members: boolean; globals: boolean }
  /** This stop's scene-tree lines when it had a frame and trees were taken. */
  sceneTree?: { lines: string[] }
}

/** One expanded object in the view: the inspect module's `ExpandedEntry`
 *  shape re-declared as a `type` so the view satisfies JsonValue (an
 *  interface has no implicit index signature). */
export type DebugExpandedEntry = {
  name: string
  id: string
  className: string
  repr?: string
  rows: { name: string; value: string }[]
  children?: DebugExpandedEntry[]
}

/** One edit outcome in the view: `EditResult` re-declared as a `type` for
 *  JsonValue assignability (`type` is widened to `string`; the runtime value
 *  is already JSON). */
export type DebugEditResult = {
  target: string
  property: string
  requested: number | string | boolean
  type: string
  ok: boolean
  detail?: string
}

/** The JSON-safe, byte-bounded structured card view (T20). A `type` for
 *  JsonValue assignability. */
export type DebugView = {
  version: 1
  stopCount: number
  maxStops: number
  detached: boolean
  stops: DebugViewStop[]
  expansion?: { stopIndex: number; expandedObjects: number; truncated: boolean; entries: DebugExpandedEntry[] }
  edits?: { stopIndex: number; truncated: boolean; results: DebugEditResult[] }
  exit?: { exitCode?: number; signal?: string }
  outputTail: string[]
  /** Rendered error lines (`file:line [warning] message`), bounded. */
  errors: string[]
  expandedObjects: number
  expansionTruncated: boolean
  editsApplied: number
  editsTruncated: boolean
  sceneTreeCount: number
  sceneTreeTruncated: boolean
  outputTruncated: boolean
  varsTruncated: boolean
  /** Set when the byte budget cut parts of the view (scope lines first, then
   *  scene-tree lines). */
  viewTruncated: boolean
}

/** Render one stop's three scopes as lines (format parity with the text
 *  report: `  <scope>:` + `    <name> = <value>`). */
function renderScopeLines(scopes: RenderScopes): string[] {
  const lines: string[] = []
  for (const [scopeName, vars] of [
    ['locals', scopes.locals],
    ['members', scopes.members],
    ['globals', scopes.globals],
  ] as const) {
    if (vars.length === 0) continue
    lines.push(`  ${scopeName}:`)
    for (const v of vars) lines.push(`    ${v.name} = ${v.value}`)
  }
  return lines
}

/** Drop the scope lines from every stop (the largest view part). */
function withoutVarsLines(view: DebugView): DebugView {
  return {
    ...view,
    stops: view.stops.map((stop) => {
      if (stop.varsLines === undefined && stop.scopeTruncated === undefined) return stop
      const { varsLines: _varsLines, scopeTruncated: _scopeTruncated, ...rest } = stop
      return rest
    }),
  }
}

/** Drop the scene-tree lines from every stop (second cut). */
function withoutSceneTreeLines(view: DebugView): DebugView {
  return {
    ...view,
    stops: view.stops.map((stop) => {
      if (stop.sceneTree === undefined) return stop
      const { sceneTree: _sceneTree, ...rest } = stop
      return rest
    }),
  }
}

/**
 * Build the structured card view of one normalized debug run.
 * @param value - the execute-normalized run result (lossless JSON already;
 *   null carriers absent, bigint ids as strings).
 * @param maxStops - the run's EFFECTIVE stop cap (`min(args.maxStops ?? 10,
 *   MAX_STOPS)`, aligned with execute).
 * @returns the JSON-safe, byte-bounded view.
 */
export function structuredDebugView(value: StructuredDebugInput, maxStops: number): DebugView {
  // Full-detail stop: the first stop that has a frame; an attach `break`
  // pause reports an empty engine stack, so the detail goes to the first real
  // stop, exactly like renderDebugOutput (parity).
  const firstFrameIdx = value.stops.findIndex(stop => stop.snapshot.frames.length > 0)
  const fullIdx = firstFrameIdx === -1 ? 0 : firstFrameIdx

  const stops: DebugViewStop[] = value.stops.map((stop, i) => {
    const viewStop: DebugViewStop = {
      index: i,
      reason: stop.reason,
      isUserBreakpoint: stop.isUserBreakpoint,
      threadId: stop.threadId,
      frames: stop.snapshot.frames.map(f => ({ file: f.file, line: f.line, func: f.func })),
    }
    if (i === fullIdx) {
      viewStop.varsLines = renderScopeLines(stop.snapshot.scopes)
      viewStop.scopeTruncated = stop.snapshot.scopeTruncated
    }
    const tree = value.sceneTrees?.find(t => t.stopIndex === i)
    if (tree !== undefined) viewStop.sceneTree = { lines: tree.lines }
    return viewStop
  })

  const view: DebugView = {
    version: 1,
    stopCount: value.stops.length,
    maxStops,
    detached: value.detached,
    stops,
    ...(value.expansion !== undefined
      ? {
        expansion: {
          stopIndex: value.expansion.stopIndex,
          expandedObjects: value.expansion.expandedObjects,
          truncated: value.expansionTruncated,
          entries: value.expansion.entries,
        },
      }
      : {}),
    ...(value.edits !== undefined
      ? { edits: { stopIndex: value.edits.stopIndex, truncated: value.editsTruncated, results: value.edits.results } }
      : {}),
    ...(value.exit !== undefined ? { exit: value.exit } : {}),
    outputTail: value.output.slice(0, OUTPUT_TAIL_MAX),
    errors: value.errors.slice(0, ERRORS_MAX)
      .map(err => `${err.file}:${err.line} ${err.warning ? 'warning' : 'error'}: ${err.error}`),
    expandedObjects: value.expandedObjects,
    expansionTruncated: value.expansionTruncated,
    editsApplied: value.editsApplied,
    editsTruncated: value.editsTruncated,
    sceneTreeCount: value.sceneTreeCount,
    sceneTreeTruncated: value.sceneTreeTruncated,
    outputTruncated: value.outputTruncated,
    varsTruncated: value.varsTruncated,
    viewTruncated: false,
  }

  // Byte budget (H2): cut the largest parts first, keep the flag honest.
  if (JSON.stringify(view).length > VIEW_MAX_BYTES) {
    const cutVars = withoutVarsLines(view)
    if (JSON.stringify(cutVars).length > VIEW_MAX_BYTES) {
      view.stops = withoutSceneTreeLines(cutVars).stops
    } else {
      view.stops = cutVars.stops
    }
    view.viewTruncated = true
  }
  return view
}
