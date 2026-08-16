/**
 * The `godot_debug` run pipeline: one bounded scripted debug run. Validates
 * the project and breakpoints, gates the godot version (4.2+), pre-picks a
 * port (lsp-godot's `pickFreePort`), spawns the headless game with
 * `--remote-debug`, waits for `set_pid`, then loops stop → snapshot →
 * continue up to `maxStops`, and terminates the process tree. Protocol and
 * process facts are pinned in `.context/t3/facts.md`.
 * @module @deepseek-ai/dsh-tool-godot-debug/tool
 */

import { statSync } from 'node:fs'
import { relative, isAbsolute, sep } from 'node:path'
import { verifyGodotVersion, pickFreePort } from '@deepseek-ai/dsh-lsp-godot'
import type { SubprocessLike } from '@deepseek-ai/dsh-lsp-godot'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { DebugController, WaitTimeoutError, type GodotRuntimeError } from './controller.ts'
import { GodotError } from './error.ts'
import { renderSnapshot, type RenderOptions, type StopSnapshot } from './snapshot.ts'

/** One requested breakpoint: a `res://` path or an absolute file path plus a 1-based line. */
export interface DebugBreakpoint {
  file: string
  line: number
}

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
  snapshot: StopSnapshot
}

/** The structured result of one complete debug run. */
export interface DebugRunResult {
  stops: DebugStop[]
  output: string[]
  errors: GodotRuntimeError[]
  /** The spawned game's exit facts after the run ended (terminated or natural). */
  exit: SubprocessOutcome | null
  outputTruncated: boolean
  /** Any stop whose variable snapshot was incomplete (protocol stall/disconnect). */
  varsTruncated: boolean
}

/** One run's parameters, assembled by the tool layer from config and arguments. */
export interface DebugRunOptions {
  /** Godot executable path or PATH command name (resolved by the seam). */
  executable: string
  /** Fixed argv elements inserted after the executable. */
  executableArgs: string[]
  /** The project root (must contain project.godot). */
  projectRoot: string
  /** Scene to run; omitted = the project's main scene. */
  scene?: string
  /** Breakpoints to set via `--breakpoints` (CLI form, single-colon `res://f:l`). */
  breakpoints: DebugBreakpoint[]
  /** Max stops before the run is collected (default 10). */
  maxStops: number
  /** Cooperative budget for the whole run, enforced through the signal. */
  timeoutMs: number
  /** Remote-debug port; 0 or omitted = auto-pick a free port (lsp-godot's `pickFreePort`). */
  port?: number
  /** Budget for the game to connect after spawn. */
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
  /** Extra argv passed to the game after `--`. */
  args?: string[]
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

/** Convert a breakpoint file to the `res://` form the protocol expects. */
function toResPath(file: string, projectRoot: string): string {
  if (file.startsWith('res://')) {
    if (file.includes('/../')) throw new GodotError(`godot_debug: breakpoint ${file} escapes the project`, 'GODOT_PARSE_ERROR')
    return file
  }
  const abs = isAbsolute(file) ? file : `${process.cwd()}${sep}${file}`
  const rel = relative(projectRoot, abs)
  if (rel.startsWith('..')) throw new GodotError(`godot_debug: breakpoint ${file} is outside the project`, 'GODOT_PARSE_ERROR')
  return `res://${rel.replace(/\\/g, '/')}`
}

/**
 * Run one bounded debug session. The call settles only after the run ends,
 * the budget elapses, or the caller cancels; the game process is terminated
 * on every path.
 * @param options - the run parameters.
 * @returns the structured run report.
 */
export async function runDebug(options: DebugRunOptions): Promise<DebugRunResult> {
  throwIfAborted(options.signal)

  // Project validation.
  let projectRoot: string
  try {
    projectRoot = options.projectRoot
    if (!statSync(projectRoot).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new GodotError(`godot_debug: project root ${options.projectRoot} is not a readable directory`, 'GODOT_PARSE_ERROR')
  }
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
    const { stops, varsTruncated } = await collectStops(controller, options)
    const exit = await settleExit(handle, options.idleTimeoutMs)

    return {
      stops,
      output: [...controller.output],
      errors: [...controller.errors],
      exit,
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

/** The stop → snapshot → continue loop, bounded by `maxStops`. */
async function collectStops(
  controller: DebugController,
  options: DebugRunOptions,
): Promise<{ stops: DebugStop[]; varsTruncated: boolean }> {
  const stops: DebugStop[] = []
  let varsTruncated = false
  for (let i = 0; i < options.maxStops; i++) {
    let stop: { isUserBreakpoint: boolean; reason: string }
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
  return { stops, varsTruncated }
}

/** Collect the exit facts: a short natural-exit window, then terminate. */
async function settleExit(handle: SubprocessHandle, idleTimeoutMs: number): Promise<SubprocessOutcome> {
  const natural = await Promise.race([handle.done, sleep(Math.min(idleTimeoutMs, 2_000))])
  if (natural !== undefined) return natural
  handle.terminate()
  return handle.done
}
