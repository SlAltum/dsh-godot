/**
 * The model-facing `godot_run_scene` tool: run one Godot scene headless
 * (`--quit-after N` optional) and return the captured output. Execution
 * spawns the configured godot executable through the subprocess seam with a
 * plain argv vector; this module owns the schema, argument validation, argv
 * construction, rendering, and presentation.
 *
 * @module @deepseek-ai/dsh-tool-godot/run-scene
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { resolveProjectRoot, runGodot } from './godot-core.ts'
import type { ResolvedCaps } from './godot-core.ts'

/** Validated `godot_run_scene` arguments. */
export interface RunSceneInput {
  scene: string
  path?: string
  frames?: number
  args?: string[]
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `scene`, a positive integer `frames`, and a non-blank `path` when given.
 * Throws a plain `Error` (an ordinary tool argument error) otherwise.
 *
 * @param args - the schema-validated arguments.
 * @returns the accepted input.
 */
export function parseRunSceneArgs(args: { scene: string; path?: string; frames?: number; args?: string[] }): RunSceneInput {
  if (args.scene.trim().length === 0) throw new Error('scene must be a non-empty string')
  if (args.frames !== undefined && (!Number.isInteger(args.frames) || args.frames < 1)) throw new Error('frames must be a positive integer')
  if (args.path !== undefined && args.path.trim().length === 0) throw new Error('path must be a non-empty string when given')
  return {
    scene: args.scene,
    ...(args.path !== undefined ? { path: args.path } : {}),
    ...(args.frames !== undefined ? { frames: args.frames } : {}),
    args: args.args ?? [],
  }
}

/**
 * Build the godot argv for one scene run: `--headless --path <root>`, an
 * optional `--quit-after <frames>`, the scene, then the user args after `--`
 * (readable via `OS.get_cmdline_user_args()`). Every model-controlled value
 * is a plain argv element.
 *
 * @param root - the resolved project root.
 * @param scene - the scene path (res:// or filesystem).
 * @param frames - optional frame count to quit after.
 * @param userArgs - the user arguments passed after `--`.
 * @returns the complete argv (excluding the executable itself).
 */
export function buildRunSceneCommand(root: string, scene: string, frames?: number, userArgs: readonly string[] = []): string[] {
  return [
    '--headless',
    '--path',
    root,
    ...(frames !== undefined ? ['--quit-after', String(frames)] : []),
    scene,
    ...(userArgs.length > 0 ? ['--', ...userArgs] : []),
  ]
}

/** The canonical `godot_run_scene` result. */
export interface RunSceneResult {
  /** The resolved project root the scene ran under. */
  projectRoot: string
  /** The scene path as requested. */
  scene: string
  /** The process exit code, present when the process exited (omitted when killed by a signal). */
  exitCode?: number
  /** The signal that killed the process, present when killed (omitted when it exited). */
  signal?: string
  /** The retained stdout. */
  output: string
  /** The retained stderr. */
  stderr: string
  /** True when the run exited cleanly. */
  ok: boolean
  /** True when the subprocess seam dropped stdout bytes past the budget. */
  stdoutTruncated: boolean
  /** True when the subprocess seam dropped stderr bytes past the budget. */
  stderrTruncated: boolean
}

/**
 * Format the model-facing `godot_run_scene` result text: an exit head,
 * truncation notes, the stdout body, and a stderr tail when present.
 *
 * @param value - the canonical result.
 * @returns the model-facing text.
 */
export function renderRunSceneOutput(value: RunSceneResult): string {
  const exit = value.signal !== undefined ? `signal ${value.signal}` : `code ${value.exitCode}`
  const notes: string[] = []
  if (value.stdoutTruncated) notes.push('(stdout truncated)')
  if (value.stderrTruncated) notes.push('(stderr truncated)')
  const note = notes.length > 0 ? ` ${notes.join(' ')}` : ''
  const body = value.output.length > 0 ? value.output : '(no output)'
  const stderr = value.stderr.length > 0 ? `\nstderr:\n${value.stderr}` : ''
  return `Godot scene ${value.scene} exited with ${exit}${note}\n${body}${stderr}`
}

/**
 * Pending-call presentation: a generic card titled by the scene.
 *
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the call runs.
 */
export function presentRunSceneCall(args: { scene: string; path?: string; frames?: number; args?: string[] }): GenericCallView {
  const where = args.path !== undefined ? ` in ${args.path}` : ''
  const frames = args.frames !== undefined ? ` (${args.frames} frames)` : ''
  return { card: 'generic', title: `Run Godot scene ${args.scene}${where}${frames}` }
}

/**
 * Register the `godot_run_scene` tool.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param caps - per-call resolved caps thunk (settings section over the composition entry).
 */
export function applyRunSceneTool(ctx: Context, caps: () => ResolvedCaps): void {
  const tool = defineTool({
    name: 'godot_run_scene',
    description:
      'Run a Godot scene headless with the configured godot executable and return the captured output. '
      + 'frames quits after that many rendered frames (no explicit quit otherwise); args are passed after -- and readable via OS.get_cmdline_user_args(). '
      + 'A non-zero exit is reported in the result, not as an error. Requires a godot executable configured or on PATH.',
    parameters: {
      scene: {
        type: 'string',
        required: true,
        description: 'The scene to run (res:// path or a filesystem path inside the project).',
      },
      path: {
        type: 'string',
        description: 'Project root. Defaults to the session workspace; a relative path resolves against it. Discovery walks up for project.godot.',
      },
      frames: {
        type: 'number',
        description: 'Quit after this many rendered frames (godot --quit-after).',
      },
      args: {
        type: 'array',
        description: 'User arguments passed after -- (OS.get_cmdline_user_args()).',
        items: { type: 'string' },
      },
    },
    timeoutMs: caps().timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectRoot: { type: 'string', required: true },
          scene: { type: 'string', required: true },
          exitCode: { type: 'number' },
          signal: { type: 'string' },
          output: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          stdoutTruncated: { type: 'boolean', required: true },
          stderrTruncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderRunSceneOutput(value) }],
    },
    async execute(args, exec) {
      const c = caps()
      const input = parseRunSceneArgs(args)
      const workdir = exec.agent?.session.header.cwd ?? process.cwd()
      const projectRoot = await resolveProjectRoot(input.path, workdir)
      const run = await runGodot(ctx, exec, 'godot_run_scene', c.godot, buildRunSceneCommand(projectRoot, input.scene, input.frames, input.args), c)
      return {
        projectRoot,
        scene: input.scene,
        /* v8 ignore next 1 -- a signal-killed run cannot be driven deterministically in tests */
        ...(run.signal !== null ? { signal: run.signal } : run.exitCode !== null ? { exitCode: run.exitCode } : {}),
        output: run.stdout,
        stderr: run.stderr,
        ok: run.exitCode === 0 && run.signal === null,
        stdoutTruncated: run.stdoutTruncated,
        stderrTruncated: run.stderrTruncated,
      }
    },
    presentCall: presentRunSceneCall,
  })
  ctx.tools.register(tool)
}
