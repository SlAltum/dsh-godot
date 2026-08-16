/**
 * Shared execution plumbing for the godot tool suite: the package-owned
 * `GODOT_*` error vocabulary, godot/gdformat executable resolution, Godot
 * project-root discovery, and one spawn helper that runs an executable with a
 * plain argv vector and returns collected stdout/stderr within the configured
 * budgets. Every tool executes as an ordinary foreground spawn through
 * `ctx.subprocess` — never `ctx.shell`, never a model-visible background
 * task, no shell layer between the argv vector and the executable, so no
 * shell quoting is involved. Process concerns (spawn execution, tree
 * termination, environment scrubbing, output capture) stay behind the
 * subprocess seam.
 *
 * @module @deepseek-ai/dsh-tool-godot/godot-core
 */

import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** The Godot project marker file `findProjectRoot` looks for. */
export const PROJECT_FILE = 'project.godot'

/** Max directory levels `findProjectRoot` walks up from its start directory. */
export const MAX_PROJECT_ROOT_WALK = 10

/**
 * Stable, machine-routable codes for godot tool failures. Package-owned (not
 * a seam vocabulary) because these tools are spawn-backed CLI workflows, not
 * seam provider operations: `GODOT_UNAVAILABLE` — the godot/gdformat
 * executable could not be resolved or launched (a missing binary, a rejected
 * launch, no collected output streams); `GODOT_FORMAT_UNAVAILABLE` — the
 * gdformat invocation itself failed (missing module, crash), as opposed to a
 * formatter rejection of the file's syntax; `GODOT_PARSE_ERROR` — the tool
 * could not read, locate, or parse a project/scene/resource file, or
 * gdformat rejected the file as invalid GDScript; `GODOT_ABORTED` — the
 * cooperative tool timeout or caller cancellation cut the run short.
 */
export type GodotErrorCode =
  | 'GODOT_UNAVAILABLE'
  | 'GODOT_FORMAT_UNAVAILABLE'
  | 'GODOT_PARSE_ERROR'
  | 'GODOT_ABORTED'

/**
 * Typed godot-tool failure. Extends {@link HarnessError} so it carries a
 * stable {@link GodotErrorCode} and chains `cause`; the tool registry exposes
 * `{ name, code }` on `isError` results so retry/permission/UI layers can
 * branch without parsing messages.
 */
export class GodotError extends HarnessError {
  override readonly code: GodotErrorCode

  constructor(message: string, code: GodotErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** A resolved external executable: the binary plus a fixed argv prefix. */
export interface GodotExecutable {
  /** The executable path or PATH-resolved command name. */
  executable: string
  /** Fixed argv elements inserted right after the executable (deployment wrappers). */
  args: readonly string[]
}

/**
 * Resolve a configured executable string (a path or a command name) with its
 * argv prefix. A blank configuration falls back to the default command name.
 *
 * @param configured - the configured executable, or `undefined`.
 * @param configuredArgs - the configured argv prefix, or `undefined`.
 * @param fallback - the default command name when `configured` is blank.
 * @returns the resolved executable and its argv prefix.
 */
export function resolveExecutable(
  configured: string | undefined,
  configuredArgs: readonly string[] | undefined,
  fallback: string,
): GodotExecutable {
  const executable = configured !== undefined && configured.trim().length > 0 ? configured : fallback
  return { executable, args: [...(configuredArgs ?? [])] }
}

/**
 * Walk up from `startDir` (at most {@link MAX_PROJECT_ROOT_WALK} levels) and
 * return the first directory that contains `project.godot`. An unreadable or
 * missing directory stops the walk with `null`; so does reaching the
 * filesystem root.
 *
 * @param startDir - the directory to start walking from.
 * @returns the nearest ancestor project root, or `null` when none is found.
 */
export async function findProjectRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir)
  for (let depth = 0; depth <= MAX_PROJECT_ROOT_WALK; depth += 1) {
    try {
      if ((await readdir(current)).includes(PROJECT_FILE)) return current
    } catch {
      return null
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/**
 * Resolve the Godot project root for a tool call: an explicit `path` argument
 * (a project directory or any file inside the project) or the session cwd,
 * resolved to an absolute path, then discovered upward from there. A path
 * that is a file (or that does not exist) starts discovery from its parent
 * directory; when no ancestor carries `project.godot`, the start directory
 * itself is returned so the godot CLI reports the real error.
 *
 * @param path - the optional `path` argument (project root or file).
 * @param workdir - the fallback start directory (the session cwd).
 * @returns the resolved project root.
 */
export async function resolveProjectRoot(path: string | undefined, workdir: string): Promise<string> {
  const raw = path !== undefined && path.trim().length > 0 ? path : workdir
  const target = resolve(workdir, raw)
  let start = target
  try {
    if (!(await stat(target)).isDirectory()) start = dirname(target)
  } catch {
    start = dirname(target)
  }
  return (await findProjectRoot(start)) ?? start
}

/** The capture budgets every godot spawn shares. */
export interface GodotCaps {
  /** Max bytes retained for one run's stdout. */
  stdoutMaxBytes: number
  /** Max bytes retained for one run's stderr. */
  stderrMaxBytes: number
  /** Terminate-escalation grace period (ms), bounded by `MAX_TIMER_DELAY_MS`. */
  graceMs: number
}

/**
 * The per-call resolved caps of the whole tool suite: executables resolved
 * from the authoritative config (settings section over the composition
 * entry) plus every numeric cap. Read fresh on every tool call so settings
 * changes apply without re-registering tools.
 */
export interface ResolvedCaps extends GodotCaps {
  /** The resolved godot executable and its fixed argv prefix. */
  godot: GodotExecutable
  /** The resolved gdformat executable and its fixed argv prefix. */
  gdformat: GodotExecutable
  /** `godot_format` backend: `gdformat` (gdtoolkit) or `builtin` (embedded). */
  formatBackend: 'gdformat' | 'builtin'
  /** Builtin backend: max consecutive blank lines inside the file. */
  builtinMaxEmptyLines: number
  /** Builtin backend: remove extra space inside function parameter lists. */
  builtinDenseFunctionParameters: boolean
  /** Builtin backend: spaces before an end-of-line comment (`1` or `2`). */
  builtinSpacesBeforeEndOfLineComment: 1 | 2
  /** Max issues one `godot_validate` result retains inline. */
  validateMaxErrors: number
  /** Cooperative tool-call budget (ms) attached as `ToolDefinition.timeoutMs`. */
  timeoutMs: number
}

/** The completed acquisition of one run: exit status plus the collected streams. */
export interface GodotRun {
  /** Process exit code, or `null` when killed by a signal. */
  exitCode: number | null
  /** The signal that killed the process, or `null` when it exited. */
  signal: string | null
  /** The retained stdout text (complete within the requested budget). */
  stdout: string
  /** The retained stderr text (complete within the requested budget). */
  stderr: string
  /** True when the subprocess seam dropped stdout bytes past the budget. */
  stdoutTruncated: boolean
  /** True when the subprocess seam dropped stderr bytes past the budget. */
  stderrTruncated: boolean
  /** The resolved working directory the command ran in (the display-relativization base). */
  workdir: string
}

/**
 * Run one executable with a plain argv vector through the subprocess seam and
 * return its collected output. The working directory is the calling agent's
 * session cwd when available, else `process.cwd()`. `exec.signal` is
 * forwarded so the cooperative tool timeout
 * (`@deepseek-ai/dsh-tool-call-timeout-policy`) and caller cancellation
 * terminate the process tree.
 *
 * Exit semantics are tool-owned: the run is returned with its exit code and
 * signal for the tool to classify as a domain outcome. Launch-time and
 * infrastructure failures throw: a synchronous spawn-creation rejection, a
 * `handle.done` infrastructure rejection, missing collected streams, and an
 * abort already observed by spawn time all become typed `GodotError`s
 * (`GODOT_ABORTED` for the abort races, `GODOT_UNAVAILABLE` for the rest).
 *
 * @param ctx - the plugin context; execution uses its `subprocess` service.
 * @param exec - the tool-execution context; supplies the session cwd and the abort signal.
 * @param toolName - the calling tool, used in error messages.
 * @param executable - the resolved executable and its fixed argv prefix.
 * @param argv - the command arguments (every value a plain argv element).
 * @param caps - the capture budgets and terminate grace.
 * @returns the completed run.
 */
export async function runGodot(
  ctx: Context,
  exec: ToolExecution,
  toolName: string,
  executable: GodotExecutable,
  argv: readonly string[],
  caps: GodotCaps,
): Promise<GodotRun> {
  if (exec.signal.aborted) {
    throw new GodotError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'GODOT_ABORTED')
  }
  const cwd = exec.agent?.session.header.cwd
  const workdir = cwd ?? process.cwd()
  let handle: SubprocessHandle
  try {
    handle = ctx.subprocess.spawn({
      argv: [executable.executable, ...executable.args, ...argv],
      cwd: workdir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: caps.stdoutMaxBytes },
        stderr: { maxBytes: caps.stderrMaxBytes },
      },
      graceMs: caps.graceMs,
      signal: exec.signal,
    } satisfies SubprocessSpawnSpec)
  } catch (error: unknown) {
    // Node's spawn() throws synchronously for a NUL in argv, and the local
    // impl can throw synchronously when the signal aborts between the check
    // above and this call. The static narrowing that proves this re-check
    // "always false" cannot see AbortSignal state changes.
    /* v8 ignore start -- the abort racing a synchronous spawn throw cannot be
       driven deterministically; the re-check mirrors search-core's defensive
       handling of the spawn-creation race. */
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (exec.signal.aborted) {
      throw new GodotError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'GODOT_ABORTED')
    }
    /* v8 ignore stop */
    throw new GodotError(`${toolName} could not start its command (${executable.executable} launch failed)`, 'GODOT_UNAVAILABLE', { cause: error })
  }
  let outcome: SubprocessOutcome
  try {
    outcome = await handle.done
  } catch (error: unknown) {
    throw new GodotError(`${toolName} could not start its command (${executable.executable} launch failed)`, 'GODOT_UNAVAILABLE', { cause: error })
  }
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  /* v8 ignore start -- the local subprocess impl always supplies collected
     streams for a successful spawn; a provider contract violation cannot be
     driven in tests. */
  if (stdout === undefined || stderr === undefined) {
    throw new GodotError(`${toolName} command produced no collected output streams`, 'GODOT_UNAVAILABLE')
  }
  /* v8 ignore stop */
  // The signal can abort while the spawn is awaited; the static narrowing that
  // proves this re-check "always false" cannot see AbortSignal state changes.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (exec.signal.aborted) {
    throw new GodotError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'GODOT_ABORTED')
  }
  return {
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.lossy,
    stderrTruncated: stderr.lossy,
    workdir,
  }
}

/**
 * Map a path to its display form: absolute paths inside the resolved workdir
 * become workdir-relative; everything else passes through unchanged.
 * Display-only — returned paths are follow-up-readable in co-located
 * deployments where the workdir and the filesystem `read` root are the same
 * workspace.
 *
 * @param path - one path as produced by the tool.
 * @param workdir - the resolved workdir the command ran in.
 * @returns the workdir-relative display path when possible, else `path`.
 */
export function displayPath(path: string, workdir: string): string {
  if (!isAbsolute(path)) return path
  const rel = relative(workdir, path)
  if (rel.length === 0) return '.'
  if (rel === '..' || rel.startsWith(`..${sep}`)) return path
  return rel
}

/**
 * Map a Godot diagnostic `at:` path to its display form: `res://` paths are
 * already project-relative and lose the scheme; absolute paths relativize
 * against the project root; anything else passes through unchanged.
 *
 * @param issuePath - the `at:` path as godot printed it.
 * @param projectRoot - the resolved project root.
 * @returns the display path.
 */
export function resToRelative(issuePath: string, projectRoot: string): string {
  if (issuePath.startsWith('res://')) return issuePath.slice('res://'.length)
  return displayPath(issuePath, projectRoot)
}
