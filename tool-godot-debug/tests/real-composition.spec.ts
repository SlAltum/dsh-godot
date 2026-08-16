/**
 * REAL composition: the full in-process chain — `godot_debug` tool →
 * ctx.subprocess seam → fake godot executable → DebugController →
 * FakeGame replaying the T3.0 recording — asserted through `ctx.tools.execute`
 * (model-visible render text + canonical value + card meta). Also covers HMR
 * disposal: after `ctx.dispose()` the tool is unregistered.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { Config } from '../src/index.ts'
import * as ToolGodotDebug from '../src/index.ts'
import { FakeGame } from './fixtures/fake-game.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bin = readFileSync(join(here, 'fixtures', 't3-breakpoints.bin'))
const manifest = JSON.parse(readFileSync(join(here, 'fixtures', 't3-breakpoints.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}

let root: string
let ws: string
let fakeGodot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tool-godot-debug-real-'))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'project.godot'), 'config_version=5\n')
  await mkdir(join(ws, 'scripts'))
  await writeFile(join(ws, 'scripts', 'main.gd'), 'extends Node\nfunc _ready():\n\tpass\n')
  // A fake godot executable: --version succeeds, game mode stays alive while
  // the FakeGame speaks the debugger protocol.
  fakeGodot = join(root, 'fake-godot.js')
  await writeFile(
    fakeGodot,
    'if (process.argv.includes("--version")) { console.log("4.7.stable.mono.official"); process.exit(0) }\n'
    + 'setInterval(() => {}, 1000)\n',
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Mount the full tool chain with the debug tool pointing at a fixed port. */
async function mount(debugPort: number): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(TimeoutPolicy)
  await ctx.plugin(ToolGodotDebug, Config({
    executable: process.execPath,
    executableArgs: [fakeGodot],
    debugPort,
    connectWaitMs: 5_000,
    idleTimeoutMs: 1_000,
  }))
  return ctx
}

let seq = 0
function callDebug(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `real-${++seq}` as never,
    name: 'godot_debug',
    arguments: args,
    agent: { session: { header: { cwd: ws } } } as never,
  })
}

describe('REAL composition: tool → subprocess seam → controller → fake game', () => {
  it('round-trips a full debug run to model-visible output', async () => {
    const game = new FakeGame(bin, manifest.frames)
    const port = await game.connectPort()
    const ctx = await mount(port)
    try {
      const run = callDebug(ctx, {
        path: ws,
        breakpoints: [
          { file: 'res://player.gd', line: 10 },
          { file: 'res://player.gd', line: 19 },
        ],
      })
      // The game connects once the tool's listener is up (connect retries).
      await game.connect(port)
      const result = await run
      expect(result.isError).toBe(false)
      const value = result.value as {
        stops: { reason: string; snapshot: { frames: { file: string; line: number; func: string }[] } }[]
        output: string[]
        outputTruncated: boolean
      }
      expect(value.stops).toHaveLength(2)
      expect(value.stops[0]!.reason).toBe('Breakpoint')
      expect(value.stops[0]!.snapshot.frames[0]).toEqual({ file: 'res://player.gd', line: 10, func: 'run' })
      expect(value.output.some(line => line.includes('counter=3'))).toBe(true)
      expect(value.outputTruncated).toBe(false)

      // Model-visible render text carries the stop head, positions and vars.
      const text = result.content.flatMap(block => block.type === 'text' ? block.text : []).join('\n')
      expect(text).toContain('2 stops (max 10)')
      expect(text).toContain('res://player.gd:10 @ run [Breakpoint]')
      expect(text).toContain('counter = 1')
      expect(text).toContain('target = Vector2(10, 20)')
      expect(text).toMatchSnapshot()
    } finally {
      await ctx.fiber.dispose()
      await game.dispose()
    }
  }, 30_000)

  it('projects the card meta and falls back defensively on malformed meta', async () => {
    const game = new FakeGame(bin, manifest.frames)
    const port = await game.connectPort()
    const ctx = await mount(port)
    try {
      const run = callDebug(ctx, {
        path: ws,
        breakpoints: [{ file: 'res://player.gd', line: 10 }],
      })
      await game.connect(port)
      const result = await run
      expect(result.isError).toBe(false)
      const meta = result.meta as { stopCount: number; stops: { file: string; line: number }[]; maxStops: number }
      expect(meta.stopCount).toBe(2)
      expect(meta.stops[0]!.file).toBe('res://player.gd')
      expect(meta.stops[0]!.line).toBe(10)
      expect(meta.maxStops).toBe(10)
      // Defensive narrowing: garbage meta falls back to undefined (no card).
      const { debugViewFromMeta } = ToolGodotDebug
      expect(debugViewFromMeta(undefined)).toBeUndefined()
      expect(debugViewFromMeta(null)).toBeUndefined()
      expect(debugViewFromMeta('garbage')).toBeUndefined()
      expect(debugViewFromMeta({ stops: 'nope' })).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
      await game.dispose()
    }
  }, 30_000)

  it('surfaces structured GODOT_UNAVAILABLE when the version gate fails', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(TimeoutPolicy)
    // A fake godot that reports an old version.
    const oldGodot = join(root, 'old-godot.js')
    await writeFile(oldGodot, 'console.log("3.5.3.stable")\n')
    await ctx.plugin(ToolGodotDebug, Config({
      executable: process.execPath,
      executableArgs: [oldGodot],
      connectWaitMs: 5_000,
    }))
    try {
      const result = await callDebug(ctx, { path: ws })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { name: 'GodotError', code: 'GODOT_UNAVAILABLE' } })
    } finally {
      await ctx.fiber.dispose()
    }
  }, 30_000)

  it('disposes cleanly: the tool is unregistered and later calls fail', async () => {
    const ctx = await mount(6007)
    const tools = ctx.tools
    await ctx.fiber.dispose()
    // After disposal the registration is gone (the ctx proxy itself is too);
    // an unknown tool surfaces as an isError result, not a rejection.
    const result = await tools.execute({
      signal: new AbortController().signal,
      callId: 'real-disposed' as never,
      name: 'godot_debug',
      arguments: { path: ws },
      agent: { session: { header: { cwd: ws } } } as never,
    })
    expect(result.isError).toBe(true)
  }, 30_000)
})
