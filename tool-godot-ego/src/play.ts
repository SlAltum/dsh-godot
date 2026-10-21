/**
 * `godot_play`: start (or reuse) the workspace's game session.
 *
 * This module owns the process side the registry does not: project resolution,
 * the one-time `--headless --editor --import` pass, the two temporary
 * GDScript files, the spawn spec (argv + environment), and the inverse that
 * removes the temp directory after the session is disposed.
 *
 * Plan facts baked in: Godot 4's window flags are `--position X,Y` /
 * `--windowed` (no `--window-position`), ports and the token travel through
 * the environment (never argv after `--`), and the bridge script lives outside
 * the project so `project.godot` is never touched.
 * @module @deepseek-ai/dsh-tool-godot-ego/play
 */

import { randomUUID } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { resolveExecutable, resolveProjectRoot } from '@deepseek-ai/dsh-tool-godot'
import type { GodotExecutable, GodotToolchain } from '@deepseek-ai/dsh-tool-godot'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { bootstrapSource, bridgeSource } from './bridge-source.ts'
import type { ResolvedEgoConfig } from './config.ts'
import { EgoGodotError } from './errors.ts'
import { GameSession } from './session.ts'
import type { GameSessionRegistry } from './session-service.ts'
import type { EgoPlayOptions, EgoSessionFactory, EgoSessionHandle } from './session-service.ts'

/** Default window size requested from the engine. */
const DEFAULT_RESOLUTION = '1280x720'

/** Bytes retained per spawned-process stream. */
const STREAM_MAX_BYTES = 1_000_000

/** Everything {@link buildSpawnSpec} needs. */
export interface SpawnSpecInput {
  readonly executable: GodotExecutable
  readonly projectRoot: string
  readonly bootPath: string
  readonly bridgePath: string
  readonly port: number
  readonly token: string
  readonly allowEval: boolean
  readonly offscreen: boolean
  readonly maxFps: number
  readonly fixedFps: number
  readonly graceMs: number
  /** Scene to start instead of the project's main scene (`res://` path). */
  readonly scene?: string
}

/**
 * Build the spawn request for one game session.
 * @param input - resolved executable, paths, endpoint, and display flags.
 * @returns the fully specified spawn request.
 */
export function buildSpawnSpec(input: SpawnSpecInput): SubprocessSpawnSpec {
  const argv = [
    input.executable.executable,
    ...input.executable.args,
    '--path', input.projectRoot,
    '--script', input.bootPath,
    '--windowed',
    '--resolution', DEFAULT_RESOLUTION,
  ]
  if (input.offscreen) argv.push('--position', '-32000,-32000')
  if (input.fixedFps > 0) argv.push('--fixed-fps', String(input.fixedFps))
  else if (input.maxFps > 0) argv.push('--max-fps', String(input.maxFps))
  return {
    argv,
    cwd: input.projectRoot,
    // The user operates the running scene in its native window; the generic
    // subprocess default hides GUI windows, so ask for a visible one.
    windowsHide: false,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: STREAM_MAX_BYTES },
      stderr: { maxBytes: STREAM_MAX_BYTES },
    },
    graceMs: input.graceMs,
    env: {
      DSH_EGO_PORT: String(input.port),
      DSH_EGO_TOKEN: input.token,
      DSH_EGO_BRIDGE: input.bridgePath,
      DSH_EGO_SCENE: input.scene ?? '',
      DSH_EGO_ALLOW_EVAL: input.allowEval ? '1' : '0',
    },
  }
}

/**
 * Run the one-time import pass when the project has no `.godot` cache.
 * @param ctx - plugin context (uses the `subprocess` seam).
 * @param executable - the resolved Godot executable.
 * @param projectRoot - the project root to import.
 * @param importTimeoutMs - budget for the pass.
 * @param graceMs - terminate-escalation grace.
 * @returns whether an import ran.
 * @throws EgoGodotError `GODOT_EGO_TIMEOUT` when the pass overruns,
 *   `GODOT_EGO_NOT_IMPORTED` when it exits non-zero or cannot start.
 */
export async function ensureImported(
  ctx: Context,
  executable: GodotExecutable,
  projectRoot: string,
  importTimeoutMs: number,
  graceMs: number,
): Promise<boolean> {
  try {
    await access(join(projectRoot, '.godot'))
    return false
  } catch {
    // No cache yet: fall through to the editor import pass.
  }
  let handle: SubprocessHandle
  try {
    handle = ctx.subprocess.spawn({
      argv: [...[executable.executable], ...executable.args, '--headless', '--editor', '--path', projectRoot, '--import'],
      cwd: projectRoot,
      stdio: { stdin: 'ignore', stdout: { maxBytes: STREAM_MAX_BYTES }, stderr: { maxBytes: STREAM_MAX_BYTES } },
      graceMs,
    })
  } catch (error: unknown) {
    throw new EgoGodotError('could not start the Godot import pass', 'GODOT_EGO_NOT_IMPORTED', { cause: error })
  }
  let timer!: ReturnType<typeof setTimeout>
  let result: SubprocessOutcome | 'timeout'
  try {
    result = await Promise.race([
      handle.done,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          handle.terminate()
          resolve('timeout')
        }, importTimeoutMs)
      }),
    ])
  } catch (error: unknown) {
    throw new EgoGodotError('the Godot import pass failed to run', 'GODOT_EGO_NOT_IMPORTED', { cause: error })
  } finally {
    clearTimeout(timer)
  }
  if (result === 'timeout') {
    throw new EgoGodotError(`Godot import did not finish within ${importTimeoutMs} ms`, 'GODOT_EGO_TIMEOUT')
  }
  if (result.exitCode !== 0) {
    const tail = handle.collected.stderr?.readFrom(0).text ?? ''
    const detail = tail === '' ? '' : `: ${tail.trim().slice(-500)}`
    throw new EgoGodotError(`Godot import exited with code ${String(result.exitCode)}${detail}`, 'GODOT_EGO_NOT_IMPORTED')
  }
  return true
}

/**
 * Resolve the sandbox executable. An explicit `executable` wins; an empty one
 * inherits the live `tool-godot` value, so the settings card stays the single
 * place to configure the Godot path. Without a toolchain, fall back to `godot`.
 * @param config - resolved sandbox config.
 * @param toolchain - the sibling tool-godot service, when mounted.
 * @returns the executable and wrapper args.
 */
export function resolveEgoExecutable(config: ResolvedEgoConfig, toolchain?: GodotToolchain): GodotExecutable {
  const explicit = config.executable.trim() !== ''
  const inherited = explicit ? undefined : toolchain?.resolve()
  return resolveExecutable(
    explicit ? config.executable : inherited?.executable,
    config.executableArgs.length > 0 ? config.executableArgs : inherited?.args,
    'godot',
  )
}

/**
 * Start one session for a workspace.
 * @param ctx - plugin context (uses the `subprocess` seam).
 * @param config - resolved plugin config.
 * @param workspace - the workspace key.
 * @param options - start options (`restart` is handled by the registry).
 * @returns the session handle, whose `dispose` also removes the temp scripts.
 */
export async function startSession(
  ctx: Context,
  config: ResolvedEgoConfig,
  workspace: string,
  options: EgoPlayOptions,
): Promise<EgoSessionHandle> {
  const projectRoot = await resolveProjectRoot(options.path, workspace)
  const toolchain = (ctx as { get?: (name: string) => unknown }).get?.('godot.toolchain') as GodotToolchain | undefined
  const executable = resolveEgoExecutable(config, toolchain)
  const imported = await ensureImported(ctx, executable, projectRoot, config.importTimeoutMs, config.graceMs)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-godot-ego-'))
  const bridgePath = join(directory, 'bridge.gd')
  const bootPath = join(directory, 'boot.gd')
  let gameHandle!: SubprocessHandle
  try {
    await writeFile(bridgePath, bridgeSource({ allowEval: config.allowEval }), 'utf8')
    await writeFile(bootPath, bootstrapSource({ bridgePath }), 'utf8')
    const session = new GameSession({
      sessionId: randomUUID(),
      workspace,
      handshakeTimeoutMs: config.requestTimeoutMs,
      requestTimeoutMs: config.requestTimeoutMs,
      graceMs: config.graceMs,
      spawnGame: ({ port, token }) => {
        const spawned = ctx.subprocess.spawn(buildSpawnSpec({
          executable,
          projectRoot,
          bootPath,
          bridgePath,
          port,
          token,
          allowEval: config.allowEval,
          offscreen: options.offscreen ?? config.offscreen,
          maxFps: options.maxFps ?? config.maxFps,
          fixedFps: options.fixedFps ?? config.fixedFps,
          graceMs: config.graceMs,
          ...(options.scene !== undefined ? { scene: options.scene } : {}),
        }))
        gameHandle = spawned
        return spawned
      },
    })
    await session.start()
    return {
      sessionId: session.sessionId,
      workspace,
      get pid(): number | null { return session.snapshot().pid },
      imported,
      projectRoot,
      async dispose(): Promise<void> {
        try {
          await session.dispose()
        } finally {
          await removeTempDir(directory)
        }
      },
      async stop(): Promise<{ exitCode: number | null; signal: string | null }> {
        try {
          return await session.stop()
        } finally {
          await removeTempDir(directory)
        }
      },
      request: (cmd, params, signal) => session.request(cmd, params, signal),
      snapshot: () => session.snapshot(),
      logs(since = 0, maxBytes = 4096) {
        const stdout = gameHandle.collected.stdout?.readFrom(since)
        const stderr = gameHandle.collected.stderr?.readFrom(since)
        return {
          stdout: (stdout?.text ?? '').slice(0, maxBytes),
          stderr: (stderr?.text ?? '').slice(0, maxBytes),
          nextOffset: stdout?.nextOffset ?? since,
        }
      },
    }
  } catch (error: unknown) {
    await removeTempDir(directory)
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new EgoGodotError(
        `${error.message}. Tried "${executable.executable}". Configure the Godot path in the tool-godot settings card, or set tool-godot-ego.executable.`,
        'GODOT_EGO_UNAVAILABLE',
        { cause: error },
      )
    }
    throw error
  }
}

/** Best-effort removal of the session's temp scripts (never masks the caller's error). */
async function removeTempDir(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true })
  } catch {
    // A cleanup failure must not replace the failure that caused the cleanup.
  }
}

/**
 * Build the registry factory bound to one plugin context and config.
 * @param ctx - plugin context (uses the `subprocess` seam).
 * @param config - resolved plugin config.
 * @returns the factory the session registry calls for each workspace.
 */
export function createPlayFactory(ctx: Context, config: ResolvedEgoConfig): EgoSessionFactory {
  return (workspace, options) => startSession(ctx, config, workspace, options)
}

/** What `godot_play` returns to the model. */
export interface PlayResult {
  readonly sessionId: string
  readonly pid?: number
  readonly created: boolean
  readonly running: true
}

/** `godot_play` arguments (schema-validated by the tool runtime). */
export interface PlayArgs {
  path?: string
  scene?: string
  offscreen?: boolean
  maxFps?: number
  fixedFps?: number
  restart?: boolean
}

/** Model-facing one-liner for a started or reused session. */
function renderPlay(value: { sessionId: string; pid?: number; created: boolean }): string {
  const pid = value.pid !== undefined ? ` (pid ${value.pid})` : ''
  const origin = value.created ? 'started' : 'reused'
  return `session ${value.sessionId} is running${pid} — ${origin}`
}

/**
 * Build the `godot_play` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function playTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_play',
    description: 'Start a persistent running instance of a Godot project and return a session id. '
      + 'The game keeps running between calls: use godot_see to look at it, godot_state to read the scene, '
      + 'godot_click / godot_key to operate it, and godot_stop to end it. '
      + 'The game opens in a normal native window by default so the user can operate it directly; '
      + 'pass offscreen: true to keep the window off-screen for the Web watch panel. '
      + 'The project is launched without modifying project.godot or res:// files. '
      + 'Without restart, an already running session for this workspace is reused.',
    parameters: {
      path: {
        type: 'string',
        description: 'Project root or a file inside it. Defaults to the session workspace; discovery walks up for project.godot.',
      },
      scene: {
        type: 'string',
        description: 'Scene to start instead of the project main scene (res:// path, for example, "res://levels/test.tscn").',
      },
      offscreen: {
        type: 'boolean',
        description: 'Start the game window off-screen (position -32000,-32000) when the user does not need to see it.',
      },
      maxFps: {
        type: 'number',
        description: 'Frame-rate cap passed as --max-fps (0 = engine default). Ignored when fixedFps > 0.',
      },
      fixedFps: {
        type: 'number',
        description: 'Deterministic pacing with --fixed-fps (0 = disabled). Use for reproducible replays.',
      },
      restart: {
        type: 'boolean',
        description: 'Stop the existing session for this workspace and start a fresh one.',
      },
    },
    timeoutMs: 120_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true },
          pid: { type: 'number' },
          created: { type: 'boolean', required: true },
          running: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPlay(value) }],
    },
    async execute(args: PlayArgs, exec): Promise<PlayResult> {
      const workspace = exec.agent?.session.header.cwd ?? process.cwd()
      const result = await registry.ensure(workspace, {
        ...(args.restart === true ? { restart: true } : {}),
        ...(args.path !== undefined ? { path: args.path } : {}),
        ...(args.scene !== undefined ? { scene: args.scene } : {}),
        ...(args.offscreen !== undefined ? { offscreen: args.offscreen } : {}),
        ...(args.maxFps !== undefined ? { maxFps: args.maxFps } : {}),
        ...(args.fixedFps !== undefined ? { fixedFps: args.fixedFps } : {}),
      })
      return {
        sessionId: result.sessionId,
        ...(result.pid !== null ? { pid: result.pid } : {}),
        created: result.created,
        running: true,
      }
    },
  })
}
