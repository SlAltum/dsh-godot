/**
 * The model-facing Godot debug tool (`godot_debug`): one bounded, scripted
 * debug run against a Godot project — CLI breakpoints, headless launch over
 * `--remote-debug`, per-stop stack/variable snapshots, auto-continue up to
 * `maxStops`, then a structured report with the game's output and errors.
 *
 * ## Spawn-backed, one call per run
 *
 * Like the tool-godot suite, the debug tool executes through
 * `ctx.subprocess.spawn()` — never a background job — and the call returns
 * only after the run ends, is terminated by the cooperative timeout, is
 * aborted, or fails. The game connects INTO this side: the tool binds a
 * pre-picked free port, spawns `godot --headless --remote-debug
 * tcp://127.0.0.1:<port>`, and speaks Godot's binary debugger protocol
 * (variant-encoded frames; see `.context/t3/facts.md` for the pinned facts).
 *
 * @module @deepseek-ai/dsh-tool-godot-debug
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { resolve } from 'node:path'
import { Config, validateConfig } from './config.ts'
import type { GodotDebugConfig, ResolvedGodotDebugConfig } from './config.ts'
import { structuredDebugView } from './debug-view.ts'
import type { StructuredDebugInput } from './debug-view.ts'
import type { ExpandedEntry } from './inspect.ts'
import { runDebug } from './tool.ts'
import type { DebugRunResult } from './tool.ts'
import { GodotError } from './error.ts'
import type { EditRequest } from './edit.ts'
import { createDebugSessionService } from './session-service.ts'
import type { DebugSessionService } from './session-service.ts'
import type { SessionCommandRequest } from './session.ts'

/** T21: interactive-session idle timeout (constant; configurable later). */
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000

export { Config, validateConfig } from './config.ts'
export type { GodotDebugConfig, ResolvedGodotDebugConfig } from './config.ts'
export { runDebug } from './tool.ts'
export type { DebugBreakpoint, DebugRunMode, DebugRunOptions, DebugRunResult, DebugStop } from './tool.ts'
export { structuredDebugView, VIEW_MAX_BYTES } from './debug-view.ts'
export type { DebugView, DebugViewStop, StructuredDebugInput } from './debug-view.ts'
export { createDebugSessionService } from './session-service.ts'
export type { DebugSessionService } from './session-service.ts'
export { DebugSession } from './session.ts'
export type { DetachReason, SessionCommandRequest, SessionCommandResult, SessionSnapshot, SessionState } from './session.ts'
export { renderSnapshot, renderValue } from './snapshot.ts'
export type { RenderOptions, RenderScopes, RenderVar, SnapshotFrame, StopSnapshot } from './snapshot.ts'
export { formatNumber } from './variants.ts'
export { expandObjects, normalizeId, parseInspectProps, selectExpandableIds, collectNestedIds } from './inspect.ts'
export type { ExpandedEntry, ExpansionResult } from './inspect.ts'
export { applyEdits, findEditTarget, findPropValue, parseEditValue, valueEquals } from './edit.ts'
export type { EditRequest, EditResult, EditValueType } from './edit.ts'
export { parseSceneTree, renderSceneTree } from './scene-tree.ts'
export type { SceneTreeNode, SceneTreeParse, SceneTreeRenderOptions } from './scene-tree.ts'
export { GodotError } from './error.ts'
export type { GodotErrorCode } from './error.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-godot-debug'

/** Services required by the godot debug tool. */
export const inject = ['tools', 'systemPrompt', 'subprocess']

/** Cap on stops per run, also enforced by the tool schema. */
export const MAX_STOPS = 50

/** One stop's position line in the replayable card meta. */
type DebugMetaStop = { file: string; line: number; func: string; reason: string; threadId: number }

/** The JSON-assignable card meta: the stop position lines plus truncation facts. */
export type DebugMeta = {
  stopCount: number
  maxStops: number
  stops: DebugMetaStop[]
  detached: boolean
  expandedObjects: number
  expansionTruncated: boolean
  editsApplied: number
  editsTruncated: boolean
  sceneTreeCount: number
  sceneTreeTruncated: boolean
  outputTruncated: boolean
  varsTruncated: boolean
}

/**
 * Project the canonical result to its replayable card meta (bounded: positions only).
 * @param value - the canonical run result.
 * @param maxStops - the run's stop cap (for the card head).
 * @returns the JSON-assignable card meta.
 */
export function debugMeta(value: DebugRunResult, maxStops: number): DebugMeta {
  return {
    stopCount: value.stops.length,
    maxStops,
    stops: value.stops.map((stop) => {
      const frame = stop.snapshot.frames[0]
      return {
        file: frame?.file ?? '',
        line: frame?.line ?? 0,
        func: frame?.func ?? '',
        reason: stop.reason,
        threadId: stop.threadId,
      }
    }),
    detached: value.detached,
    expandedObjects: value.expandedObjects,
    expansionTruncated: value.expansionTruncated,
    editsApplied: value.editsApplied,
    editsTruncated: value.editsTruncated,
    sceneTreeCount: value.sceneTreeCount,
    sceneTreeTruncated: value.sceneTreeTruncated,
    outputTruncated: value.outputTruncated,
    varsTruncated: value.varsTruncated,
  }
}

/** Render one expanded entry and its nested children (Phase 8 recursion) at
 *  the given indentation. Children use their location path as the name
 *  (`player`, `arr[0]`, `dict["k"]` — T8.0 fact 6). The head value shows the
 *  object's `__repr__` display name when it declares one (T13.0 fact 1),
 *  else the id form `Object<id>`.
 * @param entry - the entry to render.
 * @param indent - the base indentation (spaces) for the entry line.
 * @returns the rendered lines.
 */
function renderEntry(entry: ExpandedEntry, indent: number): string[] {
  const pad = ' '.repeat(indent)
  const lines: string[] = []
  const value = entry.repr !== undefined ? entry.repr : `Object<${entry.id}>`
  lines.push(`${pad}${entry.name} = ${value} [${entry.className}]`)
  for (const row of entry.rows) lines.push(`${' '.repeat(indent + 2)}${row.name} = ${row.value}`)
  if (entry.children !== undefined) {
    for (const child of entry.children) lines.push(...renderEntry(child, indent + 2))
  }
  return lines
}

/**
 * The plain-text projection of one debug run (also the render fallback).
 * @param value - the canonical run result.
 * @param maxStops - the run's stop cap (for the head line).
 * @returns the model-facing text.
 */
export function renderDebugOutput(value: DebugRunResult, maxStops: number): string {
  const lines: string[] = []
  if (value.stops.length === 0) {
    lines.push(`no stops (max ${maxStops})`)
  } else {
    lines.push(`${value.stops.length} stops (max ${maxStops})`)
    // Full scopes render on the FIRST stop that has a frame; an attach
    // `break` pause reports an empty engine stack, so the full detail goes
    // to the first real (breakpoint/error) stop instead. Launch stops always
    // carry frames, so launch rendering is unchanged.
    const firstFrameIdx = value.stops.findIndex(stop => stop.snapshot.frames.length > 0)
    const fullIdx = firstFrameIdx === -1 ? 0 : firstFrameIdx
    for (const [i, stop] of value.stops.entries()) {
      const frame = stop.snapshot.frames[0]
      const where = frame === undefined ? '<no frame>' : `${frame.file}:${frame.line} @ ${frame.func}`
      // A `break` pause reports an empty reason with isUserBreakpoint=true
      // (pinned, T4.0); label it so the stop reads unambiguously.
      const reason = stop.reason === '' ? 'break' : stop.reason
      // Phase 10: a worker-thread pause (threadId !== 1) is marked so the
      // model can tell which thread stopped (pinned T10.0: threadId 1 = main).
      const thread = stop.threadId !== 1 ? ` @ thread ${stop.threadId}` : ''
      lines.push(`#${i} ${where} [${reason}${thread}]`)
      // Phase 7: the scene tree of this stop (present when the stop had a
      // frame and scene trees are enabled; tree index = stop index).
      const tree = value.sceneTrees?.find(t => t.stopIndex === i)
      if (tree !== undefined) {
        lines.push(`  scene tree (${tree.lines.length} nodes):`)
        for (const line of tree.lines) lines.push(`    ${line}`)
      }
      if (i === fullIdx) {
        for (const [scopeName, vars] of [
          ['locals', stop.snapshot.scopes.locals],
          ['members', stop.snapshot.scopes.members],
          ['globals', stop.snapshot.scopes.globals],
        ] as const) {
          if (vars.length === 0) continue
          lines.push(`  ${scopeName}:`)
          for (const v of vars) lines.push(`    ${v.name} = ${v.value}`)
        }
        // Phase 5: the expanded objects of this same stop (expansion runs on
        // the first frame-bearing stop, which is exactly fullIdx). Nested
        // objects (Phase 8) render recursively with deeper indentation; the
        // head counts ALL expanded objects (top level + nested children).
        if (value.expansion != null && value.expansion.entries.length > 0) {
          lines.push(`  expanded objects (${value.expansion.expandedObjects}):`)
          for (const entry of value.expansion.entries) lines.push(...renderEntry(entry, 4))
        }
        // Phase 6: the variable edits applied on this same stop, with the
        // per-edit outcome (verified against the engine through a re-inspect).
        if (value.edits != null && value.edits.results.length > 0) {
          lines.push(`  edits (${value.edits.results.length}):`)
          for (const r of value.edits.results) {
            const status = r.ok ? 'ok' : `failed: ${r.detail ?? 'unknown'}`
            const shown = typeof r.requested === 'bigint' ? r.requested.toString() : JSON.stringify(r.requested)
            lines.push(`    ${r.target}.${r.property} = ${shown} [${r.type}] ${status}`)
          }
        }
      }
    }
  }
  if (value.output.length > 0) {
    lines.push(`output (${value.output.length} lines${value.outputTruncated ? ', truncated' : ''}):`)
    for (const line of value.output.slice(0, 20)) lines.push(`  ${line}`)
  }
  if (value.errors.length > 0) {
    lines.push(`errors (${value.errors.length}):`)
    for (const err of value.errors.slice(0, 5)) {
      lines.push(`  ${err.file}:${err.line} ${err.warning ? 'warning' : 'error'}: ${err.error}`)
    }
  }
  if (value.detached) {
    lines.push('attached; game left running (not owned by the tool)')
  }
  return lines.join('\n')
}

/**
 * Narrow a replayed `presentationMeta` back to the generic card. Defensive:
 * malformed or absent metadata yields `undefined` so the UI falls back.
 * @param meta - the opaque replayed metadata.
 * @returns the generic result view, or `undefined` for the fallback.
 */
export function debugViewFromMeta(meta: JsonValue | undefined): GenericResultView | undefined {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const value = meta as DebugMeta
  if (typeof value.stopCount !== 'number' || !Array.isArray(value.stops)) return undefined
  const body = value.stops
    .map((stop) => {
      const thread = stop.threadId !== 1 ? ` @ thread ${stop.threadId}` : ''
      return `${stop.file === '' ? '<no frame>' : `${stop.file}:${stop.line} @ ${stop.func}`} [${stop.reason === '' ? 'break' : stop.reason}${thread}]`
    })
    .join('\n')
  const head = value.stopCount === 0 ? `no stops (max ${value.maxStops})` : `${value.stopCount} stops (max ${value.maxStops})`
  const notes: string[] = []
  if (value.detached) notes.push('attached; game left running')
  if (value.expandedObjects > 0) notes.push(`${value.expandedObjects} objects expanded`)
  if (value.expansionTruncated) notes.push('some objects not expanded')
  if (value.editsApplied > 0) notes.push(`${value.editsApplied} edits applied`)
  if (value.editsTruncated) notes.push('some edits failed')
  if (value.sceneTreeCount > 0) notes.push(`${value.sceneTreeCount} scene trees`)
  if (value.sceneTreeTruncated) notes.push('some scene trees truncated')
  if (value.outputTruncated) notes.push('output truncated')
  if (value.varsTruncated) notes.push('some variable snapshots incomplete')
  return {
    card: 'generic',
    title: `Godot debug ${head}`,
    content: [{ type: 'text', text: notes.length > 0 ? `${body}\n(${notes.join(', ')})` : body }],
  }
}

/**
 * The completed-call card: stop positions + truncation facts.
 * @param _args - the raw tool arguments (unused; the head derives from meta).
 * @param result - the final model-facing tool result.
 * @returns the generic card view, or `undefined` for the fallback.
 */
export function presentDebugResult(_args: { maxStops?: number }, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  return debugViewFromMeta(result.meta)
}

/**
 * Register the `godot_debug` tool. Registration is unconditional; a missing
 * godot executable surfaces as the structured `GODOT_UNAVAILABLE` error at
 * call time, never at load time.
 *
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 * @param config - deployment config; schema defaults are filled here.
 */
export function apply(ctx: Context, config: GodotDebugConfig = {}): void {
  // A row may be mounted without a config key; resolve the schema here.
  const resolved = Config(config) as ResolvedGodotDebugConfig
  validateConfig(resolved)

  ctx.effect(() => {
    const disposers = [
      ctx.systemPrompt.section({
        name: 'tool:godot-debug',
        order: 121,
        text:
          'Use godot_debug to run a Godot scene under the debugger: set breakpoints (res:// path or absolute file path plus line), '
          + 'the tool launches the project headless, snapshots the stack and locals/members/globals at each stop, and auto-continues '
          + 'up to maxStops. Returns per-stop stack frames and variable values plus the game output and errors. Object variables '
          + 'are expanded in place on the first stop (properties under "expanded objects"; nested objects inside properties are '
          + 'expanded recursively, bounded by config maxExpandDepth, with location-path names like arr[0] or dict["k"] (StringName '
          + 'dictionary keys render the &\'x\' form, for example, dict["&\'snkey\'"]); StringNames '
          + 'render as &\'x\', arrays preview their actual values like (2) [(11, 12), (21, 22)], and an object that declares a '
          + '__repr__ member displays it as its name — for example, self = Thing(hero) [Node]; without one, Object<id> [engine class]). '
          + 'Property names may carry group prefixes from the engine (for example, Node/process_mode); edits accept the bare name, the '
          + 'Members/ prefix, or the displayed prefixed form. '
          + 'Variable edits (edits parameter) are applied on the first stop while paused and verified against the engine: give '
          + 'target (a top-level variable name, for example, self or player), property (the name shown in the expansion, Members/ prefix '
          + 'optional — or a NESTED PATH like arr[0], dict["k"], arr[0].x, arr[0][1]: container members are written by rebuilding '
          + 'the whole container and fail explicitly when the container holds object references), value as a string, and type '
          + 'int|float|string|bool (default string). Only object properties and container members are editable — scalar variables '
          + 'are not. Each edit reports ok/failed. '
          + 'The scene tree (current node hierarchy, "scene tree" block under each stop) is snapshotted on every stop that has a '
          + 'stack frame; node ids are usable for future inspect linkage. '
          + 'Tree node ids and scene paths are directly usable: pass scene-tree node ids (the numbers in the tree lines) to expandNodes, '
          + 'or scene paths (for example, Main/Player, engine root excluded) to nodePaths — both expand on the first stop before the top-level '
          + 'variables. Edits accept target "node:<id>" (any scene node id) or "path:<scene path>" (resolved against the stop\'s tree, '
          + 'for example, path:Main/Player). Paths are the stable cross-call channel: raw ids are per-run random in launch mode. '
          + 'mode=attach joins a game the user already started with --remote-debug tcp://127.0.0.1:<port>: breakpoints are sent '
          + 'dynamically after connect (the only attach source), pauseOnAttach pauses it immediately, and the game keeps running '
          + 'after detach.',
      }),
      (() => {
        const tool = defineTool({          name: 'godot_debug',
          description:
            'Run a Godot project once under the debugger, or attach to a running game. launch (default): set breakpoints '
            + '(res:// path or absolute file path plus 1-based line), the tool launches the project headless with --remote-debug, '
            + 'snapshots the stack and locals/members/globals at each stop (object variables are expanded on the first stop, '
            + 'bounded by config maxExpandedObjects/maxExpandedProps; nested objects inside property values are expanded '
            + 'recursively up to config maxExpandDepth, deduplicated across levels; explicit scene-tree node ids in expandNodes '
            + 'and scene paths in nodePaths (for example, Main/Player) expand first, deduplicated against the variables), applies variable edits on the first stop while paused '
            + '(edits: target = a top-level object variable name from the expansion, node:<id> for any scene-tree node id, or path:<scene path> resolved against the stop\'s tree; property = its property name or a NESTED PATH '
            + '(arr[0], dict["k"], arr[0].x, arr[0][1] — container members are written by rebuilding the whole container, changes_parent '
            + 'semantics; containers holding object references fail explicitly), value as a '
            + 'string, type int|float|string|bool, default string; only object properties and container members are editable, each edit is verified '
            + 'against the engine and reports ok/failed), snapshots the scene tree on every stop that has a stack frame '
            + '(bounded by config maxTreeNodes), auto-continues up to maxStops, then reports the stops, the game output, '
            + 'and any engine errors; requires a godot executable (4.2+) configured or on PATH and a project imported once. '
            + 'attach: join a game the user already started with --remote-debug tcp://127.0.0.1:<port> (the port '
            + 'must be explicit and the game must start AFTER the call — Godot does not retry a failed connection); breakpoints '
            + 'are sent dynamically, pauseOnAttach pauses immediately, and the game keeps running after detach.',
          parameters: {
            path: {
              type: 'string',
              description: 'Project root (must contain project.godot). Defaults to the session working directory.',
            },
            mode: {
              type: 'string',
              description: '`launch` spawns the project headless; `attach` joins a game the user already started with --remote-debug.',
              enum: ['launch', 'attach'],
            },
            port: {
              type: 'number',
              description: 'Remote-debug port. launch: 0/omitted = auto-pick a free port; attach: required (must equal the port the game connects to).',
            },
            scene: {
              type: 'string',
              description: 'Scene to run (`res://` path); omitted = the project main scene. Launch mode only.',
            },
            breakpoints: {
              type: 'array',
              description: 'Breakpoints to hit: launch = set before launch (CLI --breakpoints); attach = sent dynamically after connect. Files must be inside the project.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  file: { type: 'string', required: true, description: '`res://` path or an absolute file path of a `.gd` script.' },
                  line: { type: 'number', required: true, description: '1-based source line.' },
                },
              },
            },
            pauseOnAttach: {
              type: 'boolean',
              description: 'Attach mode only: pause the game immediately once connected (break) for a "what is the game doing now" probe stop.',
            },
            expandNodes: {
              type: 'array',
              description: 'Scene-tree node ids (from the "scene tree" blocks, as strings) to expand on the first stop with a stack frame, BEFORE the top-level object variables (deduplicated against them). Node ids live in the same id space as object variables.',
              items: { type: 'string' },
            },
            nodePaths: {
              type: 'array',
              description: 'Scene-node paths (for example, Main/Player, engine root excluded) to expand on the first stop with a stack frame, resolved against that stop\'s scene tree — the stable cross-call form (raw ids are per-run random in launch). Requires scene-tree snapshots (maxTreeNodes > 0); unresolvable paths are skipped.',
              items: { type: 'string' },
            },
            edits: {
              type: 'array',
              description: 'Variable edits applied on the first stop with a stack frame, while paused, each verified against the engine. target = a top-level object variable name (for example, self or player) from the expansion; property = the property name or a nested path (arr[0], dict["k"], arr[0].x, arr[0][1] — container members are written by rebuilding the whole container, changes_parent semantics; containers holding object references fail explicitly); value = the new value as a string; type = how to parse it (int truncates like the engine, default string). Only object properties and container members are editable — scalar variables are not.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  target: { type: 'string', required: true, description: 'Top-level variable name of an object (locals/members/globals), node:<id> for any scene-tree node id, or path:<scene path> (resolved against the stop\'s scene tree).' },
                  property: { type: 'string', required: true, description: 'Property name or nested path (arr[0], dict["k"], arr[0].x, arr[0][1]; Members/ prefix optional).' },
                  value: { type: 'string', required: true, description: 'New value as a raw string, parsed per type.' },
                  type: {
                    type: 'string',
                    description: 'How to parse value: int (truncating), float, string (default), bool (true/false/0/1).',
                    enum: ['int', 'float', 'string', 'bool'],
                  },
                },
              },
            },
            maxStops: {
              type: 'number',
              default: 10,
              description: `Max stops to collect before the run is collected (default 10, capped at ${MAX_STOPS}).`,
            },
            args: {
              type: 'array',
              description: 'Extra argv passed to the game after -- (for example, --fixed-fps 60). Launch mode only.',
              items: { type: 'string' },
            },
            singleThreadedScene: {
              type: 'boolean',
              description: 'Launch mode only: pass --single-threaded-scene to the game (the engine runs its scene on the main thread only; source-plugin parity).',
            },
          },
          timeoutMs: resolved.timeoutMs,
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                stops: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      isUserBreakpoint: { type: 'boolean', required: true },
                      reason: { type: 'string', required: true },
                      threadId: { type: 'number', required: true },
                      snapshot: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          frames: {
                            type: 'array',
                            required: true,
                            items: {
                              type: 'object',
                              additionalProperties: false,
                              properties: {
                                file: { type: 'string', required: true },
                                line: { type: 'number', required: true },
                                func: { type: 'string', required: true },
                              },
                            },
                          },
                          scopes: {
                            type: 'object',
                            required: true,
                            additionalProperties: false,
                            properties: {
                              locals: {
                                type: 'array',
                                required: true,
                                items: {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: {
                                    name: { type: 'string', required: true },
                                    value: { type: 'string', required: true },
                                  },
                                },
                              },
                              members: {
                                type: 'array',
                                required: true,
                                items: {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: {
                                    name: { type: 'string', required: true },
                                    value: { type: 'string', required: true },
                                  },
                                },
                              },
                              globals: {
                                type: 'array',
                                required: true,
                                items: {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: {
                                    name: { type: 'string', required: true },
                                    value: { type: 'string', required: true },
                                  },
                                },
                              },
                            },
                          },
                          scopeTruncated: {
                            type: 'object',
                            required: true,
                            additionalProperties: false,
                            properties: {
                              locals: { type: 'boolean', required: true },
                              members: { type: 'boolean', required: true },
                              globals: { type: 'boolean', required: true },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                output: { type: 'array', required: true, items: { type: 'string' } },
                errors: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      hr: { type: 'number', required: true },
                      min: { type: 'number', required: true },
                      sec: { type: 'number', required: true },
                      msec: { type: 'number', required: true },
                      file: { type: 'string', required: true },
                      func: { type: 'string', required: true },
                      line: { type: 'number', required: true },
                      error: { type: 'string', required: true },
                      desc: { type: 'string', required: true },
                      warning: { type: 'boolean', required: true },
                      stack: {
                        type: 'array',
                        required: true,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            file: { type: 'string', required: true },
                            func: { type: 'string', required: true },
                            line: { type: 'number', required: true },
                          },
                        },
                      },
                    },
                  },
                },
                exit: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    exitCode: { type: 'number' },
                    signal: { type: 'string' },
                  },
                },
                detached: { type: 'boolean', required: true },
                expansion: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    stopIndex: { type: 'number', required: true },
                    expandedObjects: { type: 'number', required: true },
                    entries: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          name: { type: 'string', required: true },
                          id: { type: 'string', required: true },
                          className: { type: 'string', required: true },
                          repr: { type: 'string' },
                          rows: {
                            type: 'array',
                            required: true,
                            items: {
                              type: 'object',
                              additionalProperties: false,
                              properties: {
                                name: { type: 'string', required: true },
                                value: { type: 'string', required: true },
                              },
                            },
                          },
                          children: {
                            type: 'array',
                            items: { type: 'json' },
                          },
                        },
                      },
                    },
                  },
                },
                expandedObjects: { type: 'number', required: true },
                expansionTruncated: { type: 'boolean', required: true },
                edits: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    stopIndex: { type: 'number', required: true },
                    results: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          target: { type: 'string', required: true },
                          property: { type: 'string', required: true },
                          requested: { type: 'json', required: true },
                          type: { type: 'string', required: true, enum: ['int', 'float', 'string', 'bool'] },
                          ok: { type: 'boolean', required: true },
                          detail: { type: 'string' },
                        },
                      },
                    },
                  },
                },
                editsApplied: { type: 'number', required: true },
                editsTruncated: { type: 'boolean', required: true },
                sceneTrees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      stopIndex: { type: 'number', required: true },
                      lines: { type: 'array', required: true, items: { type: 'string' } },
                    },
                  },
                },
                sceneTreeCount: { type: 'number', required: true },
                sceneTreeTruncated: { type: 'boolean', required: true },
                outputTruncated: { type: 'boolean', required: true },
                varsTruncated: { type: 'boolean', required: true },
              },
            },
            render: (args, value) => [{ type: 'text', text: renderDebugOutput(value as unknown as DebugRunResult, args.maxStops ?? 10) }],
            // T20: the replayed meta keeps the compact DebugMeta fields (backward
            // compatible) and gains the structured `view` (JSON-safe, byte-bounded)
            // for the dynamic tool card. maxStops is clamped to MAX_STOPS exactly
            // like execute, so the head line and the view agree with the run.
            presentationMeta: (args, value) => {
              const maxStops = Math.min(args.maxStops ?? 10, MAX_STOPS)
              const result = value as unknown as DebugRunResult
              return {
                ...debugMeta(result, maxStops),
                view: structuredDebugView(result as unknown as StructuredDebugInput, maxStops),
              }
            },
          },
          async execute(args, exec) {
            const c = resolved
            const workdir = exec.agent?.session.header.cwd ?? process.cwd()
            const input = args
            const projectRoot = input.path === undefined ? workdir : resolve(workdir, input.path)
            const result = await runDebug({
              executable: c.executable,
              executableArgs: c.executableArgs,
              projectRoot,
              ...(input.scene !== undefined ? { scene: input.scene } : {}),
              breakpoints: (input.breakpoints ?? []).map(bp => ({
                file: bp.file.startsWith('res://') ? bp.file : resolve(workdir, bp.file),
                line: bp.line,
              })),
              maxStops: Math.min(input.maxStops ?? 10, MAX_STOPS),
              timeoutMs: c.timeoutMs,
              ...(c.debugPort !== 0 ? { port: c.debugPort } : {}),
              ...(input.port !== undefined ? { port: input.port } : {}),
              connectWaitMs: c.connectWaitMs,
              idleTimeoutMs: c.idleTimeoutMs,
              graceMs: c.graceMs,
              maxMessageBytes: c.maxMessageBytes,
              maxOutputBytes: c.maxOutputBytes,
              maxStderrBytes: c.maxStderrBytes,
              signal: exec.signal,
              subprocess: ctx.subprocess,
              ...(input.args !== undefined ? { args: input.args } : {}),
              ...(input.mode !== undefined ? { mode: input.mode } : {}),
              ...(input.pauseOnAttach !== undefined ? { pauseOnAttach: input.pauseOnAttach } : {}),
              ...(input.edits !== undefined ? { edits: input.edits } : {}),
              maxExpandedObjects: c.maxExpandedObjects,
              maxExpandedProps: c.maxExpandedProps,
              maxExpandDepth: c.maxExpandDepth,
              maxEdits: c.maxEdits,
              maxTreeNodes: c.maxTreeNodes,
              ...(input.expandNodes !== undefined ? { expandNodes: input.expandNodes } : {}),
              ...(input.nodePaths !== undefined ? { nodePaths: input.nodePaths } : {}),
              ...(input.singleThreadedScene !== undefined ? { singleThreadedScene: input.singleThreadedScene } : {}),
              renderOptions: { fullPrecisionNumbers: c.fullPrecisionNumbers },
            })
            // The exit schema is an optional object without nulls; a null exit
            // (attach mode) and null exit fields are normalized away, as is a
            // null expansion/edit carrier and the scene-tree root (which
            // carries bigint ids — only the rendered lines cross the JSON
            // boundary). One return shape carries both branches (the fields
            // must not be lost on the attach null-exit path).
            const exit = result.exit === null ? undefined : {
              ...(result.exit.exitCode !== null ? { exitCode: result.exit.exitCode } : {}),
              ...(result.exit.signal !== null ? { signal: result.exit.signal } : {}),
            }
            const { expansion: _expansion, edits: _edits, sceneTrees: _sceneTrees, exit: _exit, ...resultRest } = result
            // The expansion entries carry recursive `children` (Phase 8) that
            // the schema types as json — the runtime values are plain JSON, so
            // the only gap is the static type (children are declared with
            // `items: json` because the schema cannot recurse).
            type SchemaEntry = {
              name: string
              id: string
              className: string
              repr?: string
              rows: { name: string; value: string }[]
              children?: JsonValue[]
            }
            const expansion = result.expansion === null
              ? undefined
              : result.expansion as unknown as {
                stopIndex: number
                expandedObjects: number
                entries: SchemaEntry[]
              }
            return {
              ...resultRest,
              ...(exit !== undefined ? { exit } : {}),
              ...(expansion !== undefined ? { expansion } : {}),
              ...(result.edits !== null
                ? {
                  edits: {
                    stopIndex: result.edits.stopIndex,
                    // JSON-safe: an int64 request parses to a bigint —
                    // stringify it before it crosses the tool-result boundary.
                    results: result.edits.results.map(r => ({
                      target: r.target,
                      property: r.property,
                      requested: typeof r.requested === 'bigint' ? r.requested.toString() : r.requested,
                      type: r.type,
                      ok: r.ok,
                      ...(r.detail !== undefined ? { detail: r.detail } : {}),
                    })),
                  },
                }
                : {}),
              ...(result.sceneTrees !== null
                ? { sceneTrees: result.sceneTrees.map(t => ({ stopIndex: t.stopIndex, lines: t.lines })) }
                : {}),
            }
          },
          presentCall: (args): GenericCallView => {
            const where = args.path !== undefined ? ` ${args.path}` : ' workspace'
            const verb = args.mode === 'attach' ? 'Attach debug to Godot' : 'Debug Godot'
            return { card: 'generic', title: `${verb}${where}` }
          },
          presentResult: presentDebugResult,
        })
        const disposeTool = ctx.tools.register(tool)
        return () => {
          disposeTool()
        }      })(),
      // T21: the interactive session service (long-lived sessions, attach by
      // default, launch since T21.8), bridged to `harness.handle` RPC by the
      // dynamic plugin's host half. Session idle timeout is a constant
      // 10 min (configurable later).
      (() => {
        const service = createDebugSessionService({
          maxMessageBytes: resolved.maxMessageBytes,
          maxOutputBytes: resolved.maxOutputBytes,
          maxTreeNodes: resolved.maxTreeNodes,
          idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
          subprocess: ctx.subprocess,
          graceMs: resolved.graceMs,
        })
        return ctx.provide('godot.debugSession', service)
      })(),
      (() => {
        const tool = defineTool({
          name: 'godot_debug_session',
          description:
            'Start and control a LONG-LIVED interactive debug session (T21): attach (default) joins a game the user already '
            + 'started with --remote-debug tcp://127.0.0.1:<port>; mode=launch spawns the game itself (version-gated 4.2+, the '
            + 'session owns the process and terminates it on stop, T21.8). Then pause/continue/step and manage breakpoints '
            + 'across calls while the session stays alive in the background (one session at a time). '
            + 'action=start returns the sessionId and a connecting state immediately (the game may connect later, within the '
            + 'idle window); action=command sends one control command (pause/continue/step/next/breakpoint/edits); '
            + 'action=stop detaches (best-effort breakpoint removal + continue). The Web panel controls the same session '
            + 'through the session id. Note: a port previously used by a one-shot godot_debug attach never reconnects '
            + '(Godot does not retry a failed connection) — start the game fresh on this port.',
          parameters: {
            action: {
              type: 'string',
              enum: ['start', 'stop', 'command'],
              description: '`start` (default) creates the session; `command` sends one control; `stop` detaches.',
            },
            mode: {
              type: 'string',
              enum: ['attach', 'launch'],
              description: '`attach` (default) joins a caller-started game on port; `launch` (T21.8) spawns the game (version-gated; the session terminates it on stop).',
            },
            port: {
              type: 'number',
              description: 'The attach port (1-65535); required for action=start in attach mode.',
            },
            executable: {
              type: 'string',
              description: 'Launch mode only: the godot executable to spawn (defaults to the configured executable).',
            },
            projectRoot: {
              type: 'string',
              description: 'The project root (defaults to the working directory); breakpoint res:// paths resolve against it.',
            },
            scene: {
              type: 'string',
              description: 'Launch mode only: scene to run (`res://` path); omitted = the project main scene.',
            },
            args: {
              type: 'array',
              description: 'Launch mode only: extra argv passed to the game after --.',
              items: { type: 'string' },
            },
            singleThreadedScene: {
              type: 'boolean',
              description: 'Launch mode only: pass --single-threaded-scene to the game.',
            },
            sessionId: {
              type: 'string',
              description: 'The session id from a prior start; required for command/stop.',
            },
            command: {
              type: 'string',
              enum: ['pause', 'continue', 'step', 'next'],
              description: 'The control command for action=command (pause/continue/step into/step over).',
            },
            breakpoint: {
              type: 'json',
              description: 'Breakpoint change for action=command: {file, line, enabled} (file as res:// or a project path).',
            },
            edits: {
              type: 'json',
              description: 'Variable edits for action=command while paused: [{target, property, value, type}] (same semantics as godot_debug edits).',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionId: { type: 'string', required: true },
                state: { type: 'string', required: true },
                port: { type: 'number', required: true },
                breakpoints: { type: 'json' },
                commandResult: { type: 'json' },
              },
            },
            render(_args, value) {
              const v = value as { state: string; sessionId: string; port: number; breakpoints?: unknown; commandResult?: unknown }
              const head = v.state === 'detached' ? 'debug session detached' : `debug session ${v.state} (session ${v.sessionId}, :${v.port})`
              const lines = [head]
              if (Array.isArray(v.breakpoints) && v.breakpoints.length > 0) {
                lines.push(`breakpoints (${v.breakpoints.length}):`)
                for (const bp of v.breakpoints as { file: string; line: number }[]) lines.push(`  ${bp.file}:${bp.line}`)
              }
              if (v.commandResult !== undefined) lines.push(`command result: ${JSON.stringify(v.commandResult)}`)
              return [{ type: 'text', text: lines.join('\n') }]
            },
            presentationMeta: (_args, value) => {
              const v = value as { sessionId?: string; state?: string; port?: number; mode?: string }
              return {
                ...(v.sessionId !== undefined ? { sessionId: v.sessionId } : {}),
                ...(v.state !== undefined ? { state: v.state } : {}),
                ...(v.port !== undefined ? { port: v.port } : {}),
                ...(v.mode !== undefined ? { mode: v.mode } : {}),
              }
            },
          },
          async execute(args, exec) {
            const service = ctx.get('godot.debugSession') as DebugSessionService | undefined
            if (service === undefined) {
              throw new GodotError(
                'godot_debug_session: the interactive session service is not mounted (tool-godot-debug required)',
                'GODOT_UNAVAILABLE',
              )
            }
            const action = args.action ?? 'start'
            if (action === 'start') {
              const cwd = exec.agent?.session.header.cwd ?? process.cwd()
              const mode = args.mode ?? 'attach'
              if (mode === 'launch') {
                // T21.8: the session spawns the game — version-gated 4.2+,
                // auto-picked port, process owned (terminated on stop).
                const started = await service.start({
                  mode: 'launch',
                  executable: args.executable ?? resolved.executable,
                  projectRoot: args.projectRoot ?? cwd,
                  ...(args.scene !== undefined ? { scene: args.scene } : {}),
                  ...(args.args !== undefined ? { args: args.args } : {}),
                  ...(args.singleThreadedScene !== undefined ? { singleThreadedScene: args.singleThreadedScene } : {}),
                })
                if ('error' in started) {
                  if (started.error === 'session-active') {
                    throw new GodotError('godot_debug_session: another session is already active (one debugger per game)', 'GODOT_PARSE_ERROR')
                  }
                  throw new GodotError(
                    `godot_debug_session: launch requires a godot executable and a subprocess runtime (${started.error})`,
                    'GODOT_PARSE_ERROR',
                  )
                }
                return { sessionId: started.sessionId, state: started.state, port: started.port, mode: 'launch' }
              }
              // attach (default): an explicit port the caller's game dials.
              const port = args.port
              if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
                throw new GodotError(
                  'godot_debug_session: attach start requires an explicit port 1-65535 (start the game with --remote-debug tcp://127.0.0.1:<port>; Godot does not retry a failed connection)',
                  'GODOT_PARSE_ERROR',
                )
              }
              if (args.scene !== undefined || args.args !== undefined || args.singleThreadedScene === true) {
                throw new GodotError(
                  'godot_debug_session: scene/args/singleThreadedScene are launch-only (use mode=launch to spawn the game)',
                  'GODOT_PARSE_ERROR',
                )
              }
              const started = await service.start({
                mode: 'attach',
                port,
                projectRoot: args.projectRoot ?? cwd,
              })
              if ('error' in started) {
                if (started.error === 'session-active') {
                  throw new GodotError('godot_debug_session: another session is already active (one debugger per game)', 'GODOT_PARSE_ERROR')
                }
                throw new GodotError(`godot_debug_session: invalid port ${port}`, 'GODOT_PARSE_ERROR')
              }
              return { sessionId: started.sessionId, state: started.state, port: started.port, mode: 'attach' }
            }
            const sessionId = args.sessionId
            if (typeof sessionId !== 'string' || sessionId === '') {
              throw new GodotError('godot_debug_session: sessionId is required for command/stop', 'GODOT_PARSE_ERROR')
            }
            if (action === 'stop') {
              const stopped = service.stop(sessionId)
              if (!stopped.ok) {
                throw new GodotError(`godot_debug_session: unknown or already-detached session ${sessionId}`, 'GODOT_PARSE_ERROR')
              }
              const snap = service.poll(sessionId)
              return {
                sessionId,
                state: 'detached',
                port: 'port' in snap ? snap.port : 0,
              }
            }
            // action === 'command'
            let request: SessionCommandRequest | undefined
            if (args.command !== undefined) {
              request = { kind: args.command }
            } else if (args.breakpoint !== undefined) {
              const bp = args.breakpoint
              if (bp !== null && typeof bp === 'object' && !Array.isArray(bp)) {
                const record = bp as { file?: unknown; line?: unknown; enabled?: unknown }
                request = {
                  kind: 'breakpoint',
                  file: typeof record.file === 'string' ? record.file : '',
                  line: typeof record.line === 'number' ? record.line : 0,
                  enabled: record.enabled === true,
                }
              }
            } else if (args.edits !== undefined) {
              request = { kind: 'edits', edits: args.edits as unknown as EditRequest[] }
            }
            if (request === undefined) {
              throw new GodotError('godot_debug_session: command requires one of command/breakpoint/edits', 'GODOT_PARSE_ERROR')
            }
            const result = await service.command(sessionId, request)
            if (!('ok' in result)) {
              throw new GodotError(`godot_debug_session: unknown session ${sessionId}`, 'GODOT_PARSE_ERROR')
            }
            if (!result.ok) {
              throw new GodotError(`godot_debug_session: ${result.error}${result.detail !== undefined ? `: ${result.detail}` : ''}`, 'GODOT_PARSE_ERROR')
            }
            const snap = service.poll(sessionId)
            return {
              sessionId,
              state: 'state' in snap ? snap.state : 'unknown',
              port: 'port' in snap ? snap.port : 0,
              ...(result.edits !== undefined
                ? {
                  commandResult: {
                    edits: {
                      results: result.edits.results.map(r => ({
                        target: r.target,
                        property: r.property,
                        requested: typeof r.requested === 'bigint' ? r.requested.toString() : r.requested,
                        type: r.type,
                        ok: r.ok,
                        ...(r.detail !== undefined ? { detail: r.detail } : {}),
                      })),
                      truncated: result.edits.truncated,
                    },
                  },
                }
                : {}),
            }
          },
          presentCall: (args): GenericCallView => {
            const verb = args.action === 'stop' ? 'Stop debug session' : args.action === 'command' ? 'Debug session command' : 'Start debug session'
            return { card: 'generic', title: verb }
          },
        })
        const disposeTool = ctx.tools.register(tool)
        return () => {
          disposeTool()
        }
      })(),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'tool-godot-debug.register')
}
