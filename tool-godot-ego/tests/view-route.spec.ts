/**
 * `/api/godot` endpoints: the MJPEG viewer, the session list, and the click
 * input used by the watch panel — token gate, loopback/same-site guard,
 * unknown session, frame stream, backpressure, and teardown.
 */

import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { GameSessionRegistry } from '../src/session-service.ts'
import { viewRoute } from '../src/view-route.ts'

function fakeRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; remoteAddress?: string; body?: string } = {},
): IncomingMessage & EventEmitter {
  const req = new EventEmitter() as IncomingMessage & EventEmitter
  req.url = url
  req.method = options.method ?? 'GET'
  req.headers = options.headers ?? {}
  ;(req as { socket?: { remoteAddress?: string } }).socket = { remoteAddress: options.remoteAddress }
  if (options.body !== undefined) {
    queueMicrotask(() => {
      req.emit('data', Buffer.from(options.body as string))
      req.emit('end')
    })
  }
  return req
}

function fakeResponse(initialLength = 0) {
  const chunks: Buffer[] = []
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writableLength: initialLength,
    chunks,
    ended: undefined as unknown,
    writeHead(code: number, headers?: Record<string, string>) {
      res.statusCode = code
      if (headers !== undefined) res.headers = headers
      return res
    },
    flushHeaders() {},
    write(chunk: Buffer) {
      chunks.push(chunk)
      return true
    },
    end(body?: string) {
      res.ended = body ?? true
      return res
    },
  }
  return res
}

async function registryWith(request: (cmd: string, params?: Readonly<Record<string, unknown>>) => Promise<unknown>) {
  const registry = new GameSessionRegistry(async () => ({
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request: request as never,
  }))
  await registry.ensure('/ws', {})
  return registry
}

/** Capture the registered handlers by path so tests can call them directly. */
function capturingContext() {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
  const ctx = {
    get: () => ({
      register: (registered: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => {
        routes.set(registered.path, registered.handler)
        return () => {}
      },
    }),
  } as unknown as Context
  return { ctx, routes }
}

const payload = { data: Buffer.from('jpeg-bytes').toString('base64'), bytes: 10, size: [640, 360], frame: 1 }

describe('viewRoute', () => {
  it('registers the viewer, session-list, and input prefixes', async () => {
    const registered: string[] = []
    const ctx = {
      get: () => ({
        register: (route: { path: string }) => {
          registered.push(route.path)
          return () => {}
        },
      }),
    } as unknown as Context
    const registry = await registryWith(async () => ({ kind: 'ok', id: 1, payload }))
    const dispose = viewRoute(ctx, registry, { token: 'tok' })
    expect(registered).toEqual(['/api/godot/view', '/api/godot/sessions', '/api/godot/input'])
    expect(typeof dispose).toBe('function')
  })

  it('forbids a missing or wrong token and reports an unknown session', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => ({ kind: 'ok', id: 1, payload }))
    viewRoute(ctx, registry, { token: 'tok' })
    const view = routes.get('/api/godot/view') as (req: IncomingMessage, res: ServerResponse) => void
    for (const url of ['/api/godot/view', '/api/godot/view?token=no&session=s1']) {
      const res = fakeResponse()
      view(fakeRequest(url), res as unknown as ServerResponse)
      expect(res.statusCode).toBe(403)
    }
    const missing = fakeResponse()
    view(fakeRequest('/api/godot/view?token=tok&session=nope'), missing as unknown as ServerResponse)
    expect(missing.statusCode).toBe(404)
    const noUrl = new EventEmitter() as IncomingMessage
    noUrl.socket = { remoteAddress: '127.0.0.1' } as never
    const bare = fakeResponse()
    view(noUrl, bare as unknown as ServerResponse)
    expect(bare.statusCode).toBe(403)
  })

  it('allows loopback same-site requests without a token and blocks cross-site ones', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => ({ kind: 'ok', id: 1, payload }))
    viewRoute(ctx, registry, { intervalMs: 5 })
    const sessions = routes.get('/api/godot/sessions') as (req: IncomingMessage, res: ServerResponse) => void

    const local = fakeResponse()
    sessions(fakeRequest('/api/godot/sessions', { remoteAddress: '127.0.0.1' }), local as unknown as ServerResponse)
    expect(local.statusCode).toBe(200)
    expect(local.ended).toContain('"sessions"')

    const sameOrigin = fakeResponse()
    sessions(fakeRequest('/api/godot/sessions', {
      remoteAddress: '127.0.0.1',
      headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' },
    }), sameOrigin as unknown as ServerResponse)
    expect(sameOrigin.statusCode).toBe(200)

    const noSocket = new EventEmitter() as IncomingMessage
    noSocket.url = '/api/godot/sessions'
    noSocket.headers = {}
    const noSocketRes = fakeResponse()
    sessions(noSocket, noSocketRes as unknown as ServerResponse)
    expect(noSocketRes.statusCode).toBe(403)

    const crossSite = fakeResponse()
    sessions(fakeRequest('/api/godot/sessions', {
      remoteAddress: '127.0.0.1',
      headers: { 'sec-fetch-site': 'cross-site' },
    }), crossSite as unknown as ServerResponse)
    expect(crossSite.statusCode).toBe(403)

    const wrongOrigin = fakeResponse()
    sessions(fakeRequest('/api/godot/sessions', {
      remoteAddress: '127.0.0.1',
      headers: { origin: 'https://evil.example', host: '127.0.0.1:3080' },
    }), wrongOrigin as unknown as ServerResponse)
    expect(wrongOrigin.statusCode).toBe(403)

    const remote = fakeResponse()
    sessions(fakeRequest('/api/godot/sessions', { remoteAddress: '10.0.0.2' }), remote as unknown as ServerResponse)
    expect(remote.statusCode).toBe(403)
  })

  it('lists sessions without requesting the game', async () => {
    const { ctx, routes } = capturingContext()
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload }))
    const registry = await registryWith(request)
    viewRoute(ctx, registry, { token: 'tok' })
    const sessions = routes.get('/api/godot/sessions') as (req: IncomingMessage, res: ServerResponse) => void
    const res = fakeResponse()
    sessions(fakeRequest('/api/godot/sessions?token=tok'), res as unknown as ServerResponse)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(String(res.ended))).toEqual({
      ok: true,
      sessions: [{ sessionId: 's1', state: 'ready', pid: 1, window: null, lostReason: null }],
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('forwards one click from the watch panel', async () => {
    const { ctx, routes } = capturingContext()
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload: { hit: 'Main/Btn', frames: 9 } }))
    const registry = await registryWith(request)
    viewRoute(ctx, registry, { token: 'tok' })
    const input = routes.get('/api/godot/input') as (req: IncomingMessage, res: ServerResponse) => void
    const res = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', {
      method: 'POST',
      body: JSON.stringify({ session: 's1', x: 12, y: 34 }),
    }), res as unknown as ServerResponse)
    await vi.waitFor(() => { expect(res.statusCode).toBe(200) })
    expect(JSON.parse(String(res.ended))).toEqual({ ok: true, hit: 'Main/Btn', frames: 9 })
    expect(request).toHaveBeenCalledWith('click', { x: 12, y: 34, button: 'left', double: false })
  })

  it('rejects a bad input request without contacting the game', async () => {
    const { ctx, routes } = capturingContext()
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload }))
    const registry = await registryWith(request)
    viewRoute(ctx, registry, { token: 'tok' })
    const input = routes.get('/api/godot/input') as (req: IncomingMessage, res: ServerResponse) => void

    const wrongMethod = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', { method: 'GET' }), wrongMethod as unknown as ServerResponse)
    await vi.waitFor(() => { expect(wrongMethod.statusCode).toBe(405) })

    const badJson = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', { method: 'POST', body: '{' }), badJson as unknown as ServerResponse)
    await vi.waitFor(() => { expect(badJson.statusCode).toBe(400) })

    const missing = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', { method: 'POST', body: '{}' }), missing as unknown as ServerResponse)
    await vi.waitFor(() => { expect(missing.statusCode).toBe(400) })

    const unknown = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', {
      method: 'POST',
      body: JSON.stringify({ session: 'nope', x: 1, y: 2 }),
    }), unknown as unknown as ServerResponse)
    await vi.waitFor(() => { expect(unknown.statusCode).toBe(404) })
    expect(request).not.toHaveBeenCalled()
  })

  it('reports a bridge failure on the input route', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => { throw new Error('bridge lost') })
    viewRoute(ctx, registry, { token: 'tok' })
    const input = routes.get('/api/godot/input') as (req: IncomingMessage, res: ServerResponse) => void
    const res = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', {
      method: 'POST',
      body: JSON.stringify({ session: 's1', x: 1, y: 2, button: 'right', double: true }),
    }), res as unknown as ServerResponse)
    await vi.waitFor(() => { expect(res.statusCode).toBe(502) })
    expect(String(res.ended)).toContain('bridge lost')
  })

  it('returns null hit and zero frames when the click reply has neither', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => ({ kind: 'ok', id: 1, payload: {} }))
    viewRoute(ctx, registry, { token: 'tok' })
    const input = routes.get('/api/godot/input') as (req: IncomingMessage, res: ServerResponse) => void
    const res = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', {
      method: 'POST',
      body: 'null',
    }), res as unknown as ServerResponse)
    await vi.waitFor(() => { expect(res.statusCode).toBe(400) })

    const shaped = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', {
      method: 'POST',
      body: JSON.stringify({ session: 's1', x: 1, y: 2 }),
    }), shaped as unknown as ServerResponse)
    await vi.waitFor(() => { expect(shaped.statusCode).toBe(200) })
    expect(JSON.parse(String(shaped.ended))).toEqual({ ok: true, hit: null, frames: 0 })
  })

  it('rejects an oversized body and an unauthorized input request', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => ({ kind: 'ok', id: 1, payload }))
    viewRoute(ctx, registry, { token: 'tok' })
    const input = routes.get('/api/godot/input') as (req: IncomingMessage, res: ServerResponse) => void

    const big = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', {
      method: 'POST',
      body: `{"session":"s1","x":1,"y":2,"pad":"${'x'.repeat(20_000)}"}`,
    }), big as unknown as ServerResponse)
    await vi.waitFor(() => { expect(big.statusCode).toBe(400) })

    const forbidden = fakeResponse()
    input(fakeRequest('/api/godot/input?token=no', { method: 'POST', body: '{}' }), forbidden as unknown as ServerResponse)
    await vi.waitFor(() => { expect(forbidden.statusCode).toBe(403) })

    const noUrl = new EventEmitter() as IncomingMessage
    noUrl.method = 'POST'
    noUrl.headers = {}
    const noUrlRes = fakeResponse()
    input(noUrl, noUrlRes as unknown as ServerResponse)
    await vi.waitFor(() => { expect(noUrlRes.statusCode).toBe(403) })

    const sessions = routes.get('/api/godot/sessions') as (req: IncomingMessage, res: ServerResponse) => void
    const listNoUrl = new EventEmitter() as IncomingMessage
    listNoUrl.headers = {}
    const listNoUrlRes = fakeResponse()
    sessions(listNoUrl, listNoUrlRes as unknown as ServerResponse)
    expect(listNoUrlRes.statusCode).toBe(403)
  })

  it('reports a non-Error bridge failure', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => { throw 'gone' })
    viewRoute(ctx, registry, { token: 'tok' })
    const input = routes.get('/api/godot/input') as (req: IncomingMessage, res: ServerResponse) => void
    const res = fakeResponse()
    input(fakeRequest('/api/godot/input?token=tok', {
      method: 'POST',
      body: JSON.stringify({ session: 's1', x: 1, y: 2 }),
    }), res as unknown as ServerResponse)
    await vi.waitFor(() => { expect(res.statusCode).toBe(502) })
    expect(String(res.ended)).toContain('gone')
  })

  it('uses the default frame interval', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => ({ kind: 'ok', id: 1, payload }))
    viewRoute(ctx, registry, { token: 'tok' })
    const view = routes.get('/api/godot/view') as (req: IncomingMessage, res: ServerResponse) => void
    const req = fakeRequest('/api/godot/view?token=tok&session=s1')
    const res = fakeResponse()
    view(req, res as unknown as ServerResponse)
    expect(res.statusCode).toBe(200)
    req.emit('close')
  })

  it('streams JPEG frames and stops on request close', async () => {
    const { ctx, routes } = capturingContext()
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload }))
    const registry = await registryWith(request)
    viewRoute(ctx, registry, { token: 'tok', intervalMs: 5 })
    const view = routes.get('/api/godot/view') as (req: IncomingMessage, res: ServerResponse) => void
    const req = fakeRequest('/api/godot/view?token=tok&session=s1')
    const res = fakeResponse()
    view(req, res as unknown as ServerResponse)
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toContain('multipart/x-mixed-replace')
    await vi.waitFor(() => { expect(res.chunks.length).toBeGreaterThan(0) })
    const frame = Buffer.concat(res.chunks)
    expect(frame.includes(Buffer.from('--frame'))).toBe(true)
    expect(frame.includes(Buffer.from('jpeg-bytes'))).toBe(true)
    req.emit('close')
    const seen = request.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 35))
    expect(request.mock.calls.length).toBe(seen)
  })

  it('skips frames while the client is backpressured or a request is in flight', async () => {
    const { ctx, routes } = capturingContext()
    let resolveShot: (() => void) | undefined
    const request = vi.fn(() => new Promise((resolve) => {
      resolveShot = () => { resolve({ kind: 'ok', id: 1, payload }) }
    }))
    const registry = await registryWith(request)
    viewRoute(ctx, registry, { token: 'tok', intervalMs: 5 })
    const view = routes.get('/api/godot/view') as (req: IncomingMessage, res: ServerResponse) => void
    const req = fakeRequest('/api/godot/view?token=tok&session=s1')
    const res = fakeResponse()
    view(req, res as unknown as ServerResponse)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(request).toHaveBeenCalledTimes(1)
    resolveShot?.()
    await vi.waitFor(() => { expect(res.chunks.length).toBeGreaterThan(0) })
    req.emit('close')

    const slowReq = fakeRequest('/api/godot/view?token=tok&session=s1')
    const slowRes = fakeResponse(2_000_000)
    view(slowReq, slowRes as unknown as ServerResponse)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(slowRes.chunks).toHaveLength(0)
    slowReq.emit('close')
  })

  it('tolerates a non-string frame payload', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => ({ kind: 'ok', id: 1, payload: { data: 123 } }))
    viewRoute(ctx, registry, { token: 'tok', intervalMs: 5 })
    const view = routes.get('/api/godot/view') as (req: IncomingMessage, res: ServerResponse) => void
    const req = fakeRequest('/api/godot/view?token=tok&session=s1')
    const res = fakeResponse()
    view(req, res as unknown as ServerResponse)
    await vi.waitFor(() => { expect(res.chunks.length).toBeGreaterThan(0) })
    req.emit('close')
  })

  it('ends the stream when a frame request fails and reports a missing web server', async () => {
    const { ctx, routes } = capturingContext()
    const registry = await registryWith(async () => { throw new Error('bridge lost') })
    viewRoute(ctx, registry, { token: 'tok', intervalMs: 5 })
    const view = routes.get('/api/godot/view') as (req: IncomingMessage, res: ServerResponse) => void
    const req = fakeRequest('/api/godot/view?token=tok&session=s1')
    const res = fakeResponse()
    view(req, res as unknown as ServerResponse)
    await vi.waitFor(() => { expect(res.ended).toBe(true) })
    req.emit('close')

    const bare = { get: () => undefined } as unknown as Context
    expect(() => viewRoute(bare, registry)).toThrow(/web server is not mounted/)
  })
})
