/**
 * The interactive debug session (T21): service-level tests over a scripted
 * fake game (real codecs, test-driven frames). Coverage: full pause flow,
 * command surface (continue/step/next/breakpoint/edits), detach paths
 * (stop/timeout/disconnect/error), single-session rule, port validation,
 * busy rejection, poll versioning and snapshot contents.
 */

import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createDebugSessionService, type DebugSessionService, type DebugSessionServiceOptions } from '../src/session-service.ts'
import { ScriptedGame } from './fixtures/scripted-game.ts'
import { FakeSubprocess } from './fixtures/fake-subprocess.ts'

const PROJECT_ROOT = 'C:\\game'

function makeService(overrides: Partial<DebugSessionServiceOptions> = {}): DebugSessionService {
  return createDebugSessionService({
    maxMessageBytes: 16_000_000,
    maxOutputBytes: 1_000_000,
    maxTreeNodes: 200,
    idleTimeoutMs: 60_000,
    idleCheckIntervalMs: 25,
    ...overrides,
  })
}

/** A game that answers a full pause: stack dump, N vars, and a scene tree
 *  (empty by default — an unanswered tree request stalls buildPause for the
 *  full TREE_TIMEOUT, so tests must never leave it dangling). */
function pauseAwareGame(opts: {
  vars?: { name: string; scope: number; value: unknown; className?: string }[]
  /** The FULL `scene:scene_tree` params array (flat, T7.0 fact 1). */
  tree?: unknown[]
  noTree?: boolean
} = {}): ScriptedGame {
  return new ScriptedGame((cmd, _params, game) => {
    if (cmd === 'get_stack_dump') {
      game.stackDump([{ file: 'res://main.gd', line: 12, func: '_ready' }])
    } else if (cmd === 'get_stack_frame_vars') {
      const vars = opts.vars ?? []
      game.stackFrameVars(vars.length)
      for (const v of vars) game.stackFrameVar(v.name, v.scope, v.value, v.className)
    } else if (cmd === 'scene:request_scene_tree') {
      if (opts.noTree !== true) {
        game.send('scene:scene_tree', opts.tree ?? [0, 'root', 'Window', 1n, '', 0])
      }
    }
  })
}

/** Bind-probe a free port (like pickFreePort). */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

/** Poll until the predicate holds or the budget elapses. */
async function waitFor(
  pred: () => boolean,
  label: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (pred()) return
    if (Date.now() > deadline) throw new Error(`waitFor ${label} timed out`)
    await new Promise((resolve) => { setTimeout(resolve, 15) })
  }
}

/** Poll the game's received log until the predicate holds (frames arrive
 *  asynchronously on the loopback socket — never assert immediately). */
async function waitForReceived(
  game: ScriptedGame,
  pred: (cmds: { cmd: string; params: unknown[] }[]) => boolean,
  label: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (pred(game.received())) return
    if (Date.now() > deadline) throw new Error(`waitForReceived ${label} timed out: ${JSON.stringify(game.received())}`)
    await new Promise((resolve) => { setTimeout(resolve, 15) })
  }
}

function isSnapshot(value: unknown): value is { state: string; version: number } {
  return value !== null && typeof value === 'object' && 'state' in value
}

function stateOf(service: DebugSessionService, sessionId: string): string {
  const s = service.poll(sessionId)
  return isSnapshot(s) ? s.state : 'unknown'
}

describe('debug session service', () => {
  const games: ScriptedGame[] = []
  const liveSessions: { service: DebugSessionService; sessionId: string }[] = []
  afterEach(async () => {
    for (const g of games.splice(0)) g.close()
    // Stop every live session: a leftover listener would hold its port and
    // interfere with the next test's free-port probe.
    for (const { service, sessionId } of liveSessions.splice(0)) service.stop(sessionId)
  })

  it('codec sanity: nested scene-tree params round-trip', async () => {
    const { VariantEncoder } = await import('../src/variant-encoder.ts')
    const { VariantDecoder } = await import('../src/variant-decoder.ts')
    const enc = new VariantEncoder()
    const dec = new VariantDecoder()
    const buf = enc.encodeMessage(['scene:scene_tree', 1, [1, 'root', 'Window', 1n, '', 0, [0, 'Main', 'Node2D', 7n, '', 0]]])
    const decoded = dec.decodeMessage(buf.subarray(4)) // payload after the [u32 len] header
    expect(decoded[2]).toEqual([1, 'root', 'Window', 1n, '', 0, [0, 'Main', 'Node2D', 7n, '', 0]])
  })

  it('debug session direct: connect + command reaches the game', async () => {
    const { DebugSession } = await import('../src/session.ts')
    const port = await freePort()
    const session = new DebugSession('s1', port, PROJECT_ROOT, { maxMessageBytes: 16_000_000, maxOutputBytes: 1_000_000, maxTreeNodes: 200 }, 60_000, 60_000, 25)
    const game = new ScriptedGame()
    games.push(game)
    void session.connect()
    await game.connectTo(port)
    game.setPid()
    await waitFor(() => session.state === 'running', 'running')
    await session.command({ kind: 'breakpoint', file: 'res://main.gd', line: 12, enabled: true })
    await new Promise((resolve) => { setTimeout(resolve, 200) })
    session.detach('stop')
    expect(game.received().some(c => c.cmd === 'breakpoint')).toBe(true)
  })

  async function startSession(service: DebugSessionService, overrides: { port?: number; projectRoot?: string } = {}): Promise<string> {
    const port = overrides.port ?? await freePort()
    const started = await service.start({ port, projectRoot: overrides.projectRoot ?? PROJECT_ROOT })
    expect(started).toMatchObject({ state: 'connecting', port })
    const sessionId = (started as { sessionId: string }).sessionId
    liveSessions.push({ service, sessionId })
    return sessionId
  }

  /** Connect + set_pid + wait for ready; returns the session id. */
  async function boot(service: DebugSessionService, game: ScriptedGame, port?: number): Promise<string> {
    games.push(game)
    const sessionId = await startSession(service, port !== undefined ? { port } : {})
    await game.connectTo((service.poll(sessionId) as { port: number }).port)
    game.setPid()
    await waitFor(() => stateOf(service, sessionId) === 'running', 'running')
    return sessionId
  }

  it('connects, pauses with a full snapshot, and continues on command', async () => {
    const service = makeService()
    const game = pauseAwareGame({
      vars: [{ name: 'counter', scope: 0, value: 1 }],
      tree: [1, 'root', 'Window', 1n, '', 0, 0, 'Main', 'Node2D', 7n, '', 0],
    })
    const sessionId = await boot(service, game)

    game.debugEnter(true, '')
    await waitFor(() => stateOf(service, sessionId) === 'paused', 'paused')

    const snapshot = service.poll(sessionId) as {
      pause: {
        stops: {
          index: number
          reason: string
          isUserBreakpoint: boolean
          threadId: number
          frames: { file: string; line: number; func: string }[]
          varsLines: string[]
          sceneTree: { lines: string[] }
        }[]
      }
    }
    const stop = snapshot.pause.stops[0]
    expect(stop).toMatchObject({
      index: 0,
      reason: '',
      isUserBreakpoint: true,
      threadId: 1,
      frames: [{ file: 'res://main.gd', line: 12, func: '_ready' }],
    })
    expect(stop.varsLines).toEqual(['  locals:', '    counter = 1'])
    expect(stop.sceneTree.lines).toContain('root [Window] (1)')

    const versionBefore = (service.poll(sessionId) as { version: number }).version
    const cont = await service.command(sessionId, { kind: 'continue' })
    expect(cont).toEqual({ ok: true })
    await waitFor(() => stateOf(service, sessionId) === 'running', 'running after continue')

    game.debugEnter(false, 'error')
    await waitFor(() => stateOf(service, sessionId) === 'paused', 'second pause')
    expect((service.poll(sessionId) as { version: number }).version).toBeGreaterThan(versionBefore)
    expect((service.poll(sessionId) as { pause: { stops: { reason: string }[] } }).pause.stops[0].reason).toBe('error')
  })

  it('sends step and next and moves back to running', async () => {
    const service = makeService()
    const game = pauseAwareGame()
    const sessionId = await boot(service, game)
    game.debugEnter(true, '')
    await waitFor(() => stateOf(service, sessionId) === 'paused', 'paused')

    const stepResult = await service.command(sessionId, { kind: 'step' })
    const nextResult = await service.command(sessionId, { kind: 'next' })
    expect(stepResult).toEqual({ ok: true })
    expect(nextResult).toEqual({ ok: true })
    await waitForReceived(game, cmds => cmds.some(c => c.cmd === 'step') && cmds.some(c => c.cmd === 'next'), 'step+next frames')
    expect(stateOf(service, sessionId)).toBe('running')
  })

  it('adds and removes breakpoints through the protocol and the poll list', async () => {
    const service = makeService()
    const game = pauseAwareGame()
    const port = await freePort()
    const sessionId = await startSession(service, { port })
    games.push(game)
    await game.connectTo(port)
    game.setPid()
    await waitFor(() => stateOf(service, sessionId) === 'running', 'running')

    expect(await service.command(sessionId, { kind: 'breakpoint', file: 'res://main.gd', line: 12, enabled: true })).toEqual({ ok: true })
    await service.command(sessionId, { kind: 'breakpoint', file: 'res://player.gd', line: 8, enabled: true })
    expect((service.poll(sessionId) as { breakpoints: { file: string; line: number }[] }).breakpoints).toEqual([
      { file: 'res://main.gd', line: 12 },
      { file: 'res://player.gd', line: 8 },
    ])
    await waitForReceived(game, cmds => cmds.filter(c => c.cmd === 'breakpoint').length >= 2, 'both breakpoints sent')
    const sent = game.received().filter(c => c.cmd === 'breakpoint').map(c => c.params)
    expect(sent).toContainEqual(['res://main.gd', 12, true])
    expect(sent).toContainEqual(['res://player.gd', 8, true])

    await service.command(sessionId, { kind: 'breakpoint', file: 'res://main.gd', line: 12, enabled: false })
    await waitForReceived(game, cmds => cmds.filter(c => c.cmd === 'breakpoint').some(c => c.params[2] === false), 'breakpoint removal')
    expect((service.poll(sessionId) as { breakpoints: { file: string; line: number }[] }).breakpoints).toEqual([{ file: 'res://player.gd', line: 8 }])
  })

  it('applies edits while paused (failure path: scalar target, success path is real-machine covered)', async () => {
    const service = makeService()
    const game = pauseAwareGame({ vars: [{ name: 'counter', scope: 0, value: 1 }] })
    const sessionId = await boot(service, game)

    game.debugEnter(true, '')
    await waitFor(() => stateOf(service, sessionId) === 'paused', 'paused')

    const result = await service.command(sessionId, {
      kind: 'edits',
      edits: [{ target: 'counter', property: 'value', value: '99', type: 'int' }],
    })
    // The command pipeline runs; a scalar target fails with the standard
    // not-editable result (the engine-side object edit success path needs a
    // real OBJECT frame — covered by the T21.6 real-machine smoke).
    expect(result).toMatchObject({ ok: true, edits: { results: [{ ok: false }] } })
  })

  it('rejects edits outside a pause', async () => {
    const service = makeService()
    const game = pauseAwareGame()
    const sessionId = await boot(service, game)
    const result = await service.command(sessionId, {
      kind: 'edits',
      edits: [{ target: 'self', property: 'counter', value: '1', type: 'int' }],
    })
    expect(result).toEqual({ ok: false, error: 'not-paused' })
  })

  it('detaches with reason disconnect when the game drops', async () => {
    const service = makeService()
    const game = pauseAwareGame()
    const sessionId = await boot(service, game)
    game.close()
    await waitFor(() => {
      const s = service.poll(sessionId)
      return isSnapshot(s) && s.state === 'detached' && (s as { reason: string }).reason === 'disconnect'
    }, 'detached disconnect')
  })

  it('detaches with reason timeout after command-idle time', async () => {
    const service = makeService({ idleTimeoutMs: 200 })
    const game = pauseAwareGame()
    const sessionId = await boot(service, game)
    await waitFor(() => {
      const s = service.poll(sessionId)
      return isSnapshot(s) && s.state === 'detached' && (s as { reason: string }).reason === 'timeout'
    }, 'detached timeout')
  })

  it('detaches with reason stop and sends defensive breakpoint removal + continue', async () => {
    const service = makeService()
    const game = pauseAwareGame()
    const sessionId = await boot(service, game)
    game.debugEnter(true, '')
    await waitFor(() => stateOf(service, sessionId) === 'paused', 'paused')
    await service.command(sessionId, { kind: 'breakpoint', file: 'res://main.gd', line: 12, enabled: true })

    expect(service.stop(sessionId)).toEqual({ ok: true })
    await waitFor(() => {
      const s = service.poll(sessionId)
      return isSnapshot(s) && s.state === 'detached' && (s as { reason: string }).reason === 'stop'
    }, 'detached stop')
    await waitForReceived(game, cmds => cmds.some(c => c.cmd === 'continue'), 'defensive continue')
  })

  it('detaches with reason error and detail when the port is already bound', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = blocker.address() as { port: number }
    const service = makeService()
    const sessionId = await startSession(service, { port: address.port })
    await waitFor(() => stateOf(service, sessionId) === 'detached', 'detached error')
    const snap = service.poll(sessionId) as { reason: string; errorDetail: string }
    expect(snap.reason).toBe('error')
    expect(snap.errorDetail).toMatch(/EADDRINUSE|listen EADDR/)
    await new Promise<void>((resolve) => { blocker.close(() => { resolve() }) })
  })

  it('refuses a second session while one is active', async () => {
    const service = makeService()
    const game = pauseAwareGame()
    await boot(service, game)
    const second = await service.start({ port: await freePort(), projectRoot: PROJECT_ROOT })
    expect(second).toEqual({ error: 'session-active' })
  })

  it('validates the port range', async () => {
    const service = makeService()
    expect(await service.start({ port: 0, projectRoot: PROJECT_ROOT })).toEqual({ error: 'port-invalid' })
    expect(await service.start({ port: 70_000, projectRoot: PROJECT_ROOT })).toEqual({ error: 'port-invalid' })
  })

  it('answers unknown sessions on poll/command', () => {
    const service = makeService()
    expect(service.poll('nope')).toEqual({ error: 'unknown-session' })
    expect(service.command('nope', { kind: 'pause' })).toEqual({ error: 'unknown-session' })
  })

  it('rejects a command while the pause snapshot is being built (busy)', async () => {
    // The game answers set_pid but NOT get_stack_dump → buildPause hangs;
    // commands are rejected until the snapshot times out into a truncated
    // paused state.
    const service = makeService()
    const game = new ScriptedGame()
    const sessionId = await boot(service, game)
    game.debugEnter(true, '')
    await new Promise((resolve) => { setTimeout(resolve, 120) }) // let buildPause start
    expect(await service.command(sessionId, { kind: 'pause' })).toEqual({ ok: false, error: 'session-busy' })
    await waitFor(() => stateOf(service, sessionId) === 'paused', 'paused after snapshot timeout', 12_000)
  }, 20_000)

  it('surfaces output and error tails in the snapshot', async () => {
    const service = makeService()
    const game = new ScriptedGame()
    const sessionId = await boot(service, game)
    game.send('output', [['hello game']]) // params[0] = PackedStringArray
    // error params are FLAT: [hr, min, sec, msec, file, func, line, error, desc, warning, stackCount, ...stack]
    game.send('error', [0, 0, 0, 0, 'res://main.gd', '_ready', 3, 'boom', '', false, 0])
    await waitFor(() => {
      const s = service.poll(sessionId)
      return isSnapshot(s) && (s as { outputTail: string[] }).outputTail.includes('hello game')
    }, 'output tail', 8_000)
    expect((service.poll(sessionId) as { errors: string[] }).errors).toContain('res://main.gd:3 error: boom')
  })

  it('includes the scene tree in a frame-bearing pause snapshot', async () => {
    const service = makeService()
    const game = pauseAwareGame({
      // T7.0 fact 1: params are FLAT — children interleave depth-first as
      // `[childCount, name, className, id, sceneFilePath, viewFlags, ...]`.
      tree: [2, 'root', 'Window', 1n, '', 0,
        0, 'Main', 'Node2D', 7n, '', 0,
        0, 'Player', 'CharacterBody2D', 8n, '', 0],
    })
    const sessionId = await boot(service, game)
    game.debugEnter(true, '')
    await waitFor(() => stateOf(service, sessionId) === 'paused', 'paused')
    const snap = service.poll(sessionId) as { pause: { stops: { sceneTree: { lines: string[] } }[] } }
    const lines = snap.pause.stops[0].sceneTree.lines
    expect(lines).toContain('root [Window] (1)')
    expect(lines).toContain('  Main [Node2D] (7)')
    expect(lines).toContain('  Player [CharacterBody2D] (8)')
  })

  // ---- T21.8: launch-mode sessions (the session spawns the game) ----

  it('launch mode: version-gates, spawns the game, and terminates it on stop', async () => {
    const sub = new FakeSubprocess()
    const service = makeService({ subprocess: sub })
    const started = await service.start({ mode: 'launch', executable: 'godot', projectRoot: PROJECT_ROOT })
    expect(started).toMatchObject({ state: 'connecting', mode: 'launch' })
    const sessionId = (started as { sessionId: string }).sessionId
    liveSessions.push({ service, sessionId })
    // Two spawns: the version probe (resolved immediately) then the game.
    await waitFor(() => sub.spawns.length >= 2, 'game spawn')
    const gameSpawn = sub.spawns[1]!
    expect(gameSpawn.argv[0]).toBe('godot')
    expect(gameSpawn.argv).toContain('--headless')
    expect(gameSpawn.argv).toContain('--path')
    expect(gameSpawn.argv).toContain('--remote-debug')
    expect(gameSpawn.argv[gameSpawn.argv.indexOf('--remote-debug') + 1]).toMatch(/^tcp:\/\/127\.0\.0\.1:\d+$/)

    // The game connects into the pre-picked port and the session runs.
    const game = pauseAwareGame()
    games.push(game)
    const port = (service.poll(sessionId) as { port: number }).port
    await game.connectTo(port)
    game.setPid()
    await waitFor(() => stateOf(service, sessionId) === 'running', 'running')
    game.debugEnter(true, '')
    await waitFor(() => stateOf(service, sessionId) === 'paused', 'paused')

    // stop detaches AND terminates the spawned process tree (launch owns it).
    expect(service.stop(sessionId)).toEqual({ ok: true })
    await waitFor(() => stateOf(service, sessionId) === 'detached', 'detached')
    expect((service.poll(sessionId) as { reason: string }).reason).toBe('stop')
    expect(gameSpawn.handle.terminated).toBe(true)
  })

  it('launch mode: passes scene/args/singleThreadedScene through to the game argv', async () => {
    const sub = new FakeSubprocess()
    const service = makeService({ subprocess: sub })
    const started = await service.start({
      mode: 'launch',
      executable: 'godot',
      projectRoot: PROJECT_ROOT,
      scene: 'res://main.tscn',
      args: ['--fixed-fps', '60'],
      singleThreadedScene: true,
    })
    expect('error' in started).toBe(false)
    const sessionId = (started as { sessionId: string }).sessionId
    liveSessions.push({ service, sessionId })
    await waitFor(() => sub.spawns.length >= 2, 'game spawn')
    const argv = sub.spawns[1]!.argv
    expect(argv).toContain('res://main.tscn')
    expect(argv).toContain('--single-threaded-scene')
    expect(argv[argv.indexOf('--') + 1]).toBe('--fixed-fps')
    service.stop(sessionId)
  })

  it('launch mode: fails fast with stderr when the game exits before connecting', async () => {
    const sub = new FakeSubprocess()
    const service = makeService({ subprocess: sub })
    const started = await service.start({ mode: 'launch', executable: 'godot', projectRoot: PROJECT_ROOT })
    expect('error' in started).toBe(false)
    const sessionId = (started as { sessionId: string }).sessionId
    liveSessions.push({ service, sessionId })
    await waitFor(() => sub.spawns.length >= 2, 'game spawn')
    sub.spawns[1]!.handle.exitNow({ exitCode: 1, signal: null })
    await waitFor(() => stateOf(service, sessionId) === 'detached', 'detached')
    const snap = service.poll(sessionId) as { reason: string; errorDetail: string }
    expect(snap.reason).toBe('error')
    expect(snap.errorDetail).toMatch(/exited before connecting/)
  })

  it('launch mode: rejects a sub-4.2 version with a readable detach', async () => {
    const sub = new FakeSubprocess()
    sub.versionLine = '3.5.3.stable.official'
    const service = makeService({ subprocess: sub })
    const started = await service.start({ mode: 'launch', executable: 'godot', projectRoot: PROJECT_ROOT })
    expect('error' in started).toBe(false)
    const sessionId = (started as { sessionId: string }).sessionId
    liveSessions.push({ service, sessionId })
    await waitFor(() => stateOf(service, sessionId) === 'detached', 'detached')
    const snap = service.poll(sessionId) as { reason: string; errorDetail: string }
    expect(snap.reason).toBe('error')
    expect(snap.errorDetail).toMatch(/requires Godot 4\.2/)
  })

  it('launch mode: validates the executable and the subprocess seam', async () => {
    const noSeam = makeService()
    expect(await noSeam.start({ mode: 'launch', executable: 'godot', projectRoot: PROJECT_ROOT })).toEqual({ error: 'launch-invalid' })
    const withSeam = makeService({ subprocess: new FakeSubprocess() })
    expect(await withSeam.start({ mode: 'launch', projectRoot: PROJECT_ROOT })).toEqual({ error: 'launch-invalid' })
    expect(await withSeam.start({ mode: 'launch', executable: '', projectRoot: PROJECT_ROOT })).toEqual({ error: 'launch-invalid' })
  })
})
