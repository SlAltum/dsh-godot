/**
 * Where the debugger finds Godot: an explicit config wins, an empty one
 * inherits the `tool-godot` settings value, and a bare host falls back to the
 * command name.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDebugExecutable } from '../src/executable.ts'
import { Config } from '../src/config.ts'
import type { ResolvedGodotDebugConfig } from '../src/config.ts'

/** A context carrying one `godot.toolchain` service. */
function ctxWithToolchain(resolved: { executable: string; args: string[] } | undefined): Context {
  return {
    get: (name: string) => (name === 'godot.toolchain' && resolved !== undefined
      ? { resolve: () => resolved }
      : undefined),
  } as unknown as Context
}

/** Config with the schema defaults filled. */
function config(overrides: Record<string, unknown> = {}): ResolvedGodotDebugConfig {
  return Config(overrides) as ResolvedGodotDebugConfig
}

describe('resolveDebugExecutable', () => {
  it('uses the configured path and args when the row names them', () => {
    const ctx = ctxWithToolchain({ executable: 'C:/from-card.exe', args: ['--card'] })
    expect(resolveDebugExecutable(ctx, config({ executable: 'C:/explicit.exe', executableArgs: ['--x'] })))
      .toEqual({ executable: 'C:/explicit.exe', args: ['--x'] })
  })

  it('inherits the live tool-godot value when its own executable is empty', () => {
    const ctx = ctxWithToolchain({ executable: 'C:/from-card.exe', args: ['--card'] })
    expect(resolveDebugExecutable(ctx, config())).toEqual({ executable: 'C:/from-card.exe', args: ['--card'] })
  })

  it('falls back to the command name without a toolchain', () => {
    expect(resolveDebugExecutable(ctxWithToolchain(undefined), config())).toEqual({ executable: 'godot', args: [] })
  })
})
