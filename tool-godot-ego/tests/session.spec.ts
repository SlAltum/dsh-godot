/**
 * Session lifecycle: handshake validation, request/reply, timeouts, loss
 * detection, and idempotent disposal. The bridge is an in-process fake that
 * connects to the session's loopback listener, so these tests exercise the
 * real socket path without a Godot process.
 */

import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { GameSession } from '../src/session.ts'
import { attachFakeBridge } from './fixtures/fake-bridge.ts'
import type { FakeBridge, FakeBridgeOptions } from './fixtures/fake-bridge.ts'

interface HarnessOptions {
  readonly bridge?: Partial<FakeBridgeOptions>
  readonly token?: string
  readonly handshakeTimeoutMs?: number
  readonly requestTimeoutMs?: number
  readonly maxLineChars?: number
  readonly onBridge?: (bridge: FakeBridge) => void
}

/** Build a session wired to a fake bridge and a fake process handle. */
function createHarness(options: HarnessOptions = {}) {
  let terminates = 0
  let settleProcess!: (outcome: SubprocessOutcome) => void
  let failProcess!: (error: unknown) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => { settleProcess = resolve; failProcess = reject })
  const handle: SubprocessHandle = {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {},
    done,
    terminate: () => { terminates += 1 },
    waitForExit: () => Promise.resolve(true),
  }
  let bridge: FakeBridge | undefined
  const session = new GameSession({
    sessionId: 's1',
    workspace: '/ws',
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 1_000,
    requestTimeoutMs: options.requestTimeoutMs ?? 200,
    graceMs: 100,
    ...(options.maxLineChars !== undefined ? { maxLineChars: options.maxLineChars } : {}),
    ...(options.token !== undefined ? { randomToken: () => options.token as string } : {}),
    spawnGame: ({ port, token }) => {
      bridge = attachFakeBridge(port, { ...options.bridge, token: options.bridge?.token ?? token })
      options.onBridge?.(bridge)
      return handle
    },
  })
  return {
    session,
    get bridge(): FakeBridge | undefined { return bridge },
    get terminates(): number { return terminates },
    finish: (code: number | null, signal: NodeJS.Signals | null = null) => { settleProcess({ exitCode: code, signal }) },
    failProcess: (error: unknown) => { failProcess(error) },
  }
}

/** Wait until the session reaches a state. */
async function expectState(session: GameSession, state: string): Promise<void> {
  await vi.waitFor(() => { expect(session.snapshot().state).toBe(state) })
}

describe('handshake', () => {
  it('starts ready and reports the handshake fields', async () => {
    const h = createHarness({ bridge: { pid: 4321, window: [640, 400] } })
    try {
      const snapshot = await h.session.start()
      expect(snapshot).toMatchObject({
        sessionId: 's1',
        workspace: '/ws',
        state: 'ready',
        pid: 4321,
        window: [640, 400],
        lostReason: null,
      })
      expect(snapshot.port).toBeGreaterThan(0)
    } finally {
      await h.session.dispose()
    }
  })

  it('tolerates a hello without pid or window', async () => {
    const h = createHarness({ bridge: { pid: undefined, window: undefined } })
    try {
      const snapshot = await h.session.start()
      expect(snapshot.pid).toBeNull()
      expect(snapshot.window).toBeNull()
    } finally {
      await h.session.dispose()
    }
  })

  it('ignores a malformed window value', async () => {
    const h = createHarness({ bridge: { window: 'wide' } })
    try {
      const snapshot = await h.session.start()
      expect(snapshot.window).toBeNull()
    } finally {
      await h.session.dispose()
    }
  })

  it('rejects a token mismatch and terminates the process', async () => {
    const h = createHarness({ token: 'expected', bridge: { token: 'other' } })
    await expect(h.session.start()).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    expect(h.terminates).toBe(1)
  })

  it('rejects an unsupported protocol', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok', protocol: 2 } })
    await expect(h.session.start()).rejects.toThrow(/protocol 2/)
    expect(h.terminates).toBe(1)
  })

  it('times out when the bridge stays silent', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok', sendHello: false }, handshakeTimeoutMs: 50 })
    await expect(h.session.start()).rejects.toMatchObject({ code: 'GODOT_EGO_TIMEOUT' })
    expect(h.terminates).toBe(1)
  })

  it('loses the session when the socket closes before hello', async () => {
    const h = createHarness({
      token: 'tok',
      bridge: { token: 'tok', sendHello: false },
      onBridge: (bridge) => { bridge.socket.once('connect', () => { bridge.close() }) },
    })
    await expect(h.session.start()).rejects.toMatchObject({ code: 'GODOT_EGO_LOST' })
  })

  it('refuses a second start', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await h.session.start()
      await expect(h.session.start()).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    } finally {
      await h.session.dispose()
    }
  })
})

describe('requests', () => {
  it('round-trips one command', async () => {
    const h = createHarness({
      token: 'tok',
      bridge: { token: 'tok', reply: command => (command.cmd === 'ping' ? { ok: true, pong: true } : undefined) },
    })
    try {
      await h.session.start()
      const reply = await h.session.request('ping')
      expect(reply.kind).toBe('ok')
      expect(reply.payload.pong).toBe(true)
    } finally {
      await h.session.dispose()
    }
  })

  it('times out one unanswered request', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' }, requestTimeoutMs: 40 })
    try {
      await h.session.start()
      await expect(h.session.request('silent')).rejects.toMatchObject({ code: 'GODOT_EGO_TIMEOUT' })
    } finally {
      await h.session.dispose()
    }
  })

  it('surfaces a bridge rejection', async () => {
    const h = createHarness({
      token: 'tok',
      bridge: { token: 'tok', reply: () => ({ ok: false, code: 'REJECTED', message: 'not allowed' }) },
    })
    try {
      await h.session.start()
      await expect(h.session.request('eval')).rejects.toThrow(/not allowed/)
    } finally {
      await h.session.dispose()
    }
  })

  it('rejects before ready and after disposal', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    await expect(h.session.request('ping')).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
    await h.session.start()
    await h.session.dispose()
    await expect(h.session.request('ping')).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })

  it('honors an already-aborted signal and a later abort', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await h.session.start()
      const pre = new AbortController()
      pre.abort()
      await expect(h.session.request('ping', {}, pre.signal)).rejects.toMatchObject({ code: 'GODOT_EGO_ABORTED' })

      const later = new AbortController()
      const pending = h.session.request('slow', {}, later.signal)
      const timer = setTimeout(() => { later.abort() }, 10)
      await expect(pending).rejects.toMatchObject({ code: 'GODOT_EGO_ABORTED' })
      clearTimeout(timer)
    } finally {
      await h.session.dispose()
    }
  })
})

describe('loss detection', () => {
  it('loses on process exit and rejects in-flight requests', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await h.session.start()
      const reasons: string[] = []
      h.session.onLost(reason => reasons.push(reason))
      const pending = h.session.request('slow')
      h.finish(1)
      await expect(pending).rejects.toMatchObject({ code: 'GODOT_EGO_LOST' })
      await expectState(h.session, 'lost')
      expect(reasons).toEqual(['game exited with code 1'])
      expect(h.session.snapshot().lostReason).toMatch(/code 1/)
    } finally {
      await h.session.dispose()
    }
  })

  it('reports a signal termination', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await h.session.start()
      h.finish(null, 'SIGTERM')
      await expectState(h.session, 'lost')
      expect(h.session.snapshot().lostReason).toBe('game terminated by SIGTERM')
    } finally {
      await h.session.dispose()
    }
  })

  it('loses when the process promise rejects (Error and non-Error)', async () => {
    const asError = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await asError.session.start()
      asError.failProcess(new Error('spawn died'))
      await expectState(asError.session, 'lost')
      expect(asError.session.snapshot().lostReason).toBe('game process failure: spawn died')
    } finally {
      await asError.session.dispose()
    }
    const asString = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await asString.session.start()
      asString.failProcess('boom')
      await expectState(asString.session, 'lost')
      expect(asString.session.snapshot().lostReason).toBe('game process failure: boom')
    } finally {
      await asString.session.dispose()
    }
  })

  it('loses when the socket closes', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await h.session.start()
      h.bridge?.close()
      await expectState(h.session, 'lost')
      expect(h.session.snapshot().lostReason).toBe('bridge connection closed')
    } finally {
      await h.session.dispose()
    }
  })

  it('loses on malformed and unrecognized replies', async () => {
    const malformed = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await malformed.session.start()
      malformed.bridge?.socket.write('not json\n')
      await expectState(malformed.session, 'lost')
      expect(malformed.session.snapshot().lostReason).toBe('bridge sent a malformed reply')
    } finally {
      await malformed.session.dispose()
    }
    const unrecognized = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await unrecognized.session.start()
      unrecognized.bridge?.socket.write('{"foo":1}\n')
      await expectState(unrecognized.session, 'lost')
      expect(unrecognized.session.snapshot().lostReason).toBe('bridge sent an unrecognized reply')
    } finally {
      await unrecognized.session.dispose()
    }
  })

  it('loses when a reply exceeds the line cap', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' }, maxLineChars: 64 })
    try {
      await h.session.start()
      h.bridge?.socket.write(`${'x'.repeat(128)}\n`)
      await expectState(h.session, 'lost')
      expect(h.session.snapshot().lostReason).toBe('bridge reply exceeded the line cap')
    } finally {
      await h.session.dispose()
    }
  })

  it('keeps notifying listeners when one throws', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await h.session.start()
      const seen: string[] = []
      h.session.onLost(() => { throw new Error('listener exploded') })
      h.session.onLost(reason => seen.push(reason))
      h.finish(0)
      await expectState(h.session, 'lost')
      expect(seen).toEqual(['game exited with code 0'])
    } finally {
      await h.session.dispose()
    }
  })

  it('drops extra connections while ready and after loss', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      const snapshot = await h.session.start()
      const extra = attachFakeBridge(snapshot.port as number, { token: 'tok' })
      await extra.closed
      h.finish(3)
      await expectState(h.session, 'lost')
      const afterLoss = attachFakeBridge(snapshot.port as number, { token: 'tok' })
      await afterLoss.closed
    } finally {
      await h.session.dispose()
    }
  })
})

describe('disposal', () => {
  it('is idempotent, aborts in-flight requests, and terminates once', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    await h.session.start()
    const pending = h.session.request('slow')
    await h.session.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'GODOT_EGO_ABORTED' })
    await h.session.dispose()
    expect(h.terminates).toBe(1)
    expect(h.session.snapshot().state).toBe('disposed')
  })

  it('disposes a session that never started', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    expect(h.session.sessionId).toBe('s1')
    await h.session.dispose()
    expect(h.terminates).toBe(0)
    expect(h.session.snapshot().state).toBe('disposed')
  })

  it('stops a lost session and reports the process exit', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    await h.session.start()
    h.finish(0)
    await expectState(h.session, 'lost')
    await expect(h.session.stop()).resolves.toEqual({ exitCode: 0, signal: null })
    expect(h.terminates).toBe(1)
  })

  it('stops a ready session even when the bridge never answers quit', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' }, requestTimeoutMs: 40 })
    await h.session.start()
    await expect(h.session.stop()).resolves.toEqual({ exitCode: null, signal: null })
    expect(h.terminates).toBe(1)
  })

  it('stops a session that never started', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    await expect(h.session.stop()).resolves.toEqual({ exitCode: null, signal: null })
    expect(h.session.snapshot().state).toBe('disposed')
  })
})

describe('edge replies', () => {
  it('ignores a reply for an unknown id and keeps the session ready', async () => {
    const h = createHarness({
      token: 'tok',
      bridge: { token: 'tok', reply: command => (command.cmd === 'ping' ? { ok: true } : undefined) },
    })
    try {
      await h.session.start()
      h.bridge?.socket.write('{"id":999,"ok":true}\n')
      // The ping reply is written after the stray line, so awaiting it proves
      // the stray line was dispatched (and ignored) rather than left buffered.
      await h.session.request('ping')
      expect(h.session.snapshot().state).toBe('ready')
    } finally {
      await h.session.dispose()
    }
  })

  it('unsubscribes an onLost listener', async () => {
    const h = createHarness({ token: 'tok', bridge: { token: 'tok' } })
    try {
      await h.session.start()
      const seen: string[] = []
      const off = h.session.onLost(reason => seen.push(reason))
      off()
      h.finish(0)
      await expectState(h.session, 'lost')
      expect(seen).toEqual([])
    } finally {
      await h.session.dispose()
    }
  })
})
