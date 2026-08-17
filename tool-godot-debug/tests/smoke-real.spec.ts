/**
 * Real-Godot smoke: the full tool chain against a real Godot binary and the
 * T3.0/T4.0 probe projects. Skipped unless `GODOT_EXE` points at a Godot 4.2+
 * executable (the console build on Windows; any binary elsewhere). The
 * projects were imported once, so class_name globals resolve (facts f1 note)
 * and main.gd runs its tick loop. APPDATA is redirected to a temp dir because
 * the game mode crashes (signal 11) when user:// is unwritable (facts note).
 * The attach case follows the pinned order: the tool binds first, THEN the
 * game connects (Godot does not retry a failed connection, T4.0 fact 11).
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { Config } from '../src/index.ts'
import * as ToolGodotDebug from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const project = join(here, '..', '..', '.context', 't3', 'project')
// The Phase 4 probe project: main.gd ticks every frame and hits line 11
// every 20 ticks (dynamic-breakpoint target); already imported by run-t4.mjs.
const attachProject = join(here, '..', '..', '.context', 't4', 'project')
const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms)
})

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
        expandedObjects: number
        expansion: { entries: { name: string; className: string; rows: { name: string; value: string }[] }[] }
      }
      expect(value.stops).toHaveLength(2)
      expect(value.stops[0]!.reason).toBe('Breakpoint')
      expect(value.stops[0]!.snapshot.frames[0]).toEqual({ file: 'res://player.gd', line: 10, func: 'run' })
      const members = Object.fromEntries(value.stops[0]!.snapshot.scopes.members.map(v => [v.name, v.value]))
      expect(members['counter']).toBe('1')
      expect(value.output.some(line => line.includes('counter=3'))).toBe(true)
      // Phase 5: the first stop expands `self`. The response className is the
      // ENGINE class (get_class(), "Node" even for the Player script class —
      // pinned in `.context/t5/facts.md`), so assert on the engine class and
      // the script member rows instead.
      expect(value.expandedObjects).toBeGreaterThan(0)
      const self = value.expansion.entries.find(e => e.name === 'self')
      expect(self).toBeDefined()
      expect(self!.className).toBe('Node')
      expect(self!.rows.some(r => r.name === 'counter')).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      process.env.APPDATA = prevAppData
      await rm(appdata, { recursive: true, force: true })
    }
  }, 180_000)

  it('attaches to a running game: dynamic breakpoint, detach leaves it running', async () => {
    const appdata = await mkdtemp(join(tmpdir(), 'godot-debug-smoke-'))
    const prevAppData = process.env.APPDATA
    process.env.APPDATA = appdata
    // Bind-probe a free port (like pickFreePort) so the test never collides
    // with a stale listener. NOTE: no TCP liveness probe after the tool
    // binds — a probe connection gets accepted and dropped, which the
    // controller treats as a game disconnect and aborts the run.
    const port = await probeFreePort()
    let game: ReturnType<typeof spawn> | undefined
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(TimeoutPolicy)
      await ctx.plugin(ToolGodotDebug, Config({
        executable: process.env.GODOT_EXE as string,
        debugPort: port,
        connectWaitMs: 20_000,
        idleTimeoutMs: 10_000,
        timeoutMs: 120_000,
      }))
      // The pinned attach order: the tool binds the port FIRST, then the
      // "user's game" connects (Godot does not retry, T4.0 fact 11). Give
      // the async listen a beat (bind is synchronous-fast, <50ms).
      const run = ctx.tools.execute({
        signal: new AbortController().signal,
        callId: 'smoke-real-attach' as never,
        name: 'godot_debug',
        arguments: {
          path: attachProject,
          mode: 'attach',
          port,
          breakpoints: [{ file: 'res://main.gd', line: 11 }],
          pauseOnAttach: true,
          maxStops: 3,
        },
        agent: { session: { header: { cwd: attachProject } } } as never,
      })
      await sleep(800)
      game = spawn(process.env.GODOT_EXE as string, [
        '--headless',
        '--path', attachProject,
        '--remote-debug', `tcp://127.0.0.1:${port}`,
      ], {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env, APPDATA: appdata },
      })
      game.on('error', () => {})
      const result = await run
      expect(result.isError).toBe(false)
      const value = result.value as {
        stops: {
          reason: string
          snapshot: { frames: { file: string; line: number; func: string }[] }
        }[]
        detached: boolean
        exit: unknown
      }
      expect(value.detached).toBe(true)
      expect('exit' in value).toBe(false)
      expect(value.stops.length).toBeGreaterThan(0)
      const breakStops = value.stops.filter(s => s.reason === 'Breakpoint')
      expect(breakStops.length).toBeGreaterThan(0)
      expect(breakStops[0]!.snapshot.frames[0]).toEqual({ file: 'res://main.gd', line: 11, func: '_process' })
      // The game survived the detach (the tool must never kill it).
      expect(game.exitCode).toBeNull()
    } finally {
      await ctx.fiber.dispose()
      game?.kill()
      process.env.APPDATA = prevAppData
      await rm(appdata, { recursive: true, force: true })
    }
  }, 180_000)
})

/** Pick a free port with a throwaway bind (like lsp-godot's pickFreePort). */
async function probeFreePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  await new Promise<void>((resolve) => {
    server.close(() => { resolve() })
  })
  if (address === null || typeof address === 'string') throw new Error('smoke: no free port')
  return address.port
}
