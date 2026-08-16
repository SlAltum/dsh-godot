/**
 * The Godot GDScript LSP provider plugin for `ctx.lsp`. One plugin registers
 * the `godot` provider (`.gd` → `gdscript`) with attach / spawn / auto
 * connect modes, pooled per workspace, so the model-facing `lsp` tool gains
 * GDScript navigation without any model-visible difference. Spawn mode owns
 * its headless editor process (terminated on connection close); attach mode
 * only opens a socket to the running editor (plan D4). The seam contract,
 * protocol facts, and Godot-specific cleaning are pinned in
 * `.context/t0/facts.md` and the package tests.
 * @module @deepseek-ai/dsh-lsp-godot
 */

import type { Context } from '@deepseek-ai/cordis'
import type { HostWorkspace } from '@deepseek-ai/dsh-lsp-stdio/src/host.ts'
import { validateConfig } from './config.ts'
import type { GodotLspConfig, ResolvedGodotLspConfig } from './config.ts'
import { connectForWorkspace, type ConnectModeDeps } from './connect-mode.ts'
import { establishConnection } from './connection.ts'
import { createEditorSpawner } from './editor-spawner.ts'
import type { SubprocessLike } from './editor-spawner.ts'
import { GodotLspProvider } from './provider.ts'
import { spawnGodotLsp } from './spawn.ts'

export { Config } from './config.ts'
export type { GodotLspConfig, ResolvedGodotLspConfig } from './config.ts'
export { GodotLspProvider } from './provider.ts'
export type { GodotConnect } from './provider.ts'
export { establishConnection, workspaceMatches } from './connection.ts'
export type { EstablishOptions, GodotLspConnection } from './connection.ts'
export { createEditorSpawner } from './editor-spawner.ts'
export type { EditorSpawnerConfig, SubprocessLike } from './editor-spawner.ts'
export { verifyGodotVersion, pickFreePort, spawnGodotLsp } from './spawn.ts'
export type { EditorSpawner, SpawnedEditor } from './spawn.ts'
export { hoverClean } from './hover-clean.ts'
export { normalizeGodotUri } from './uri.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'lsp-godot'

/** Services required by the Godot LSP provider. */
export const inject = ['fs', 'lsp', 'subprocess']

/**
 * Register the Godot GDScript LSP provider. The provider is registered under
 * `ctx.lsp` and its connection pool is torn down with the fiber.
 * @param ctx - the plugin context (must inject `fs`, `lsp`, `subprocess`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: ResolvedGodotLspConfig): void {
  validateConfig(config)
  const deps = createConnectDeps(ctx.subprocess, config)
  const provider = new GodotLspProvider(
    ctx.fs,
    config,
    (_key: string, workspace: HostWorkspace, signal: AbortSignal) =>
      connectForWorkspace(config, workspace, signal, deps),
  )
  ctx.effect(() => {
    const dispose = ctx.lsp.registerProvider(provider)
    return () => {
      dispose()
      void provider.disposeAll()
    }
  }, 'lsp-godot.registerProvider')
}

/**
 * Assemble the attach/spawn primitives the connect modes need. Extracted from
 * `apply` so the spawn pipeline (version probe → editor spawn → readiness) is
 * testable against a fake subprocess without a Godot binary.
 * @param subprocess - the subprocess seam (or a test double).
 * @param config - the plugin configuration (defaults filled by the schema).
 * @returns the connect-mode dependencies.
 */
export function createConnectDeps(subprocess: SubprocessLike, config: GodotLspConfig): ConnectModeDeps {
  const resolved = config as ResolvedGodotLspConfig
  const spawner = createEditorSpawner(subprocess, {
    maxStderrBytes: resolved.maxStderrBytes,
    killGraceMs: resolved.killGraceMs,
    spawnReadyTimeoutMs: resolved.spawnReadyTimeoutMs,
  })
  return {
    attach: options => establishConnection(options),
    spawnEditor: async (cfg, workspace, signal) => {
      const spawnConfig = cfg as ResolvedGodotLspConfig
      const { port, editor } = await spawnGodotLsp({
        executable: spawnConfig.spawnExecutable,
        spawnArgs: spawnConfig.spawnArgs,
        projectDir: workspace.canonicalPath,
        spawnPort: spawnConfig.spawnPort,
        signal,
        versionProbe: executable => probeGodotVersion(subprocess, executable, resolved, signal),
        spawner,
      })
      return { port, editor }
    },
  }
}

/** Run `godot --version` through the subprocess seam and return its first line. */
async function probeGodotVersion(
  subprocess: SubprocessLike,
  executable: string,
  config: ResolvedGodotLspConfig,
  signal: AbortSignal,
): Promise<string> {
  const resolved = await subprocess.resolveExecutable(executable, undefined, signal)
  const handle = subprocess.spawn({
    argv: [resolved, '--version'],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4096 },
      stderr: { maxBytes: 4096 },
    },
    graceMs: config.killGraceMs,
    signal,
  })
  await handle.done
  return handle.collected.stdout?.readFrom(0).text ?? ''
}

export default apply
