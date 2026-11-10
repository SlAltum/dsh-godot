/**
 * Where the debugger finds Godot.
 *
 * The settings card edits the `tool-godot` entry, so that value is the single
 * place a deployment configures the path. An explicit `executable` on this
 * row still wins; an empty one inherits the live `tool-godot` value through the
 * `godot.toolchain` service, exactly as the visual sandbox does. Without a
 * toolchain the command name `godot` is the fallback, and a deployment without
 * Godot on PATH gets the subprocess seam's own "not found" error.
 * @module @deepseek-ai/dsh-tool-godot-debug/executable
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveExecutable } from '@deepseek-ai/dsh-tool-godot'
import type { GodotExecutable, GodotToolchain } from '@deepseek-ai/dsh-tool-godot'
import type { ResolvedGodotDebugConfig } from './config.ts'

/**
 * Resolve the executable for one call, reading the toolchain live so a saved
 * settings value applies without a reload.
 * @param ctx - plugin context, which may carry `godot.toolchain`.
 * @param config - resolved debugger config.
 * @returns the executable and its fixed argv prefix.
 */
export function resolveDebugExecutable(ctx: Context, config: ResolvedGodotDebugConfig): GodotExecutable {
  const toolchain = (ctx as { get?: (name: string) => unknown }).get?.('godot.toolchain') as GodotToolchain | undefined
  const explicit = config.executable.trim() !== ''
  const inherited = explicit ? undefined : toolchain?.resolve()
  return resolveExecutable(
    explicit ? config.executable : inherited?.executable,
    config.executableArgs.length > 0 ? config.executableArgs : inherited?.args,
    'godot',
  )
}
