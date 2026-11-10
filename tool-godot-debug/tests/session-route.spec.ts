/**
 * `/api/godot/debug/*`: the four endpoints the Web panel uses, driven over a
 * real HTTP server so the loopback guard, the methods and the JSON bodies all
 * see real requests.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionRoute } from '../src/session-route.ts'
import type { DebugSessionService, DebugSessionStartOptions } from '../src/session-service.ts'
import type { SessionCommandRequest, SessionSnapshot } from '../src/session.ts'

/** One session snapshot with the fields the panel reads. */
function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'session-a',
    version: 1,
    state: 'paused',
    port: 6007,
    breakpoints: [],
    outputTail: [],
    errors: [],
    outputTruncated: false,
    ...overrides,
  } as SessionSnapshot
}

/** A service double whose four methods the test pins per case. */
function fakeService(overrides: Partial<DebugSessionService> = {}): DebugSessionService {
  return {
    start: vi.fn(async (_options: DebugSessionStartOptions) => ({
      sessionId: 'session-a', port: 6007, state: 'connecting' as const, mode: 'attach' as const,
    })),
    stop: vi.fn(() => ({ ok: true })),
    poll: vi.fn((sessionId: string) => (sessionId === 'session-a' ? snapshot() : { error: 'unknown-session' as const })),
    command: vi.fn(async (_sessionId: string, _request: SessionCommandRequest) => ({ ok: true as const })),
    ...overrides,
  } as DebugSessionService
}

let server: Server
let base: string
let route: (req: IncomingMessage, res: ServerResponse) => void

/** Start a real HTTP server that hands every request to the registered route. */
async function serve(service: DebugSessionService, options: { token?: string } = {}): Promise<void> {
  server = createServer((req, res) => { route(req, res) })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // The register seam is the only thing the route needs from the web server.
  sessionRoute({
    get: (name: string) => (name === 'webServer'
      ? { register: (r: { handler: typeof route }) => { route = r.handler; return () => {} } }
      : undefined),
  } as unknown as Context, service, options)
}

/** POST one JSON body and return the parsed reply. */
async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeEach(() => { route = () => {} })

afterEach(async () => {
  await new Promise<void>(resolve => { server.close(() => { resolve() }) })
})

describe('sessionRoute', () => {
  it('opens a session and reports it', async () => {
    const service = fakeService()
    await serve(service)
    const reply = await post('/api/godot/debug/start', { projectRoot: '/proj', port: 6007 })
    expect(reply.status).toBe(200)
    expect(reply.body.ok).toBe(true)
    expect((reply.body.session as { sessionId: string }).sessionId).toBe('session-a')
    expect(service.start).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: '/proj', port: 6007 }))
  })

  it('rejects a start without a project root', async () => {
    await serve(fakeService())
    expect((await post('/api/godot/debug/start', {})).status).toBe(400)
  })

  it('reports a second start as a conflict, not a bad request', async () => {
    await serve(fakeService({ start: vi.fn(async () => ({ error: 'session-active' as const })) }))
    const reply = await post('/api/godot/debug/start', { projectRoot: '/proj', port: 6007 })
    expect(reply.status).toBe(409)
    expect(reply.body.error).toBe('session-active')
  })

  it('polls a session and answers an unknown id with 404', async () => {
    await serve(fakeService())
    const ok = await fetch(`${base}/api/godot/debug/poll?session=session-a`)
    expect(ok.status).toBe(200)
    expect((await ok.json() as { snapshot: { state: string } }).snapshot.state).toBe('paused')

    const missing = await fetch(`${base}/api/godot/debug/poll?session=nope`)
    expect(missing.status).toBe(404)
  })

  it('forwards one command and refuses a malformed one', async () => {
    const command = vi.fn(async () => ({ ok: true as const }))
    await serve(fakeService({ command }))

    const good = await post('/api/godot/debug/command', { sessionId: 'session-a', request: { kind: 'pause' } })
    expect(good.status).toBe(200)
    expect(command).toHaveBeenCalledWith('session-a', { kind: 'pause' })

    const bad = await post('/api/godot/debug/command', { sessionId: 'session-a', request: { kind: 'teleport' } })
    expect(bad.status).toBe(400)
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('stops a session', async () => {
    const service = fakeService()
    await serve(service)
    const reply = await post('/api/godot/debug/stop', { sessionId: 'session-a' })
    expect(reply.body).toEqual({ ok: true, stopped: true })
    expect(service.stop).toHaveBeenCalledWith('session-a')
  })

  it('answers the wrong method with 405 and an unknown path with 404', async () => {
    await serve(fakeService())
    const wrong = await fetch(`${base}/api/godot/debug/command`)
    expect(wrong.status).toBe(405)
    const unknown = await fetch(`${base}/api/godot/debug/nope`)
    expect(unknown.status).toBe(404)
  })

  it('requires the pinned token when the deployment sets one', async () => {
    await serve(fakeService(), { token: 'secret' })
    expect((await fetch(`${base}/api/godot/debug/poll?session=session-a`)).status).toBe(403)
    expect((await fetch(`${base}/api/godot/debug/poll?session=session-a&token=secret`)).status).toBe(200)
  })

  it('refuses a request from outside loopback', async () => {
    await serve(fakeService())
    const reply = await fetch(`${base}/api/godot/debug/poll?session=session-a`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(reply.status).toBe(403)
  })

  it('throws a typed error when no web server is mounted', () => {
    const ctx = { get: () => undefined } as unknown as Context
    expect(() => sessionRoute(ctx, fakeService())).toThrow(/web server is not mounted/)
  })
})
