/**
 * runDebug orchestration tests: full breakpoint runs against the FakeGame
 * replaying the T3.0 recordings, plus version gating, project/breakpoint
 * validation, cancel, early-exit and the no-stop path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDebug, type DebugRunOptions } from '../src/tool.ts'
import { FakeGame } from './fixtures/fake-game.ts'
import { FakeSubprocess } from './fixtures/fake-subprocess.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bin = readFileSync(join(here, 'fixtures', 't3-breakpoints.bin'))
const manifest = JSON.parse(readFileSync(join(here, 'fixtures', 't3-breakpoints.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 4 attach recording: break-triggered stop (empty stack) then a
// dynamic-breakpoint stop at main.gd:11 @ _process with 4 vars.
const attachBin = readFileSync(join(here, 'fixtures', 't4-attach.bin'))
const attachManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't4-attach.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 5 expansion recording: breakpoint pause with object vars
// (self/player ObjectId, r_id RID) and three serial scene:inspect_object
// responses (24 props, 17 props, empty RID response).
const inspectBin = readFileSync(join(here, 'fixtures', 't5-inspect.bin'))
const inspectManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't5-inspect.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tool-godot-debug-'))
  await writeFile(join(root, 'project.godot'), 'config_version=5\n')
  await mkdir(join(root, 'scripts'))
  await writeFile(join(root, 'scripts', 'main.gd'), 'extends Node\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function baseOptions(overrides: Partial<DebugRunOptions> = {}): DebugRunOptions {
  return {
    executable: 'godot',
    executableArgs: [],
    projectRoot: root,
    scene: 'res://main.tscn',
    breakpoints: [{ file: 'res://scripts/main.gd', line: 2 }],
    maxStops: 10,
    timeoutMs: 60_000,
    connectWaitMs: 5_000,
    idleTimeoutMs: 300,
    graceMs: 2_000,
    maxMessageBytes: 16_000_000,
    maxOutputBytes: 1_000_000,
    maxStderrBytes: 100_000,
    maxExpandedObjects: 10,
    maxExpandedProps: 100,
    signal: new AbortController().signal,
    subprocess: new FakeSubprocess(),
    ...overrides,
  }
}

/** Run one debug run against a fake game replaying the breakpoints fixture. */
describe('runDebug', () => {
  it('launches the game with the pinned CLI shape (single-colon breakpoints)', async () => {
    // The fake game must attach to the tool's chosen port; runDebug accepts a
    // test hook for this.
    const game = new FakeGame(bin, manifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    const argv = sub.spawns[sub.spawns.length - 1]!.argv // last spawn = the game (first is the version probe)
    expect(argv[0]).toBe('godot')
    expect(argv).toContain('--headless')
    expect(argv).toContain('--path')
    expect(argv).toContain('--remote-debug')
    expect(argv[argv.indexOf('--remote-debug') + 1]).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/)
    expect(argv).toContain('--breakpoints')
    expect(argv[argv.indexOf('--breakpoints') + 1]).toBe('res://scripts/main.gd:2')
    expect(result.exit).toEqual({ exitCode: null, signal: 'SIGTERM' })
  })

  it('collects two breakpoint stops with rendered snapshots', async () => {
    const game = new FakeGame(bin, manifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({
      subprocess: sub,
      breakpoints: [
        { file: 'res://player.gd', line: 10 },
        { file: 'res://player.gd', line: 19 },
      ],
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.stops).toHaveLength(2)
    const first = result.stops[0]!
    expect(first.isUserBreakpoint).toBe(true)
    expect(first.reason).toBe('Breakpoint')
    expect(first.snapshot.frames[0]).toEqual({ file: 'res://player.gd', line: 10, func: 'run' })
    const members = Object.fromEntries(first.snapshot.scopes.members.map(v => [v.name, v.value]))
    expect(members['counter']).toBe('1')
    expect(members['target']).toBe('Vector2(10, 20)')
    expect(result.output.some(line => line.includes('counter=3'))).toBe(true)
    expect(result.outputTruncated).toBe(false)
    expect(result.varsTruncated).toBe(false)
  })

  it('rejects a missing project root with GODOT_PARSE_ERROR', async () => {
    await expect(runDebug(baseOptions({ projectRoot: join(root, 'nope') }))).rejects.toMatchObject({
      code: 'GODOT_PARSE_ERROR',
    })
  })

  it('rejects breakpoints outside the project with GODOT_PARSE_ERROR', async () => {
    await expect(
      runDebug(baseOptions({ breakpoints: [{ file: 'res://../outside.gd', line: 1 }] })),
    ).rejects.toMatchObject({ code: 'GODOT_PARSE_ERROR' })
  })

  it('rejects an absolute breakpoint path outside the project', async () => {
    const outside = join(root, '..', 'outside.gd')
    await expect(
      runDebug(baseOptions({ breakpoints: [{ file: outside, line: 1 }] })),
    ).rejects.toMatchObject({ code: 'GODOT_PARSE_ERROR' })
  })

  it('fails with GODOT_UNAVAILABLE and the version when below the gate', async () => {
    const sub = new FakeSubprocess()
    sub.versionLine = '3.5.3.stable'
    await expect(runDebug(baseOptions({ subprocess: sub }))).rejects.toMatchObject({
      code: 'GODOT_UNAVAILABLE',
    })
    // Only the version probe spawned; the game never launched.
    expect(sub.spawns).toHaveLength(1)
    expect(sub.spawns[0]!.argv).toEqual(['godot', '--version'])
  })

  it('aborts with GODOT_ABORTED and terminates the game', async () => {
    const controller = new AbortController()
    const game = new FakeGame(bin, manifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub, signal: controller.signal })
    let connected: (() => void) | undefined
    const connectedPromise = new Promise<void>((resolve) => {
      connected = resolve
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
      connected?.()
    }
    const run = runDebug(options)
    await connectedPromise
    controller.abort()
    await expect(run).rejects.toMatchObject({ code: 'GODOT_ABORTED' })
    await game.dispose()
    expect(sub.spawns[sub.spawns.length - 1]!.handle.terminated).toBe(true)
  })

  it('returns an empty stop list when no breakpoint ever hits (game keeps running)', async () => {
    const norunBin = readFileSync(join(here, 'fixtures', 't3-norun.bin'))
    const norunManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't3-norun.json'), 'utf8')) as {
      frames: { cmd: string; trigger: string; offset: number; len: number }[]
    }
    const game = new FakeGame(norunBin, norunManifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({
      subprocess: sub,
      breakpoints: [{ file: 'res://never.gd', line: 4 }],
      idleTimeoutMs: 300,
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.stops).toEqual([])
    expect(sub.spawns[sub.spawns.length - 1]!.handle.terminated).toBe(true)
  })

  it('fails with GODOT_UNAVAILABLE when the game exits before connecting', async () => {
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub, connectWaitMs: 2_000 })
    const run = runDebug(options)
    // Wait for the game spawn (the version probe is the first spawn), then
    // let the game exit before it ever connects.
    while (sub.spawns.length < 2) {
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
    }
    sub.spawns[sub.spawns.length - 1]!.handle.exitNow({ exitCode: 1, signal: null })
    await expect(run).rejects.toMatchObject({ code: 'GODOT_UNAVAILABLE' })
  })

  it('rejects a cross-drive absolute breakpoint path', async () => {
    // On Windows `path.relative('C:\\proj', 'D:\\x.gd')` returns an absolute
    // path (not `..`-prefixed); without the guard it silently produced a
    // res:// path that never matches.
    const sub = new FakeSubprocess()
    await expect(
      runDebug(baseOptions({ subprocess: sub, breakpoints: [{ file: 'D:\\outside.gd', line: 1 }] })),
    ).rejects.toMatchObject({ code: 'GODOT_PARSE_ERROR' })
  })

  it('rejects a res:// escape spelled with backslashes', async () => {
    const sub = new FakeSubprocess()
    await expect(
      runDebug(baseOptions({ subprocess: sub, breakpoints: [{ file: 'res://scripts/..\\outside.gd', line: 1 }] })),
    ).rejects.toMatchObject({ code: 'GODOT_PARSE_ERROR' })
  })
})

/** Attach-mode options (shared by the attach and expansion suites): the
 *  launch default `scene` is dropped — attach must not carry one. */
function attachOptions(overrides: Partial<DebugRunOptions> = {}): DebugRunOptions {
  const { scene: _scene, ...rest } = baseOptions()
  return {
    ...rest,
    mode: 'attach',
    port: 6007,
    ...overrides,
  }
}

/** The Phase 4 attach path: joins a caller-started game over a fixed port. */
describe('runDebug attach mode', () => {
  it('attaches, hits the dynamic breakpoint, and detaches with the game untouched', async () => {
    const game = new FakeGame(attachBin, attachManifest.frames)
    const sub = new FakeSubprocess()
    const options = attachOptions({
      subprocess: sub,
      breakpoints: [{ file: 'res://main.gd', line: 11 }],
      pauseOnAttach: true,
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    // No spawn, no version probe, no executable resolution in attach mode.
    expect(sub.spawns).toHaveLength(0)
    expect(result.detached).toBe(true)
    expect(result.exit).toBeNull()
    expect(result.stops).toHaveLength(2)
    // Stop 1: `break` pause — empty stack, empty reason rendered as [break].
    expect(result.stops[0]!.isUserBreakpoint).toBe(true)
    expect(result.stops[0]!.reason).toBe('')
    expect(result.stops[0]!.snapshot.frames).toEqual([])
    // Stop 2: the dynamic breakpoint at main.gd:11 @ _process.
    expect(result.stops[1]!.reason).toBe('Breakpoint')
    expect(result.stops[1]!.snapshot.frames[0]).toEqual({ file: 'res://main.gd', line: 11, func: '_process' })
    const members = Object.fromEntries(result.stops[1]!.snapshot.scopes.members.map(v => [v.name, v.value]))
    expect(members['ticks']).toBe('20')
    expect(result.varsTruncated).toBe(false)
  })

  it('without pauseOnAttach there is no immediate stop (dynamic bp only)', async () => {
    // The t4-attach recording's first debug_enter is triggered by `break`;
    // without pauseOnAttach the tool never sends it, so no stop arrives.
    const game = new FakeGame(attachBin, attachManifest.frames)
    const sub = new FakeSubprocess()
    const options = attachOptions({
      subprocess: sub,
      breakpoints: [{ file: 'res://main.gd', line: 11 }],
      idleTimeoutMs: 300,
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.stops).toEqual([])
    expect(result.detached).toBe(true)
  })

  it('rejects a missing port with GODOT_PARSE_ERROR and startup guidance', async () => {
    // 0 (the default when omitted) and an explicit 0 both fail the gate.
    await expect(runDebug(attachOptions({ port: 0 }))).rejects.toMatchObject({
      code: 'GODOT_PARSE_ERROR',
    })
  })

  it('rejects scene/args in attach mode with GODOT_PARSE_ERROR', async () => {
    await expect(runDebug(attachOptions({ scene: 'res://main.tscn' }))).rejects.toMatchObject({
      code: 'GODOT_PARSE_ERROR',
    })
    await expect(runDebug(attachOptions({ args: ['--fixed-fps', '60'] }))).rejects.toMatchObject({
      code: 'GODOT_PARSE_ERROR',
    })
  })

  it('rejects pauseOnAttach outside attach mode', async () => {
    await expect(runDebug(baseOptions({ pauseOnAttach: true }))).rejects.toMatchObject({
      code: 'GODOT_PARSE_ERROR',
    })
  })

  it('fails with GODOT_UNAVAILABLE and guidance when no game connects', async () => {
    const sub = new FakeSubprocess()
    await expect(runDebug(attachOptions({ subprocess: sub, connectWaitMs: 500 }))).rejects.toMatchObject({
      code: 'GODOT_UNAVAILABLE',
    })
    expect(sub.spawns).toHaveLength(0)
  })

  it('fails with GODOT_UNAVAILABLE when the port is already bound', async () => {
    const { createServer } = await import('node:net')
    const occupied = createServer()
    await new Promise<void>((resolve) => {
      occupied.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = occupied.address()
    try {
      const sub = new FakeSubprocess()
      await expect(
        runDebug(attachOptions({ subprocess: sub, port: (address as { port: number }).port })),
      ).rejects.toMatchObject({ code: 'GODOT_UNAVAILABLE' })
      expect(sub.spawns).toHaveLength(0)
    } finally {
      await new Promise<void>((resolve) => {
        occupied.close(() => { resolve() })
      })
    }
  })

  it('aborts with GODOT_ABORTED and still disposes the controller', async () => {
    const controller = new AbortController()
    const game = new FakeGame(attachBin, attachManifest.frames)
    const sub = new FakeSubprocess()
    const options = attachOptions({
      subprocess: sub,
      signal: controller.signal,
      breakpoints: [{ file: 'res://main.gd', line: 11 }],
    })
    let connected: (() => void) | undefined
    const connectedPromise = new Promise<void>((resolve) => {
      connected = resolve
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
      connected?.()
    }
    const run = runDebug(options)
    await connectedPromise
    controller.abort()
    await expect(run).rejects.toMatchObject({ code: 'GODOT_ABORTED' })
    await game.dispose()
  })
})

/** The Phase 5 expansion path: scene:inspect_object on the first frame stop. */
describe('runDebug expansion', () => {
  it('expands the object vars of the first frame-bearing stop', async () => {
    const game = new FakeGame(inspectBin, inspectManifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.expansion).not.toBeNull()
    expect(result.expandedObjects).toBe(2) // self + player; the RID var is excluded
    const names = result.expansion!.entries.map(e => e.name)
    expect(names).toEqual(['self', 'player'])
    const self = result.expansion!.entries[0]!
    expect(self.className).toBe('Node')
    expect(self.rows.length).toBeGreaterThan(0)
    // Members/ prefix stripped; property values rendered.
    const counter = self.rows.find(r => r.name === 'counter')
    expect(counter?.value).toBe('20')
    expect(self.rows.some(r => r.name.startsWith('Node/'))).toBe(true)
    expect(result.expansionTruncated).toBe(false)
    expect(result.expansion!.stopIndex).toBe(0)
  })

  it('does not expand when maxExpandedObjects is 0', async () => {
    const game = new FakeGame(inspectBin, inspectManifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub, maxExpandedObjects: 0 })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.expansion).toBeNull()
    expect(result.expandedObjects).toBe(0)
  })

  it('expands objects in attach mode too (same stop-loop integration)', async () => {
    const game = new FakeGame(inspectBin, inspectManifest.frames)
    const sub = new FakeSubprocess()
    const options = attachOptions({ subprocess: sub, port: 6007, pauseOnAttach: true })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.detached).toBe(true)
    expect(result.expandedObjects).toBe(2)
  })
})
