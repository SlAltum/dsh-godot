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
// The Phase 4 attach recording: break-triggered stop, then a dynamic
// breakpoint stop at main.gd:11 @ _process.
const attachBin = readFileSync(join(here, 'fixtures', 't4-attach.bin'))
const attachManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't4-attach.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 5 expansion recording: object vars + serial inspect responses.
const inspectBin = readFileSync(join(here, 'fixtures', 't5-inspect.bin'))
const inspectManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't5-inspect.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 6 edit recording: expansion (self/player), four typed edits with
// per-edit re-inspect verification, then a second stop. Same object id is
// inspected repeatedly; FakeGame dispatches by per-id request sequence.
const editBin = readFileSync(join(here, 'fixtures', 't6-edit.bin'))
const editManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't6-edit.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 7 scene-tree recording: two frame-bearing stops, each with a
// scene_tree response (per-request sequence dispatch).
const treeBin = readFileSync(join(here, 'fixtures', 't7-tree.bin'))
const treeManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't7-tree.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 8 nested-expansion recording: self then its nested ObjectIds
// (member_a, player, arr[0], dict["k"]) — 5 inspect round-trips.
const nestedBin = readFileSync(join(here, 'fixtures', 't8-nested.bin'))
const nestedManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't8-nested.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 10 worker-thread recording: worker breakpoint pause (threadId 46).
const workerBin = readFileSync(join(here, 'fixtures', 't10-worker.bin'))
const workerManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't10-worker.json'), 'utf8')) as {
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

  it('attaches to a running game: dynamic breakpoint stop, detached report', async () => {
    const game = new FakeGame(attachBin, attachManifest.frames)
    const port = await game.connectPort()
    const ctx = await mount(port)
    try {
      const run = callDebug(ctx, {
        path: ws,
        mode: 'attach',
        port,
        breakpoints: [{ file: 'res://main.gd', line: 11 }],
        pauseOnAttach: true,
      })
      await game.connect(port)
      const result = await run
      expect(result.isError).toBe(false)
      const value = result.value as {
        stops: { reason: string; snapshot: { frames: { file: string; line: number; func: string }[] } }[]
        detached: boolean
        exit: unknown
      }
      expect(value.stops).toHaveLength(2)
      expect(value.stops[0]!.reason).toBe('')
      expect(value.stops[1]!.reason).toBe('Breakpoint')
      expect(value.stops[1]!.snapshot.frames[0]).toEqual({ file: 'res://main.gd', line: 11, func: '_process' })
      expect(value.detached).toBe(true)
      expect('exit' in value).toBe(false) // attach has no owned process exit facts

      // Model-visible render: the break stop labels [break], the tail states
      // the game keeps running.
      const text = result.content.flatMap(block => block.type === 'text' ? block.text : []).join('\n')
      expect(text).toContain('2 stops (max 10)')
      expect(text).toContain('<no frame> [break]')
      expect(text).toContain('res://main.gd:11 @ _process [Breakpoint]')
      expect(text).toContain('ticks = 20')
      expect(text).toContain('attached; game left running (not owned by the tool)')
      expect(text).toMatchSnapshot()
      const meta = result.meta as { detached: boolean; stopCount: number }
      expect(meta.detached).toBe(true)
      expect(meta.stopCount).toBe(2)
    } finally {
      await ctx.fiber.dispose()
      await game.dispose()
    }
  }, 30_000)

  it('expands objects into the model-visible output', async () => {
    const game = new FakeGame(inspectBin, inspectManifest.frames)
    const port = await game.connectPort()
    const ctx = await mount(port)
    try {
      const run = callDebug(ctx, {
        path: ws,
        breakpoints: [{ file: 'res://main.gd', line: 25 }],
      })
      await game.connect(port)
      const result = await run
      expect(result.isError).toBe(false)
      const value = result.value as {
        expandedObjects: number
        expansion: { entries: { name: string; rows: { name: string; value: string }[] }[] }
      }
      expect(value.expandedObjects).toBe(2)
      expect(value.expansion.entries[0]!.name).toBe('self')
      const text = result.content.flatMap(block => block.type === 'text' ? block.text : []).join('\n')
      expect(text).toContain('expanded objects (2):')
      expect(text).toContain('self = Object<27028096474> [Node]')
      expect(text).toContain('counter = 20')
      expect(text).toMatchSnapshot()
      const meta = result.meta as { expandedObjects: number }
      expect(meta.expandedObjects).toBe(2)
    } finally {
      await ctx.fiber.dispose()
      await game.dispose()
    }
  }, 30_000)

  it('applies variable edits into the model-visible output', async () => {
    const game = new FakeGame(editBin, editManifest.frames)
    const port = await game.connectPort()
    const ctx = await mount(port)
    try {
      const run = callDebug(ctx, {
        path: ws,
        breakpoints: [{ file: 'res://main.gd', line: 33 }],
        edits: [
          { target: 'self', property: 'counter', value: '42', type: 'int' },
          { target: 'self', property: 'speed', value: '2.5', type: 'float' },
          { target: 'self', property: 'label_text', value: 'changed', type: 'string' },
          { target: 'self', property: 'flag', value: 'true', type: 'bool' },
        ],
      })
      await game.connect(port)
      const result = await run
      expect(result.isError).toBe(false)
      const value = result.value as {
        editsApplied: number
        editsTruncated: boolean
        edits: { results: { target: string; property: string; requested: unknown; type: string; ok: boolean }[] }
      }
      expect(value.editsApplied).toBe(4)
      expect(value.editsTruncated).toBe(false)
      expect(value.edits.results.every(r => r.ok)).toBe(true)
      expect(value.edits.results[0]).toMatchObject({ target: 'self', property: 'counter', requested: 42, type: 'int' })

      // Model-visible render carries the edits block with per-edit outcomes.
      const text = result.content.flatMap(block => block.type === 'text' ? block.text : []).join('\n')
      expect(text).toContain('edits (4):')
      expect(text).toContain('self.counter = 42 [int] ok')
      expect(text).toContain('self.speed = 2.5 [float] ok')
      expect(text).toContain('self.flag = true [bool] ok')
      expect(text).toMatchSnapshot()
      const meta = result.meta as { editsApplied: number }
      expect(meta.editsApplied).toBe(4)
    } finally {
      await ctx.fiber.dispose()
      await game.dispose()
    }
  }, 30_000)

  it('snapshots scene trees into the model-visible output', async () => {
    const game = new FakeGame(treeBin, treeManifest.frames)
    const port = await game.connectPort()
    const ctx = await mount(port)
    try {
      const run = callDebug(ctx, {
        path: ws,
        breakpoints: [{ file: 'res://main.gd', line: 32 }],
      })
      await game.connect(port)
      const result = await run
      expect(result.isError).toBe(false)
      const value = result.value as {
        sceneTreeCount: number
        sceneTreeTruncated: boolean
        sceneTrees: { stopIndex: number; lines: string[] }[]
      }
      expect(value.sceneTreeCount).toBe(2)
      expect(value.sceneTreeTruncated).toBe(false)
      expect(value.sceneTrees[0]).toMatchObject({ stopIndex: 0 })
      expect(value.sceneTrees[0]!.lines[0]).toBe('root [Window] (26323453389)')
      expect(value.sceneTrees[0]!.lines.some(l => l.includes('Leaf中文'))).toBe(true)

      // Model-visible render carries a "scene tree" block per frame stop.
      const text = result.content.flatMap(block => block.type === 'text' ? block.text : []).join('\n')
      expect(text).toContain('scene tree (8 nodes):')
      expect(text).toContain('  Main [res://main.gd] (26994542042) res://main.tscn')
      expect(text).toContain('      Leaf中文 [Node2D] (27028096478)')
      expect(text).toMatchSnapshot()
      const meta = result.meta as { sceneTreeCount: number }
      expect(meta.sceneTreeCount).toBe(2)
    } finally {
      await ctx.fiber.dispose()
      await game.dispose()
    }
  }, 30_000)

  it('renders nested expansion children into the model-visible output', async () => {
    const game = new FakeGame(nestedBin, nestedManifest.frames)
    const port = await game.connectPort()
    const ctx = await mount(port)
    try {
      const run = callDebug(ctx, {
        path: ws,
        breakpoints: [{ file: 'res://main.gd', line: 38 }],
      })
      await game.connect(port)
      const result = await run
      expect(result.isError).toBe(false)
      const value = result.value as {
        expandedObjects: number
        expansionTruncated: boolean
        expansion: {
          entries: {
            name: string
            children?: { name: string; className: string; rows: { name: string; value: string }[] }[]
          }[]
        }
      }
      expect(value.expandedObjects).toBe(5)
      expect(value.expansionTruncated).toBe(false)
      const self = value.expansion.entries.find(e => e.name === 'self')
      // member_a is a top-level var in the t8 project, so the top-level
      // reserve dedups it (T8.0 fact 2) — only arr[0] and dict["k"] recurse.
      expect(self!.children?.map(c => c.name)).toEqual(['arr[0]', 'dict["k"]'])
      expect(self!.children?.find(c => c.name === 'arr[0]')!.className).toBe('Node')

      // Model-visible render: nested children indent deeper under the parent.
      const text = result.content.flatMap(block => block.type === 'text' ? block.text : []).join('\n')
      expect(text).toContain('expanded objects (5):')
      expect(text).toContain('    self = Object<26994542042> [Node]')
      expect(text).toContain('      arr[0] = Object<27061650907> [Node]')
      expect(text).toContain('        name = &\'ArrObj\'')
      expect(text).toContain('      dict["k"] = Object<27078428127> [Node]')
      // The deduped top-level player is a sibling entry.
      expect(text).toContain('    player = Object<27095205344> [Node]')
      expect(text).toMatchSnapshot()
      const meta = result.meta as { expandedObjects: number }
      expect(meta.expandedObjects).toBe(5)
    } finally {
      await ctx.fiber.dispose()
      await game.dispose()
    }
  }, 30_000)

  it('marks a worker-thread pause in the model-visible output', async () => {
    const game = new FakeGame(workerBin, workerManifest.frames)
    const port = await game.connectPort()
    const ctx = await mount(port)
    try {
      const run = callDebug(ctx, {
        path: ws,
        breakpoints: [{ file: 'res://main.gd', line: 18 }],
      })
      await game.connect(port)
      const result = await run
      expect(result.isError).toBe(false)
      const value = result.value as { stops: { threadId: number; reason: string }[] }
      expect(value.stops[0]!.threadId).toBe(46)

      // The stop line carries the thread marker; the head does not count it
      // differently (1 stop).
      const text = result.content.flatMap(block => block.type === 'text' ? block.text : []).join('\n')
      expect(text).toContain('res://main.gd:18 @ _worker_loop [Breakpoint @ thread 46]')
      expect(text).toMatchSnapshot()
      const meta = result.meta as { stops: { threadId: number }[] }
      expect(meta.stops[0]!.threadId).toBe(46)
    } finally {
      await ctx.fiber.dispose()
      await game.dispose()
    }
  }, 30_000)
})
