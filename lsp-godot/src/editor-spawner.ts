/**
 * The real editor spawner over the subprocess seam: resolves the executable,
 * spawns `godot --path <dir> --editor --headless --no-window --lsp-port <p>`
 * with collected output, waits (bounded) for the LSP port to accept
 * connections while racing the process exit, and exposes tree-scoped
 * termination. The spawner's readiness probe is the real TCP connect, so the
 * wait itself is tested against a real listener.
 * @module @deepseek-ai/dsh-lsp-godot/editor-spawner
 */

import { connect } from 'node:net'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { EditorSpawner, SpawnedEditor } from './spawn.ts'
import { throwIfAborted } from './abort.ts'

/** The subprocess-seam surface this spawner needs (duck-typed for tests). */
export interface SubprocessLike {
  resolveExecutable(command: string, env: unknown, signal?: AbortSignal): Promise<string>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

/** Spawner bounds, from the plugin config. */
export interface EditorSpawnerConfig {
  /** Retained stderr tail (bytes). */
  maxStderrBytes: number
  /** Terminate-escalation grace for the subprocess seam. */
  killGraceMs: number
  /** Budget for the editor's LSP port to become ready. */
  spawnReadyTimeoutMs: number
}

/**
 * Build the real editor spawner over the subprocess seam.
 * @param subprocess - the seam (or a test double).
 * @param config - spawner bounds.
 * @returns an `EditorSpawner` launching real headless editors.
 */
export function createEditorSpawner(subprocess: SubprocessLike, config: EditorSpawnerConfig): EditorSpawner {
  return {
    async spawnEditor(args, signal) {
      const executable = await subprocess.resolveExecutable(args.executable, undefined, signal)
      const argv = [
        executable,
        '--path', args.projectDir,
        '--editor', '--headless', '--no-window',
        '--lsp-port', String(args.port),
        ...args.extraArgs,
      ]
      const handle = subprocess.spawn({
        argv,
        cwd: args.projectDir,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 64 * 1024 },
          stderr: { maxBytes: config.maxStderrBytes },
        },
        graceMs: config.killGraceMs,
        signal,
      })
      await waitForLspPort(args.port, signal, handle, config.spawnReadyTimeoutMs)
      let exited = false
      void handle.done.then(() => { exited = true })
      return new SpawnedEditorHandle(handle, args.port, () => exited)
    },
  }
}

/** Wait until the port accepts connections, the process exits, or the budget elapses. */
async function waitForLspPort(
  port: number,
  signal: AbortSignal,
  handle: SubprocessHandle,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let exitFacts: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined
  const exitWatch = handle.done.then((facts) => { exitFacts = facts })
  for (;;) {
    throwIfAborted(signal)
    if (exitFacts !== undefined) {
      const tail = readStderrTail(handle)
      throw new Error(`Godot editor exited before LSP started (code ${exitFacts.exitCode}): ${tail}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`Godot editor LSP port ${port} not ready within ${timeoutMs}ms`)
    }
    if (await tryConnect(port)) return
    await new Promise(resolve => setTimeout(resolve, 500))
    void exitWatch
  }
}

/** One TCP connect probe; resolves true when the port accepts connections. */
function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
    /* v8 ignore next -- the idle timeout fires only for a silently-dropping peer; local/CI hosts settle with error or connect first. */
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}

/** The retained stderr tail from the collected stream, bounded by the seam's cap. */
function readStderrTail(handle: SubprocessHandle): string {
  return handle.collected.stderr?.readFrom(0).text ?? ''
}

/** A spawned editor owned by the provider: close = tree-scoped termination. */
class SpawnedEditorHandle implements SpawnedEditor {
  private terminated = false

  constructor(
    private readonly handle: SubprocessHandle,
    readonly port: number,
    private readonly processExited: () => boolean,
  ) {}

  get stderrTail(): string {
    return readStderrTail(this.handle)
  }

  get dead(): boolean {
    return this.terminated || this.processExited()
  }

  close(): void {
    this.terminated = true
    this.handle.terminate()
  }
}
