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
// The Phase 6 edit recording: expansion (self/player), four typed edits with
// per-edit re-inspect verification, then a second stop with re-expansion.
// Same object id is inspected repeatedly; FakeGame dispatches by per-id
// request sequence (plan D8).
const editBin = readFileSync(join(here, 'fixtures', 't6-edit.bin'))
const editManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't6-edit.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 7 scene-tree recording: two frame-bearing stops, each with a
// scene_tree response (identical tree, per-request sequence), plus a
// tree-node-id inspect.
const treeBin = readFileSync(join(here, 'fixtures', 't7-tree.bin'))
const treeManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't7-tree.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 8 nested-expansion recording: self (23 props) then its nested
// ObjectIds (member_a, player, arr[0], dict["k"]) — 5 inspect round-trips.
const nestedBin = readFileSync(join(here, 'fixtures', 't8-nested.bin'))
const nestedManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't8-nested.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 10 worker-thread recording: a worker-thread breakpoint pause
// (debug_enter threadId 46), then stack/vars fetched with the PAUSED thread
// id (the fixed-product path, T10.0 fact 3).
const workerBin = readFileSync(join(here, 'fixtures', 't10-worker.bin'))
const workerManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't10-worker.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 12 nested-edit recording: expansion (self, children[0],
// children[1], player), then four nested edits — two whole-container member
// rebuilds (arr[0], dict["hp"]), one nested-member rebuild (arr[4][0]) and
// one nested-object property edit (player.name) — each with path-walk and
// verify re-inspects (per-id request sequence).
const nestedEditBin = readFileSync(join(here, 'fixtures', 't14-edit.bin'))
const nestedEditManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't14-edit.json'), 'utf8')) as {
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
    maxExpandDepth: 1,
    maxEdits: 10,
    maxTreeNodes: 200,
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

  it('passes --single-threaded-scene when requested (T22, source-plugin parity)', async () => {
    const game = new FakeGame(bin, manifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub, singleThreadedScene: true })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    await runDebug(options)
    await game.dispose()
    const argv = sub.spawns[sub.spawns.length - 1]!.argv
    expect(argv).toContain('--single-threaded-scene')
    expect(argv[argv.indexOf('--remote-debug') + 1]).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/)
  })

  it('omits --single-threaded-scene by default', async () => {
    const game = new FakeGame(bin, manifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    await runDebug(options)
    await game.dispose()
    const argv = sub.spawns[sub.spawns.length - 1]!.argv
    expect(argv).not.toContain('--single-threaded-scene')
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
    await expect(runDebug(attachOptions({ singleThreadedScene: true }))).rejects.toMatchObject({
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

  it('expands explicit scene-tree node ids (T15), even with expansion otherwise off', async () => {
    const game = new FakeGame(inspectBin, inspectManifest.frames)
    const sub = new FakeSubprocess()
    // maxExpandedObjects = 0 disables the VARIABLE expansion, but explicit
    // node ids still expand (FakeGame dispatches inspect responses by id).
    const options = baseOptions({ subprocess: sub, maxExpandedObjects: 0, expandNodes: ['27061650910'] })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.expansion).not.toBeNull()
    expect(result.expandedObjects).toBe(1)
    expect(result.expansion!.entries[0]!.name).toBe('node:27061650910')
    expect(result.expansion!.entries[0]!.className).toBe('Node')
  })

  it('rejects malformed expandNodes ids with GODOT_PARSE_ERROR', async () => {
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub, expandNodes: ['abc'] })
    await expect(runDebug(options)).rejects.toMatchObject({ code: 'GODOT_PARSE_ERROR' })
  })

  it('resolves nodePaths against the stop tree and requests the node (T15)', async () => {
    // The t7 recording has the scene-tree response; its stop also carries a
    // player ObjectId, but no inspect responses exist in the recording — so
    // the resolved node request times out and flags truncation. That proves
    // nodePaths was parsed into an inspect request (expansion would be null
    // otherwise), while the tree itself stays intact.
    const game = new FakeGame(treeBin, treeManifest.frames)
    const sub = new FakeSubprocess()
    const options = baseOptions({ subprocess: sub, maxExpandedObjects: 0, nodePaths: ['Main'], maxTreeNodes: 200 })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.sceneTrees).not.toBeNull()
    expect(result.expansion).not.toBeNull() // nodePaths wired the request
    expect(result.expandedObjects).toBe(0)
    expect(result.expansionTruncated).toBe(true) // inspect had no answer in the fixture
  })

  it('fails a path: edit cleanly when no tree was snapshotted (T15)', async () => {
    const game = new FakeGame(inspectBin, inspectManifest.frames)
    const sub = new FakeSubprocess()
    // maxTreeNodes = 0: no tree → the path cannot resolve → the edit keeps
    // its target and fails with the standard not-editable detail.
    const options = baseOptions({ subprocess: sub, maxTreeNodes: 0, edits: [{ target: 'path:Main', property: 'counter', value: '42', type: 'int' }] })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.edits).not.toBeNull()
    expect(result.edits!.results[0]!.ok).toBe(false)
    expect(result.edits!.results[0]!.detail).toContain('not an editable object')
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

/** The Phase 12 nested-edit path: whole-container member rebuilds + a
 *  nested-object property edit. The fixture's expansion recurses to depth 2
 *  (self, children[0], children[1], player), and no scene tree is requested. */
describe('runDebug nested edits', () => {
  function nestedOptions(overrides: Partial<DebugRunOptions> = {}): DebugRunOptions {
    return {
      ...baseOptions({ subprocess: new FakeSubprocess() }),
      edits: [
        { target: 'self', property: 'arr[0]', value: '99', type: 'int' },
        { target: 'self', property: 'dict["hp"]', value: '50', type: 'int' },
        { target: 'self', property: 'arr[4][0]', value: '30', type: 'int' },
        { target: 'self', property: 'player.name', value: 'P2', type: 'string' },
      ],
      maxExpandDepth: 2,
      maxTreeNodes: 0,
      maxStops: 1,
      ...overrides,
    }
  }

  it('applies nested member edits and nested-object property edits, all verified', async () => {
    const game = new FakeGame(nestedEditBin, nestedEditManifest.frames)
    const options = nestedOptions()
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.edits).not.toBeNull()
    expect(result.editsApplied).toBe(4)
    expect(result.editsTruncated).toBe(false)
    expect(result.edits!.stopIndex).toBe(0)
    expect(result.edits!.results.map(r => r.ok)).toEqual([true, true, true, true])
    // Expansion ran on the same stop before the edits (fixture order):
    // self (top level, with children[0]/children[1] nested) + player (a
    // top-level variable itself, so the NESTED self.player is deduplicated
    // away — T8.0 fact 2: top level wins).
    expect(result.expandedObjects).toBe(4)
    expect(result.expansion!.entries[0]!.children!.map(c => c.name)).toEqual(['children[0]', 'children[1]'])
    expect(result.expansion!.entries[1]!.name).toBe('player')
  })

  it('flags an edit whose container holds object references (gate)', async () => {
    const game = new FakeGame(nestedEditBin, nestedEditManifest.frames)
    const options = nestedOptions({
      edits: [{ target: 'self', property: 'children[0]', value: '5', type: 'int' }],
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.editsApplied).toBe(0)
    expect(result.editsTruncated).toBe(true)
    expect(result.edits!.results[0]!.detail).toContain('object references')
  })
})

/** The Phase 6 edit path: scene:set_object_property on the first frame stop. */
describe('runDebug edits', () => {
  /** Full pipeline options: expansion runs first (fixture order), then the
   *  four typed edits verified by re-inspect. */
  function editOptions(overrides: Partial<DebugRunOptions> = {}): DebugRunOptions {
    return {
      ...baseOptions({ subprocess: new FakeSubprocess() }),
      edits: [
        { target: 'self', property: 'counter', value: '42', type: 'int' },
        { target: 'self', property: 'speed', value: '2.5', type: 'float' },
        { target: 'self', property: 'label_text', value: 'changed', type: 'string' },
        { target: 'self', property: 'flag', value: 'true', type: 'bool' },
      ],
      ...overrides,
    }
  }

  it('applies the four typed edits on the first frame-bearing stop and verifies them', async () => {
    const game = new FakeGame(editBin, editManifest.frames)
    const options = editOptions()
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.edits).not.toBeNull()
    expect(result.editsApplied).toBe(4)
    expect(result.editsTruncated).toBe(false)
    expect(result.edits!.stopIndex).toBe(0)
    expect(result.edits!.results.map(r => r.ok)).toEqual([true, true, true, true])
    expect(result.edits!.results[0]).toEqual({ target: 'self', property: 'counter', requested: 42, type: 'int', ok: true })
    // Expansion still ran on the same stop, before the edits (fixture order).
    expect(result.expandedObjects).toBe(2)
    const self = result.expansion!.entries[0]!
    expect(self.rows.find(r => r.name === 'counter')?.value).toBe('20') // pre-edit baseline
  })

  it('does not apply edits when maxEdits is 0', async () => {
    const game = new FakeGame(editBin, editManifest.frames)
    const options = editOptions({ maxEdits: 0 })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.edits).toBeNull()
    expect(result.editsApplied).toBe(0)
    // Expansion is independent and still runs.
    expect(result.expandedObjects).toBe(2)
  })

  it('applies edits in attach mode too (same stop-loop integration)', async () => {
    const game = new FakeGame(editBin, editManifest.frames)
    const options = attachOptions({
      subprocess: new FakeSubprocess(),
      port: 6007,
      pauseOnAttach: true,
      edits: editOptions().edits,
      maxEdits: 10,
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.detached).toBe(true)
    expect(result.editsApplied).toBe(4)
    expect(result.editsTruncated).toBe(false)
  })
})

/** The Phase 7 scene-tree path: scene:request_scene_tree per frame stop. */
describe('runDebug scene trees', () => {
  it('snapshots the scene tree on every frame-bearing stop', async () => {
    const game = new FakeGame(treeBin, treeManifest.frames)
    const options = baseOptions({ subprocess: new FakeSubprocess(), maxExpandedObjects: 0 })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.sceneTrees).not.toBeNull()
    expect(result.sceneTreeCount).toBe(2) // both stops have a frame
    expect(result.sceneTreeTruncated).toBe(false)
    const [t0, t1] = result.sceneTrees!
    expect(t0!.stopIndex).toBe(0)
    expect(t1!.stopIndex).toBe(1)
    // The tree root is the engine Window root; Main carries the script path.
    expect(t0!.lines[0]).toBe('root [Window] (26323453389)')
    expect(t0!.lines[1]).toBe('  Main [res://main.gd] (26994542042) res://main.tscn')
    expect(t0!.lines.some(l => l.includes('Leaf中文'))).toBe(true)
    expect(t1!.lines).toEqual(t0!.lines) // static scene: identical tree (T7.0 fact 5)
    // The tree-node id was inspectable (fixture includes the tree-id inspect).
    expect(result.expandedObjects).toBe(0) // expansion disabled in this run
  })

  it('does not snapshot trees when maxTreeNodes is 0', async () => {
    const game = new FakeGame(treeBin, treeManifest.frames)
    const options = baseOptions({ subprocess: new FakeSubprocess(), maxExpandedObjects: 0, maxTreeNodes: 0 })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.sceneTrees).toBeNull()
    expect(result.sceneTreeCount).toBe(0)
  })

  it('snapshots trees in attach mode too (same stop-loop integration)', async () => {
    const game = new FakeGame(treeBin, treeManifest.frames)
    const options = attachOptions({
      subprocess: new FakeSubprocess(),
      port: 6007,
      pauseOnAttach: true,
      maxExpandedObjects: 0,
    })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.detached).toBe(true)
    expect(result.sceneTreeCount).toBeGreaterThan(0)
  })
})

/** The Phase 8 nested expansion path: recursion into property ObjectIds. */
describe('runDebug nested expansion', () => {
  /** Full pipeline options: expansion with maxDepth 2 (the t8 fixture order:
   *  top-level self/player, then nested member_a/arr[0]/dict["k"]). */
  function nestedOptions(overrides: Partial<DebugRunOptions> = {}): DebugRunOptions {
    return {
      ...baseOptions({ subprocess: new FakeSubprocess() }),
      maxExpandDepth: 2,
      ...overrides,
    }
  }

  it('recursively expands nested object values with location paths', async () => {
    const game = new FakeGame(nestedBin, nestedManifest.frames)
    const options = nestedOptions()
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.expansion).not.toBeNull()
    // Top level: self + member_a + player (all three are top-level ObjectId
    // vars in the t8 project). self's nested ids (member_a, player, arr[0],
    // dict["k"]) recurse; member_a and player are deduped (top-level reserve,
    // T8.0 fact 2) — the nested children are arr[0] and dict["k"] only.
    expect(result.expandedObjects).toBe(5)
    expect(result.expansionTruncated).toBe(false)
    const self = result.expansion!.entries.find(e => e.name === 'self')
    expect(self).toBeDefined()
    expect(self!.children?.map(c => c.name)).toEqual(['arr[0]', 'dict["k"]'])
    const arr0 = self!.children?.find(c => c.name === 'arr[0]')
    expect(arr0!.className).toBe('Node')
    // The deduped top-level player/member_a are sibling entries.
    expect(result.expansion!.entries.some(e => e.name === 'player')).toBe(true)
    expect(result.expansion!.entries.some(e => e.name === 'member_a')).toBe(true)
  })

  it('depth 1 (Phase 5 default) does not recurse', async () => {
    const game = new FakeGame(nestedBin, nestedManifest.frames)
    const options = nestedOptions({ maxExpandDepth: 1 })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    // The three top-level ObjectIds expand; nothing recurses into children.
    expect(result.expandedObjects).toBe(3)
    const self = result.expansion!.entries.find(e => e.name === 'self')
    expect(self!.children).toBeUndefined()
  })
})

/** The Phase 10 worker-thread path: paused thread id drives commands. */
describe('runDebug worker thread', () => {
  it('reports the worker thread id and fetches its stack with it', async () => {
    const game = new FakeGame(workerBin, workerManifest.frames)
    const options = baseOptions({ subprocess: new FakeSubprocess(), maxExpandedObjects: 0, maxTreeNodes: 0 })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    // The worker pause: threadId 46, stack from the worker loop line 18.
    expect(result.stops).toHaveLength(1)
    expect(result.stops[0]!.threadId).toBe(46)
    expect(result.stops[0]!.reason).toBe('Breakpoint')
    const frame = result.stops[0]!.snapshot.frames[0]
    expect(frame).toEqual({ file: 'res://main.gd', line: 18, func: '_worker_loop' })
    // Vars came back too (fetched with the paused thread id — the fixed path).
    expect(result.stops[0]!.snapshot.scopes.members.length).toBeGreaterThan(0)
    expect(result.stops[0]!.snapshot.scopes.members.some(v => v.name === 'worker_count')).toBe(true)
  })

  it('does not mark the main thread (threadId 1 renders without a marker)', async () => {
    const game = new FakeGame(bin, manifest.frames) // t3 single-thread fixture
    const options = baseOptions({ subprocess: new FakeSubprocess(), maxExpandedObjects: 0, maxTreeNodes: 0 })
    options.onPort = async (port: number) => {
      await game.connect(port)
    }
    const result = await runDebug(options)
    await game.dispose()
    expect(result.stops.every(s => s.threadId === 1)).toBe(true)
  })
})
