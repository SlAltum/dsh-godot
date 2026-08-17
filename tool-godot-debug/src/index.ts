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
import type { GenericCallView, GenericResultView, JsonValue, ToolResult } from '@deepseek-ai/dsh-tools'
import { resolve } from 'node:path'
import { validateConfig } from './config.ts'
import type { GodotDebugConfig, ResolvedGodotDebugConfig } from './config.ts'
import type { ExpandedEntry } from './inspect.ts'
import { runDebug } from './tool.ts'
import type { DebugRunResult } from './tool.ts'

export { Config, validateConfig } from './config.ts'
export type { GodotDebugConfig, ResolvedGodotDebugConfig } from './config.ts'
export { runDebug } from './tool.ts'
export type { DebugBreakpoint, DebugRunMode, DebugRunOptions, DebugRunResult, DebugStop } from './tool.ts'
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
 *  (`player`, `arr[0]`, `dict["k"]` — T8.0 fact 6).
 * @param entry - the entry to render.
 * @param indent - the base indentation (spaces) for the entry line.
 * @returns the rendered lines.
 */
function renderEntry(entry: ExpandedEntry, indent: number): string[] {
  const pad = ' '.repeat(indent)
  const lines: string[] = []
  lines.push(`${pad}${entry.name} = Object<${entry.id}> [${entry.className}]`)
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
        // per-edit outcome (verified against the engine via re-inspect).
        if (value.edits != null && value.edits.results.length > 0) {
          lines.push(`  edits (${value.edits.results.length}):`)
          for (const r of value.edits.results) {
            const status = r.ok ? 'ok' : `failed: ${r.detail ?? 'unknown'}`
            lines.push(`    ${r.target}.${r.property} = ${JSON.stringify(r.requested)} [${r.type}] ${status}`)
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
 * @param config - resolved plugin configuration from schemastery.
 */
export function apply(ctx: Context, config: GodotDebugConfig): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedGodotDebugConfig
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
          + 'expanded recursively, bounded by config maxExpandDepth, with location-path names like arr[0] or dict["k"]). '
          + 'Variable edits (edits parameter) are applied on the first stop while paused and verified against the engine: give '
          + 'target (a top-level variable name, e.g. self or player), property (the name shown in the expansion, Members/ prefix '
          + 'optional), value as a string, and type int|float|string|bool (default string). Only object properties are editable — '
          + 'scalar variables are not. Each edit reports ok/failed. '
          + 'The scene tree (current node hierarchy, "scene tree" block under each stop) is snapshotted on every stop that has a '
          + 'stack frame; node ids are usable for future inspect linkage. '
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
            + 'recursively up to config maxExpandDepth, deduplicated across levels), applies variable edits on the first stop while paused '
            + '(edits: target = a top-level object variable name from the expansion, property = its property name, value as a '
            + 'string, type int|float|string|bool, default string; only object properties are editable, each edit is verified '
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
              description: 'launch spawns the project headless; attach joins a game the user already started with --remote-debug.',
              enum: ['launch', 'attach'],
            },
            port: {
              type: 'number',
              description: 'Remote-debug port. launch: 0/omitted = auto-pick a free port; attach: required (must equal the port the game connects to).',
            },
            scene: {
              type: 'string',
              description: 'Scene to run (res:// path); omitted = the project main scene. launch only.',
            },
            breakpoints: {
              type: 'array',
              description: 'Breakpoints to hit: launch = set before launch (CLI --breakpoints); attach = sent dynamically after connect. Files must be inside the project.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  file: { type: 'string', required: true, description: 'res:// path or absolute file path of a .gd script.' },
                  line: { type: 'number', required: true, description: '1-based source line.' },
                },
              },
            },
            pauseOnAttach: {
              type: 'boolean',
              description: 'attach only: pause the game immediately once connected (break) for a "what is the game doing now" probe stop.',
            },
            edits: {
              type: 'array',
              description: 'Variable edits applied on the first stop with a stack frame, while paused, each verified against the engine. target = a top-level object variable name (e.g. self, player) from the expansion; property = the property name; value = the new value as a string; type = how to parse it (int truncates like the engine, default string). Only object properties are editable — scalar variables are not.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  target: { type: 'string', required: true, description: 'Top-level variable name of an object (locals/members/globals).' },
                  property: { type: 'string', required: true, description: 'Property name on that object (Members/ prefix optional).' },
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
              description: 'Extra argv passed to the game after -- (e.g. --fixed-fps 60). launch only.',
              items: { type: 'string' },
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
            presentationMeta: (args, value) => debugMeta(value as unknown as DebugRunResult, args.maxStops ?? 10),
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
              ...(result.edits !== null ? { edits: result.edits } : {}),
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
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'tool-godot-debug.register')
}
