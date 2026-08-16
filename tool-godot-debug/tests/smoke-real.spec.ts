/**
 * Real-Godot smoke: the full tool chain against a real Godot binary and the
 * T3.0 probe project. Skipped unless `GODOT_EXE` points at a Godot 4.2+
 * executable (the console build on Windows; any binary elsewhere). The
 * project at `.context/t3/project` was imported once, so class_name globals
 * resolve (facts f1 note). APPDATA is redirected to a temp dir because the
 * game mode crashes (signal 11) when user:// is unwritable (facts note).
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { Config } from '../src/index.ts'
import * as ToolGodotDebug from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const project = join(here, '..', '..', '.context', 't3', 'project')

describe.skipIf(process.env.GODOT_EXE === undefined)('real-Godot smoke', () => {
  it('runs a real debug session with two breakpoints', async () => {
    const appdata = await mkdtemp(join(tmpdir(), 'godot-debug-smoke-'))
    const prevAppData = process.env.APPDATA
    process.env.APPDATA = appdata
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(TimeoutPolicy)
      await ctx.plugin(ToolGodotDebug, Config({
        executable: process.env.GODOT_EXE as string,
        connectWaitMs: 20_000,
        idleTimeoutMs: 10_000,
        graceMs: 5_000,
        timeoutMs: 120_000,
      }))
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: 'smoke-real' as never,
        name: 'godot_debug',
        arguments: {
          path: project,
          scene: 'res://main.tscn',
          breakpoints: [
            { file: 'res://player.gd', line: 10 },
            { file: 'res://player.gd', line: 19 },
          ],
          maxStops: 10,
        },
        agent: { session: { header: { cwd: project } } } as never,
      })
      expect(result.isError).toBe(false)
      const value = result.value as {
        stops: {
          reason: string
          snapshot: {
            frames: { file: string; line: number; func: string }[]
            scopes: { members: { name: string; value: string }[] }
          }
        }[]
        output: string[]
      }
      expect(value.stops).toHaveLength(2)
      expect(value.stops[0]!.reason).toBe('Breakpoint')
      expect(value.stops[0]!.snapshot.frames[0]).toEqual({ file: 'res://player.gd', line: 10, func: 'run' })
      const members = Object.fromEntries(value.stops[0]!.snapshot.scopes.members.map(v => [v.name, v.value]))
      expect(members['counter']).toBe('1')
      expect(value.output.some(line => line.includes('counter=3'))).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      process.env.APPDATA = prevAppData
      await rm(appdata, { recursive: true, force: true })
    }
  }, 180_000)
})
