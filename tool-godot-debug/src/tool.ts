/**
 * The `godot_debug` run pipeline: one bounded scripted debug run, in two
 * modes. `launch` (the v1 path) validates the project and breakpoints, gates
 * the godot version (4.2+), pre-picks a port (lsp-godot's `pickFreePort`),
 * spawns the headless game with `--remote-debug`, waits for `set_pid`, then
 * loops stop → snapshot → continue up to `maxStops`, and terminates the
 * process tree. `attach` (Phase 4) connects to a game the CALLER started with
 * `--remote-debug tcp://127.0.0.1:<port>`: dynamic `breakpoint` commands
 * replace the CLI form (the only breakpoint source attach has), optional
 * `pauseOnAttach` sends `break` for an immediate probe stop, and teardown is
 * best-effort breakpoint removal + continue + disconnect — the game keeps
 * running (never killed, `exit: null`, `detached: true`). Protocol and
 * process facts are pinned in `.context/t3/facts.md` and
 * `.context/t4/facts.md`.
 * @module @deepseek-ai/dsh-tool-godot-debug/tool
 */

import { statSync } from 'node:fs'
import { relative, isAbsolute, sep } from 'node:path'
import { verifyGodotVersion, pickFreePort } from '@deepseek-ai/dsh-lsp-godot'
import type { SubprocessLike } from '@deepseek-ai/dsh-lsp-godot'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { DebugController, WaitTimeoutError, type GodotRuntimeError, type StopInfo } from './controller.ts'
import { expandObjects, type ExpandedEntry } from './inspect.ts'
import { applyEdits, type EditRequest, type EditResult } from './edit.ts'
import { parseSceneTree, renderSceneTree, resolveNodePaths, type SceneTreeNode } from './scene-tree.ts'
import { GodotError } from './error.ts'
import { renderSnapshot, type RenderOptions, type StopSnapshot } from './snapshot.ts'

/** One requested breakpoint: a `res://` path or an absolute file path plus a 1-based line. */
export interface DebugBreakpoint {
  file: string
  line: number
}

/** How the run connects to the game: launch spawns it, attach joins a
 *  caller-started game that connects INTO the bound port. */
export type DebugRunMode = 'launch' | 'attach'

/** The bounds applied while rendering every stop snapshot. */
const RENDER_OPTIONS: RenderOptions = {
  maxDepth: 3,
  maxVarsPerScope: 200,
  maxValueLength: 200,
}

/** One recorded stop: why the game paused and the rendered snapshot. */
export interface DebugStop {
  isUserBreakpoint: boolean
  reason: string
  /** The paused thread id (1 = main thread, T10.0). */
  threadId: number
  snapshot: StopSnapshot
}

/** The structured result of one complete debug run. */
export interface DebugRunResult {
  stops: DebugStop[]
  output: string[]
  errors: GodotRuntimeError[]
  /** The spawned game's exit facts after the run ended (terminated or natural). */
  exit: SubprocessOutcome | null
  /** True when the game was not owned by the tool and keeps running after
   *  detach (attach mode); launch mode is always `false`. */
  detached: boolean
  /** The Phase 5/8 variable expansion from the first frame-bearing stop;
   *  `null` when no stop had a frame or expansion is disabled. */
  expansion: { stopIndex: number; entries: ExpandedEntry[]; expandedObjects: number } | null
  /** Successful object expansions this run (top level + nested children). */
  expandedObjects: number
  /** Any object skipped, property truncated, selection sliced, or budget spent. */
  expansionTruncated: boolean
  /** The Phase 6 variable edits applied on the first frame-bearing stop;
   *  `null` when no stop had a frame or no edits were requested. */
  edits: { stopIndex: number; results: EditResult[] } | null
  /** Successful edits this run. */
  editsApplied: number
  /** Any edit failed to parse/resolve/verify, or the budget was spent. */
  editsTruncated: boolean
  /** The Phase 7 scene-tree snapshots per frame-bearing stop; `null` when no
   *  stop had a frame or scene trees are disabled. */
  sceneTrees: { stopIndex: number; root: SceneTreeNode; lines: string[] }[] | null
  /** Successful scene-tree snapshots this run. */
  sceneTreeCount: number
  /** Any tree skipped, node-dropped, or budget spent. */
  sceneTreeTruncated: boolean
  outputTruncated: boolean
  /** Any stop whose variable snapshot was incomplete (protocol stall/disconnect). */
  varsTruncated: boolean
}

/** One run's parameters, assembled by the tool layer from config and arguments. */
export interface DebugRunOptions {
  /** Godot executable path or PATH command name (resolved by the seam; attach never resolves it). */
  executable: string
  /** Fixed argv elements inserted after the executable. */
  executableArgs: string[]
  /** The project root (must contain project.godot). */
  projectRoot: string
  /** Scene to run; omitted = the project's main scene. launch only. */
  scene?: string
  /** Breakpoints: launch = `--breakpoints` CLI form (single-colon `res://f:l`);
   *  attach = dynamic `breakpoint` commands sent after `set_pid`. */
  breakpoints: DebugBreakpoint[]
  /** Max stops before the run is collected (default 10). */
  maxStops: number
  /** Cooperative budget for the whole run, enforced through the signal. */
  timeoutMs: number
  /** Remote-debug port; launch: 0 or omitted = auto-pick a free port
   *  (lsp-godot's `pickFreePort`); attach: REQUIRED (must equal the port the
   *  caller starts the game with). */
  port?: number
  /** Budget for the game to connect. */
  connectWaitMs: number
  /** Budget for one protocol wait (stop / snapshot). */
  idleTimeoutMs: number
  /** Terminate-escalation grace passed to the subprocess seam. */
  graceMs: number
  maxMessageBytes: number
  maxOutputBytes: number
  maxStderrBytes: number
  /** Caller cancellation (the tool-call timeout policy's signal). */
  signal: AbortSignal
  /** The subprocess seam (or a test double). */
  subprocess: SubprocessLike
  /** Extra argv passed to the game after `--`. launch only. */
  args?: string[]
  /** How the run connects; `'launch'` when omitted. */
  mode?: DebugRunMode
  /** attach only: pause the game immediately once connected (`break`), for a
   *  "what is the game doing right now" probe stop. */
  pauseOnAttach?: boolean
  /** Max objects expanded via `scene:inspect_object` on the first frame-bearing
   *  stop (0 = disabled). */
  maxExpandedObjects: number
  /** Max property rows kept per expanded object. */
  maxExpandedProps: number
  /** Max expansion depth (1 = top level only; nested objects recurse while
   *  below this depth). */
  maxExpandDepth: number
  /** Variable edits to apply on the first frame-bearing stop, while paused. */
  edits?: EditRequest[]
  /** Max edits applied (0 = disabled). */
  maxEdits: number
  /** Max scene-tree nodes parsed/rendered per frame-bearing stop (0 = disabled). */
  maxTreeNodes: number
  /** Explicit scene-tree node ids to expand on the first frame-bearing stop
   *  (T15 — node ids share the stack variables' id space, pinned T7.0 fact 8;
   *  strings avoid JSON bigint precision loss). Expanded BEFORE the top-level
   *  variable selection and deduplicated against it. */
  expandNodes?: string[]
  /** Scene-node PATHS to expand on the first frame-bearing stop (T15 — the
   *  path form is the stable cross-call channel: scene structure is static
   *  across runs, raw ids are per-run random in launch and single-session in
   *  attach). Resolved against the stop's scene tree (`Main/Player`, root
   *  excluded); requires `maxTreeNodes > 0`. Unresolvable paths are skipped
   *  like timed-out objects. */
  nodePaths?: string[]
  /** Test hook: called with the bound port once the controller listens. */
  onPort?: (port: number) => Promise<void>
}

/** Throw when the caller's signal fired. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new GodotError('godot_debug: aborted', 'GODOT_ABORTED')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms)
})

/** The stderr tail retained by the seam, for launch diagnostics. */
function stderrTail(handle: SubprocessHandle): string {
  return handle.collected.stderr?.readFrom(0).text ?? ''
}

/** Convert a breakpoint file to the `res://` form the protocol expects.
 *  Guards: `res://` escapes (`/../` in either slash direction) and — for
 *  absolute input on Windows — cross-drive paths, where `path.relative`
 *  returns an absolute path instead of a `..`-prefixed one and would
 *  silently produce a breakpoint that never matches. */
function toResPath(file: string, projectRoot: string): string {
  if (file.startsWith('res://')) {
    if (file.replace(/\\/g, '/').includes('/../')) {
      throw new GodotError(`godot_debug: breakpoint ${file} escapes the project`, 'GODOT_PARSE_ERROR')
    }
    return file
  }
  const abs = isAbsolute(file) ? file : `${process.cwd()}${sep}${file}`
  const rel = relative(projectRoot, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new GodotError(`godot_debug: breakpoint ${file} is outside the project`, 'GODOT_PARSE_ERROR')
  }
  return `res://${rel.replace(/\\/g, '/')}`
}

/**
 * Run one bounded debug session. The call settles only after the run ends,
 * the budget elapses, or the caller cancels. Launch mode terminates the game
 * process on every path; attach mode detaches (best-effort breakpoint removal
 * + continue) and leaves the caller's game running.
 * @param options - the run parameters.
 * @returns the structured run report.
 */
export async function runDebug(options: DebugRunOptions): Promise<DebugRunResult> {
  throwIfAborted(options.signal)

  if (options.pauseOnAttach === true && options.mode !== 'attach') {
    throw new GodotError('godot_debug: pauseOnAttach is only valid in attach mode', 'GODOT_PARSE_ERROR')
  }

  // T15: explicit scene-tree node ids must be digits-only (strings on the
  // wire because JSON cannot carry bigints losslessly; ids can exceed 2^53
  // and even 2^63-1 — pinned T13.0 fact 6).
  for (const id of options.expandNodes ?? []) {
    if (!/^\d+$/.test(id) || BigInt(id) >= 1n << 64n) {
      throw new GodotError(`godot_debug: expandNodes entry "${id}" is not a valid node id (digits only)`, 'GODOT_PARSE_ERROR')
    }
  }

  // Project validation (shared by both modes; breakpoints convert against it).
  let projectRoot: string
  try {
    projectRoot = options.projectRoot
    if (!statSync(projectRoot).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new GodotError(`godot_debug: project root ${options.projectRoot} is not a readable directory`, 'GODOT_PARSE_ERROR')
  }

  // The fork point sits BEFORE any executable resolution: attach never spawns
  // or probes the godot binary (the game is already running; the version gate
  // does not apply — the threadId protocol field needs 4.2+, documented).
  if (options.mode === 'attach') {
    return attachRun(options, projectRoot)
  }
  return launchRun(options, projectRoot)
}

/** The v1 launch path: version gate → spawn headless game → stop loop →
 *  settle exit → terminate. Behavior is unchanged by Phase 4. */
async function launchRun(options: DebugRunOptions, projectRoot: string): Promise<DebugRunResult> {
  const breakpointArg = options.breakpoints
    .map(bp => `${toResPath(bp.file, projectRoot)}:${bp.line}`)
    .join(',')

  // Version gate (spawn mode needs Godot 4.2+, protocol threadId facts).
  const executable = await options.subprocess.resolveExecutable(options.executable, undefined, options.signal)
  const versionLine = await probeVersion(options, executable)
  const gate = verifyGodotVersion(versionLine, versionLine.trim().charAt(0))
  if (!gate.ok) {
    throw new GodotError(`godot_debug: requires Godot 4.2+ (4.x); the configured executable reports ${gate.version}`, 'GODOT_UNAVAILABLE')
  }

  const port = options.port !== undefined && options.port !== 0 ? options.port : await pickFreePort()
  const controller = new DebugController({
    maxMessageBytes: options.maxMessageBytes,
    maxOutputBytes: options.maxOutputBytes,
  })
  let handle: SubprocessHandle | undefined

  try {
    await controller.listen(port)
    if (options.onPort !== undefined) await options.onPort(controller.port)

    const argv = [
      executable,
      ...options.executableArgs,
      '--headless',
      '--path', projectRoot,
      '--remote-debug', `tcp://127.0.0.1:${port}`,
      ...(breakpointArg !== '' ? ['--breakpoints', breakpointArg] : []),
      ...(options.scene !== undefined ? [options.scene] : []),
      ...(options.args !== undefined ? ['--', ...options.args] : []),
    ]
    handle = options.subprocess.spawn({
      argv,
      cwd: projectRoot,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: options.maxStderrBytes },
      },
      graceMs: options.graceMs,
      signal: options.signal,
    })

    await waitForSetPid(controller, handle, options)
    const { stops, varsTruncated, expansion, expansionTruncated, edits, editsTruncated, sceneTrees, sceneTreeTruncated } =
      await collectStops(controller, options)
    const exit = await settleExit(handle, options.idleTimeoutMs)

    return {
      stops,
      output: [...controller.output],
      errors: [...controller.errors],
      exit,
      detached: false,
      expansion,
      expandedObjects: expansion?.expandedObjects ?? 0,
      expansionTruncated,
      edits,
      editsApplied: edits?.results.filter(r => r.ok).length ?? 0,
      editsTruncated,
      sceneTrees,
      sceneTreeCount: sceneTrees?.length ?? 0,
      sceneTreeTruncated,
      outputTruncated: controller.outputTruncated,
      varsTruncated,
    }
  } catch (error) {
    if (controller.protocolFailure !== undefined && !(error instanceof GodotError)) {
      throw new GodotError(`godot_debug: protocol failure: ${controller.protocolFailure.message}`, 'GODOT_PARSE_ERROR')
    }
    throw error
  } finally {
    handle?.terminate()
    await controller.dispose()
  }
}

/**
 * The Phase 4 attach path: join a caller-started game. No spawn, no version
 * gate, no kill. Dynamic `breakpoint` commands are the only breakpoint source
 * (T4.0 facts: they work headless; `break` pauses immediately with
 * `isUserBreakpoint=true, reason=''`; a game already paused when it connects
 * re-sends `debug_enter`; detach never leaves the game paused and leftover
 * breakpoints are ignored without a debugger — teardown is defensive).
 * @param options - the run parameters (mode='attach').
 * @param projectRoot - the validated project root.
 * @returns the structured run report with `detached: true` and `exit: null`.
 */
async function attachRun(options: DebugRunOptions, projectRoot: string): Promise<DebugRunResult> {
  // The caller must know the port to start the game with; a silently
  // auto-picked port is useless inside an atomic tool call.
  const port = options.port ?? 0
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new GodotError(
      'godot_debug: attach requires an explicit port 1-65535 (start the game with --remote-debug tcp://127.0.0.1:<port> AFTER this call; Godot does not retry a failed connection)',
      'GODOT_PARSE_ERROR',
    )
  }
  if (options.scene !== undefined) {
    throw new GodotError('godot_debug: scene is not supported in attach mode (the game is already running)', 'GODOT_PARSE_ERROR')
  }
  if (options.args !== undefined) {
    throw new GodotError('godot_debug: args are not supported in attach mode (the game is already running)', 'GODOT_PARSE_ERROR')
  }

  const controller = new DebugController({
    maxMessageBytes: options.maxMessageBytes,
    maxOutputBytes: options.maxOutputBytes,
  })

  try {
    try {
      await controller.listen(port)
    } catch (error) {
      // attach-specific mapping: bind failures (EADDRINUSE etc.) surface as
      // GODOT_UNAVAILABLE with the stage; launch's error surface is unchanged.
      throw new GodotError(
        `godot_debug: could not bind port ${port}: ${error instanceof Error ? error.message : String(error)}`,
        'GODOT_UNAVAILABLE',
      )
    }
    if (options.onPort !== undefined) await options.onPort(controller.port)

    try {
      await controller.waitForSetPid(options.connectWaitMs, options.signal)
    } catch (error) {
      if (error instanceof WaitTimeoutError) {
        throw new GodotError(
          `godot_debug: game did not connect to tcp://127.0.0.1:${port} within ${options.connectWaitMs}ms. `
          + `Start the game with --remote-debug tcp://127.0.0.1:${port} AFTER this call — Godot does not retry a failed connection (pinned, T4.0).`,
          'GODOT_UNAVAILABLE',
        )
      }
      throw error
    }

    // Dynamic breakpoints: the only attach source (no CLI --breakpoints).
    for (const bp of options.breakpoints) {
      controller.send('breakpoint', [toResPath(bp.file, projectRoot), bp.line, true])
    }
    if (options.pauseOnAttach === true) controller.send('break')

    const { stops, varsTruncated, expansion, expansionTruncated, edits, editsTruncated, sceneTrees, sceneTreeTruncated } =
      await collectStops(controller, options)

    return {
      stops,
      output: [...controller.output],
      errors: [...controller.errors],
      exit: null,
      detached: true,
      expansion,
      expandedObjects: expansion?.expandedObjects ?? 0,
      expansionTruncated,
      edits,
      editsApplied: edits?.results.filter(r => r.ok).length ?? 0,
      editsTruncated,
      sceneTrees,
      sceneTreeCount: sceneTrees?.length ?? 0,
      sceneTreeTruncated,
      outputTruncated: controller.outputTruncated,
      varsTruncated,
    }
  } catch (error) {
    if (controller.protocolFailure !== undefined && !(error instanceof GodotError)) {
      throw new GodotError(`godot_debug: protocol failure: ${controller.protocolFailure.message}`, 'GODOT_PARSE_ERROR')
    }
    throw error
  } finally {
    // Detach, on every path (success, error, cancellation): best-effort
    // breakpoint removal, best-effort continue, then dispose. Defensive —
    // T4.0 pinned that detaching never leaves the game paused and leftover
    // breakpoints are ignored without a debugger, but removal + continue are
    // cheap insurance against engine-version differences. Never kill: the
    // game is not owned by this tool.
    for (const bp of options.breakpoints) {
      try {
        controller.send('breakpoint', [toResPath(bp.file, projectRoot), bp.line, false])
      } catch {
        // best-effort
      }
    }
    try {
      controller.send('continue')
    } catch {
      // best-effort
    }
    await controller.dispose()
  }
}

/** Run `godot --version` through the seam (with the deployment wrapper argv). */
async function probeVersion(options: DebugRunOptions, executable: string): Promise<string> {
  const handle = options.subprocess.spawn({
    argv: [executable, ...options.executableArgs, '--version'],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4096 },
      stderr: { maxBytes: 4096 },
    },
    graceMs: options.graceMs,
    signal: options.signal,
  })
  const outcome = await handle.done
  if (outcome.exitCode !== 0) {
    throw new GodotError(`godot_debug: godot --version failed (code ${outcome.exitCode}): ${stderrTail(handle)}`, 'GODOT_UNAVAILABLE')
  }
  return handle.collected.stdout?.readFrom(0).text ?? ''
}

/** Wait for the game to connect and report `set_pid`, racing the process exit. */
async function waitForSetPid(
  controller: DebugController,
  handle: SubprocessHandle,
  options: DebugRunOptions,
): Promise<void> {
  const deadline = Date.now() + options.connectWaitMs
  let exitFacts: SubprocessOutcome | undefined
  const exitWatch = handle.done.then((facts) => {
    exitFacts = facts
  })
  for (;;) {
    throwIfAborted(options.signal)
    if (exitFacts !== undefined) {
      throw new GodotError(
        `godot_debug: game exited (code ${exitFacts.exitCode}) before connecting: ${stderrTail(handle)}`,
        'GODOT_UNAVAILABLE',
      )
    }
    if (Date.now() > deadline) {
      throw new GodotError(`godot_debug: game did not connect within ${options.connectWaitMs}ms: ${stderrTail(handle)}`, 'GODOT_UNAVAILABLE')
    }
    try {
      await controller.waitForSetPid(500, options.signal)
      void exitWatch
      return
    } catch (error) {
      if (error instanceof WaitTimeoutError) continue
      throw error
    }
  }
}

/** The stop → snapshot → continue loop, bounded by `maxStops`. On EVERY stop
 *  that has a frame, the Phase 7 scene-tree snapshot runs while still paused
 *  (a tree request answers even when running, T7.0 fact 3, but the pause is
 *  the natural point); on the FIRST frame-bearing stop the Phase 5 variable
 *  expansion and the Phase 6 variable edits also run, before continue. */
async function collectStops(
  controller: DebugController,
  options: DebugRunOptions,
): Promise<{
  stops: DebugStop[]
  varsTruncated: boolean
  expansion: { stopIndex: number; entries: ExpandedEntry[]; expandedObjects: number } | null
  expansionTruncated: boolean
  edits: { stopIndex: number; results: EditResult[] } | null
  editsTruncated: boolean
  sceneTrees: { stopIndex: number; root: SceneTreeNode; lines: string[] }[] | null
  sceneTreeTruncated: boolean
}> {
  const stops: DebugStop[] = []
  let varsTruncated = false
  let expanded = false
  let expansion: { stopIndex: number; entries: ExpandedEntry[]; expandedObjects: number } | null = null
  let expansionTruncated = false
  let edited = false
  let edits: { stopIndex: number; results: EditResult[] } | null = null
  let editsTruncated = false
  const sceneTrees: { stopIndex: number; root: SceneTreeNode; lines: string[] }[] = []
  let sceneTreeTruncated = false
  const runStart = Date.now()
  // The current stop's parsed tree (T15: nodePaths resolve against it).
  let stopTreeRoot: SceneTreeNode | null = null
  for (let i = 0; i < options.maxStops; i++) {    let stop: StopInfo
    try {
      stop = await controller.waitForStop(options.idleTimeoutMs, options.signal)
    } catch (error) {
      if (error instanceof WaitTimeoutError) break // no stop within budget (game ran through)
      if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE') break // game disconnected
      throw error
    }
    let snapshot: StopSnapshot
    try {
      controller.send('get_stack_dump')
      controller.send('get_stack_frame_vars', [0])
      const collected = await controller.waitForSnapshot(options.idleTimeoutMs, options.signal)
      snapshot = renderSnapshot(collected.dump, collected.vars, RENDER_OPTIONS)
      if (snapshot.frames.length > 0 && options.maxTreeNodes > 0) {
        // Scene tree on every frame-bearing stop (T7.0 facts 4/5: each
        // request answers in ~13 ms with the current tree; a static scene is
        // identical across stops — the per-stop snapshot is the semantics).
        // Tree budget: min(remaining run budget minus a settle margin, a
        // per-node worst case). Budget exhaustion skips the tree and flags.
        const remaining = options.timeoutMs - (Date.now() - runStart) - SCENE_TREE_SETTLE_MS
        const budgetMs = Math.max(0, Math.min(remaining, options.maxTreeNodes * 50))
        if (budgetMs <= 0) {
          sceneTreeTruncated = true // budget spent: no tree this stop
        } else {
          const treeWaitMs = Math.min(options.idleTimeoutMs, budgetMs)
          try {
            controller.send('scene:request_scene_tree')
            const resp = await controller.waitForMessage(
              m => m[0] === 'scene:scene_tree',
              treeWaitMs,
              options.signal,
              'scene:scene_tree',
            )
            const parsed = parseSceneTree(Array.isArray(resp[2]) ? resp[2] : undefined, options.maxTreeNodes)
            if (parsed.root !== null) {
              stopTreeRoot = parsed.root // T15: nodePaths / path: edits resolve against this stop's tree
              const { lines, truncated } = renderSceneTree(parsed.root, { maxNodes: options.maxTreeNodes, maxLineLength: 200 })
              if (truncated || parsed.truncated) sceneTreeTruncated = true
              sceneTrees.push({ stopIndex: i, root: parsed.root, lines })
            } else if (parsed.truncated) {
              sceneTreeTruncated = true
            }
          } catch (error) {
            if (error instanceof GodotError && error.code === 'GODOT_ABORTED') throw error
            if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE') {
              // Disconnected mid-tree: end the loop with the partial result.
              sceneTreeTruncated = true
              stops.push({ ...stop, snapshot })
              break
            }
            sceneTreeTruncated = true // timeout or malformed: skip this stop's tree
          }
        }
      }
      const wantsExpansion = options.maxExpandedObjects > 0
        || (options.expandNodes ?? []).length > 0
        || (options.nodePaths ?? []).length > 0
      if (!expanded && snapshot.frames.length > 0 && wantsExpansion) {
        expanded = true
        // Expansion budget: min(remaining run budget minus a settle margin,
        // the worst-case object×depth cap). Budget exhaustion skips the rest
        // and keeps the partial result — only an external cancel aborts
        // (pinned T5.2 review H2; depth budget T8.2). T15: explicit node ids
        // count toward the same cap (they expand first).
        const objectCap = Math.max(options.maxExpandedObjects, options.expandNodes?.length ?? 0, options.nodePaths?.length ?? 0)
        const remaining = options.timeoutMs - (Date.now() - runStart) - EXPANSION_SETTLE_MS
        const budgetMs = Math.max(0, Math.min(remaining, objectCap * options.maxExpandDepth * options.idleTimeoutMs))
        try {
          // T15: explicit node ids + scene-node paths resolve into one extra
          // id list (paths need this stop's tree — a frame-bearing stop
          // snapshots it above; unresolvable paths are skipped like timeouts).
          // The entry names carry the source: `node:<id>` for ids, the path
          // (`Main`) for path references — readable in the report.
          const pathIds = resolveNodePaths(stopTreeRoot, options.nodePaths ?? []).map(e => ({ name: e.path, id: e.id }))
          const idIds = (options.expandNodes ?? []).map(id => ({ name: `node:${id}`, id: BigInt(id) }))
          const extraIds = [...idIds, ...pathIds]
          const result = await expandObjects(collected.vars, controller, {
            maxObjects: options.maxExpandedObjects,
            maxProps: options.maxExpandedProps,
            maxDepth: options.maxExpandDepth,
            render: RENDER_OPTIONS,
            idleTimeoutMs: options.idleTimeoutMs,
            budgetMs,
            signal: options.signal,
            ...(extraIds.length > 0 ? { extraIds } : {}),
          })
          expansion = { stopIndex: i, entries: result.entries, expandedObjects: result.expandedObjects }
          if (result.expansionTruncated) expansionTruncated = true
        } catch (error) {
          if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE') {
            // Disconnected mid-expansion: end the loop with the partial result.
            expansionTruncated = true
            stops.push({ ...stop, snapshot })
            break
          }
          throw error
        }
      }
      if (!edited && snapshot.frames.length > 0 && options.edits !== undefined && options.edits.length > 0 && options.maxEdits > 0) {
        edited = true
        // Edit budget: min(remaining run budget minus a settle margin, the
        // worst-case edit cap). Budget exhaustion skips the rest and keeps
        // the partial results (plan D6).
        const remaining = options.timeoutMs - (Date.now() - runStart) - EDIT_SETTLE_MS
        const budgetMs = Math.max(0, Math.min(remaining, options.maxEdits * options.idleTimeoutMs))
        try {
          // T15: `path:` targets resolve against this stop's tree into
          // `node:<id>` form (an unresolvable path keeps its target and
          // fails the edit with the standard "not an editable object"
          // detail — the tree snapshot above ran before edits).
          const editsForApply = options.edits.map((edit) => {
            if (!edit.target.startsWith('path:')) return edit
            const resolved = resolveNodePaths(stopTreeRoot, [edit.target.slice('path:'.length)])[0]
            return resolved === undefined ? edit : { ...edit, target: `node:${resolved.id}` }
          })
          const result = await applyEdits(editsForApply, collected.vars, controller, {
            maxEdits: options.maxEdits,
            idleTimeoutMs: options.idleTimeoutMs,
            budgetMs,
            signal: options.signal,
          })
          edits = { stopIndex: i, results: result.results }
          if (result.truncated) editsTruncated = true
        } catch (error) {
          if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE') {
            // Disconnected mid-edits: end the loop with the partial result.
            editsTruncated = true
            stops.push({ ...stop, snapshot })
            break
          }
          throw error
        }
      }
    } catch (error) {
      if (error instanceof WaitTimeoutError || (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE')) {
        snapshot = renderSnapshot([0], [], RENDER_OPTIONS) // partial stop: no variable data
        varsTruncated = true
        stops.push({ ...stop, snapshot })
        break
      }
      throw error
    }
    stops.push({ ...stop, snapshot })
    controller.send('continue')
  }
  return {
    stops,
    varsTruncated,
    expansion,
    expansionTruncated,
    edits,
    editsTruncated,
    sceneTrees: sceneTrees.length > 0 ? sceneTrees : null,
    sceneTreeTruncated,
  }
}

/** Margin kept after expansion so the run can settle within `timeoutMs`. */
const EXPANSION_SETTLE_MS = 5_000

/** Margin kept after edits so the run can settle within `timeoutMs`. */
const EDIT_SETTLE_MS = 5_000

/** Margin kept after the scene-tree snapshot so the run can settle. */
const SCENE_TREE_SETTLE_MS = 5_000

/** Collect the exit facts: a short natural-exit window, then terminate. */
async function settleExit(handle: SubprocessHandle, idleTimeoutMs: number): Promise<SubprocessOutcome> {
  const natural = await Promise.race([handle.done, sleep(Math.min(idleTimeoutMs, 2_000))])
  if (natural !== undefined) return natural
  handle.terminate()
  return handle.done
}
