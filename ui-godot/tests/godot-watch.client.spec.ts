/** The watch panel's poller, selection, and click forwarding. */

import { describe, expect, it, vi } from 'vitest'
import { GodotWatchController, watchStreamUrl } from '../src/client/godot-watch-controller.ts'

/** A fetch response carrying JSON. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const sessions = [
  { sessionId: 's1', state: 'ready', pid: 7, window: [1280, 720], lostReason: null },
  { sessionId: 's2', state: 'lost', pid: null, window: null, lostReason: 'game exited' },
]

describe('GodotWatchController', () => {
  it('polls the session list and selects the first session', async () => {
    const fetch = vi.fn(async () => json({ ok: true, sessions }))
    const watch = new GodotWatchController({ fetch })
    await watch.refresh()
    const state = watch.inject().hooks.watch.getSnapshot()
    expect(state.sessions.map(session => session.sessionId)).toEqual(['s1', 's2'])
    expect(state.selected).toBe('s1')
    expect(state.error).toBe(false)
    expect(fetch).toHaveBeenCalledWith('/api/godot/sessions', { headers: { accept: 'application/json' } })
  })

  it('drops malformed sessions and keeps a still-present selection', async () => {
    const fetch = vi.fn(async () => json({
      sessions: [sessions[1], null, { sessionId: 4 }, { sessionId: 's3', state: 3, window: [1] }],
    }))
    const watch = new GodotWatchController({ fetch })
    watch.select('s2')
    await watch.refresh()
    let state = watch.inject().hooks.watch.getSnapshot()
    expect(state.selected).toBe('s2')
    expect(state.sessions.find(session => session.sessionId === 's3')).toEqual({
      sessionId: 's3', state: 'unknown', pid: null, window: null, lostReason: null,
    })

    watch.select('gone')
    await watch.refresh()
    state = watch.inject().hooks.watch.getSnapshot()
    expect(state.selected).toBe('s2')
  })

  it('reports a failed or non-ok poll', async () => {
    const failing = new GodotWatchController({ fetch: vi.fn(async () => { throw new Error('offline') }) })
    await failing.refresh()
    expect(failing.inject().hooks.watch.getSnapshot().error).toBe(true)

    const notOk = new GodotWatchController({ fetch: vi.fn(async () => json({}, 500)) })
    await notOk.refresh()
    expect(notOk.inject().hooks.watch.getSnapshot().error).toBe(true)

    const unmounted = new GodotWatchController({ fetch: vi.fn(async () => json({}, 404)) })
    await unmounted.refresh()
    expect(unmounted.inject().hooks.watch.getSnapshot()).toMatchObject({ error: false, sessions: [] })

    const recovered = new GodotWatchController({ fetch: vi.fn(async () => json({ sessions: [] })) })
    await recovered.refresh()
    expect(recovered.inject().hooks.watch.getSnapshot()).toMatchObject({ error: false, sessions: [], selected: undefined })
  })

  it('opens, closes, and selects', async () => {
    const watch = new GodotWatchController({ fetch: vi.fn(async () => json({ sessions })) })
    const face = watch.inject()
    face.toggle()
    expect(face.hooks.watch.getSnapshot().open).toBe(true)
    face.close()
    expect(face.hooks.watch.getSnapshot().open).toBe(false)
    face.select('s2')
    expect(face.hooks.watch.getSnapshot().selected).toBe('s2')
  })

  it('forwards one click and reports a rejected one', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => input === '/api/godot/sessions' ? json({ sessions }) : json({ ok: true }))
    const watch = new GodotWatchController({ fetch })
    await watch.refresh()
    watch.inject().click(12.5, 34)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledWith('/api/godot/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: 's1', x: 12.5, y: 34 }),
    }) })

    const none = new GodotWatchController({ fetch })
    none.inject().click(1, 2)
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(2)

    const failing = vi.fn(async (input: RequestInfo | URL) => input === '/api/godot/sessions' ? json({ sessions }) : json({}, 500))
    const rejected = new GodotWatchController({ fetch: failing })
    await rejected.refresh()
    rejected.inject().click(1, 2)
    await vi.waitFor(() => { expect(rejected.inject().hooks.watch.getSnapshot().error).toBe(true) })
  })

  it('starts one timer and releases it', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn(async () => json({ sessions }))
      const watch = new GodotWatchController({ fetch, pollMs: 50 })
      watch.start()
      watch.start()
      await vi.advanceTimersByTimeAsync(120)
      expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2)
      watch.dispose()
      watch.dispose()
      const seen = fetch.mock.calls.length
      await vi.advanceTimersByTimeAsync(200)
      expect(fetch.mock.calls.length).toBe(seen)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the global fetch by default', async () => {
    const fetch = vi.fn(async () => json({ sessions }))
    vi.stubGlobal('fetch', fetch)
    try {
      const watch = new GodotWatchController()
      await watch.refresh()
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(watch.inject().hooks.watch.getSnapshot().selected).toBe('s1')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses the global timers with the global receiver', async () => {
    const setIntervalStub = vi.fn(function (this: unknown, _handler: () => void, _timeout: number) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return 1
    })
    const clearIntervalStub = vi.fn(function (this: unknown, _timer: number) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
    })
    vi.stubGlobal('setInterval', setIntervalStub)
    vi.stubGlobal('clearInterval', clearIntervalStub)
    try {
      const watch = new GodotWatchController({ fetch: vi.fn(async () => json({ sessions })) })
      watch.start()
      expect(setIntervalStub).toHaveBeenCalledOnce()
      watch.dispose()
      expect(clearIntervalStub).toHaveBeenCalledWith(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('coalesces concurrent polls and tolerates a non-array list', async () => {
    let release: (() => void) | undefined
    const fetch = vi.fn(() => new Promise((resolve) => {
      release = () => { resolve(json({ sessions })) }
    }))
    const watch = new GodotWatchController({ fetch: fetch as unknown as typeof globalThis.fetch })
    const first = watch.refresh()
    const second = watch.refresh()
    await second
    release?.()
    await first
    expect(fetch).toHaveBeenCalledTimes(1)

    const odd = new GodotWatchController({ fetch: vi.fn(async () => json({ sessions: 'nope' })) })
    await odd.refresh()
    expect(odd.inject().hooks.watch.getSnapshot().sessions).toEqual([])
  })

  it('builds an encoded stream URL', () => {
    expect(watchStreamUrl('a b/c')).toBe('/api/godot/view?session=a%20b%2Fc')
  })
})
