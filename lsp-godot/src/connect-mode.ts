/**
 * Connect-mode orchestration: attach (running editor), spawn (owned headless
 * editor), or auto (attach first, fall back to spawn). A spawned connection
 * wraps the attach connection so closing it also terminates the owned editor
 * process; attached connections close only their socket (plan D4).
 * @module @deepseek-ai/dsh-lsp-godot/connect-mode
 */

import type { GodotLspConfig, ResolvedGodotLspConfig } from './config.ts'
import { establishConnection, type EstablishOptions, type GodotLspConnection } from './connection.ts'
import type { SpawnedEditor } from './spawn.ts'
import type { HostWorkspace } from '@deepseek-ai/dsh-lsp-stdio/src/host.ts'

/** Process and attach primitives, injected by the plugin assembly. */
export interface ConnectModeDeps {
  /** Attach to a running server on the given ports. */
  attach(options: EstablishOptions, signal: AbortSignal): Promise<GodotLspConnection>
  /** Launch a headless editor and wait for its LSP port. */
  spawnEditor(config: GodotLspConfig, workspace: HostWorkspace, signal: AbortSignal): Promise<{ port: number; editor: SpawnedEditor }>
}

/**
 * Establish one workspace connection according to the configured connect
 * mode. Auto mode attaches first and falls back to spawning on any attach
 * failure.
 * @param config - the resolved plugin configuration.
 * @param workspace - the canonical workspace.
 * @param signal - caller cancellation.
 * @param deps - the attach/spawn primitives.
 * @returns a connection; spawned connections own their editor process.
 */
export async function connectForWorkspace(
  config: GodotLspConfig,
  workspace: HostWorkspace,
  signal: AbortSignal,
  deps: ConnectModeDeps,
): Promise<GodotLspConnection> {
  // The schema fills every default; the caller's typed input stays optional.
  const resolved = config as ResolvedGodotLspConfig
  const attachOptions = (ports: number[]): EstablishOptions => ({
    host: resolved.host,
    ports,
    connectTimeoutMs: resolved.connectTimeoutMs,
    idleTimeoutMs: resolved.idleTimeoutMs,
    maxMessageBytes: resolved.maxMessageBytes,
    workspaceRoot: workspace.canonicalPath,
    workspaceFileUrl: workspace.fileUrl,
  })

  if (resolved.connectMode === 'attach') {
    return deps.attach(attachOptions(resolved.ports), signal)
  }
  if (resolved.connectMode === 'spawn') {
    return spawnAndAttach(config, workspace, signal, deps, attachOptions)
  }
  // auto: attach first, fall back to spawn on any failure.
  try {
    return await deps.attach(attachOptions(resolved.ports), signal)
  } catch {
    return spawnAndAttach(config, workspace, signal, deps, attachOptions)
  }
}

/** Spawn an editor, attach to its port, and wrap the connection to own the process. */
async function spawnAndAttach(
  config: GodotLspConfig,
  workspace: HostWorkspace,
  signal: AbortSignal,
  deps: ConnectModeDeps,
  attachOptions: (ports: number[]) => EstablishOptions,
): Promise<GodotLspConnection> {
  const { port, editor } = await deps.spawnEditor(config, workspace, signal)
  const connection = await deps.attach(attachOptions([port]), signal)
  return new SpawnedConnection(connection, editor)
}

/** A connection that terminates its owned editor on close. */
class SpawnedConnection implements GodotLspConnection {
  constructor(
    private readonly inner: GodotLspConnection,
    private readonly editor: SpawnedEditor,
  ) {}

  get endpoint() { return this.inner.endpoint }
  get capabilities() { return this.inner.capabilities }
  get serverProjectPath() { return this.inner.serverProjectPath }
  get dead() { return this.inner.dead }

  close(): void {
    this.inner.close()
    this.editor.close()
  }

  matchesWorkspace(): boolean {
    return this.inner.matchesWorkspace()
  }
}

export { establishConnection }
