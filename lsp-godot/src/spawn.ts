/**
 * Spawn-mode editor orchestration for the Godot LSP provider: the headless
 * editor (`godot --path <dir> --editor --headless --no-window --lsp-port <p>`)
 * has a version gate (Godot 4.2+/3.6+, from the source plugin's
 * verify_godot_version), needs a concrete pre-picked port (never port 0, plan
 * D6), and its process belongs to the provider (terminate on teardown).
 * Process execution itself (version probe, spawn, TCP-ready wait, stderr
 * tail) is injected as an `EditorSpawner` so this module stays a pure
 * orchestration; the real wiring lives in the plugin assembly over
 * `ctx.subprocess`.
 * @module @deepseek-ai/dsh-lsp-godot/spawn
 */

import { createServer } from 'node:net'
import type { ConnectionHandle } from './pool.ts'

/** One spawned headless editor: its LSP port plus a close handle that terminates the process. */
export interface SpawnedEditor extends ConnectionHandle {
  /** The port the editor's LSP server listens on. */
  readonly port: number
  /** Retained stderr tail for diagnostics (bounded by maxStderrBytes). */
  readonly stderrTail: string
}

/** Process-level editor launching, injected by the plugin assembly. */
export interface EditorSpawner {
  /**
   * Launch a headless editor for one project and wait until its LSP port
   * accepts connections (or the process exits first).
   * @param args - launch parameters.
   * @param signal - caller cancellation; the spawner terminates on abort.
   * @returns the ready editor handle.
   */
  spawnEditor(
    args: { projectDir: string; port: number; executable: string; extraArgs: string[] },
    signal: AbortSignal,
  ): Promise<SpawnedEditor>
}

/** Options for one spawn orchestration. */
export interface SpawnGodotLspOptions {
  /** Godot executable path or command name. */
  executable: string
  /** Extra argv inserted after the executable. */
  spawnArgs: string[]
  /** The project directory to open. */
  projectDir: string
  /** 0 = provider picks a free port; otherwise the explicit port. */
  spawnPort: number
  /** Caller cancellation. */
  signal: AbortSignal
  /** Injected version probe (real wiring runs `godot --version`). */
  versionProbe: (executable: string) => Promise<string>
  /** Injected process launcher. */
  spawner: EditorSpawner
}

/**
 * Orchestrate one spawn: version gate → port pick → editor launch.
 * @param options - the spawn parameters.
 * @returns the ready editor and its port.
 */
export async function spawnGodotLsp(options: SpawnGodotLspOptions): Promise<{ port: number; editor: SpawnedEditor }> {
  const versionLine = await options.versionProbe(options.executable)
  const gate = verifyGodotVersion(versionLine, projectMajor(versionLine))
  if (!gate.ok) {
    throw new Error(`headless LSP requires Godot 4.2+ (or 3.6+); the configured executable reports ${gate.version}`)
  }
  const port = options.spawnPort !== 0 ? options.spawnPort : await pickFreePort()
  const editor = await options.spawner.spawnEditor(
    { projectDir: options.projectDir, port, executable: options.executable, extraArgs: options.spawnArgs },
    options.signal,
  )
  return { port: editor.port, editor }
}

/**
 * The headless-LSP version gate. Headless LSP mode is only available on
 * Godot 4.2+ (4.x) or 3.6+ (3.x); older versions silently skip LSP startup.
 * @param versionLine - the first line of `godot --version`.
 * @param projectMajor - the project's config_version major (4 or 3).
 * @returns whether the gate passes and the parsed minor version.
 */
export function verifyGodotVersion(versionLine: string, projectMajor: string): { ok: boolean; version: string } {
  const match = /^(\d+)\.(\d+)/.exec(versionLine.trim())
  if (match === null) return { ok: false, version: versionLine.trim() }
  const version = `${match[1]}.${match[2]}`
  const major = Number(match[1])
  const minor = Number(match[2])
  const sameMajor = major === Number(projectMajor)
  const ok = sameMajor && (major === 4 ? minor >= 2 : major === 3 ? minor >= 6 : false)
  return { ok, version }
}

/** The major from a version line (`4.7.stable` → `4`), or '' when unparsable. */
function projectMajor(versionLine: string): string {
  return /^(\d)/.exec(versionLine.trim())?.[1] ?? ''
}

/**
 * Pre-select a concrete free TCP port for `--lsp-port`. Bind-probe has a
 * race window (accepted, plan D6); port 0 is never passed to Godot.
 * @returns a currently bindable port.
 */
export async function pickFreePort(): Promise<number> {
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    /* v8 ignore next -- after a successful listen() on a TCP server, address() is always an AddressInfo. */
    if (address === null || typeof address === 'string') throw new Error('pickFreePort: no TCP address')
    return address.port
  } finally {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
}
