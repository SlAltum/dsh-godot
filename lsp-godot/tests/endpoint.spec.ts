/**
 * S2: TCP JSON-RPC endpoint over Godot's LSP. Behaviors pinned against a real
 * `node:net` fake server speaking the LSP base protocol; the partial-frame
 * idle timeout and abrupt-close semantics mirror what T0 observed from Godot
 * 4.7 (`.context/t0/facts.md`).
 */

import { describe, expect, it } from 'vitest'
import { GodotLspEndpoint } from '../src/endpoint.ts'
import { FakeGodotLspServer, frame } from './fixtures/fake-lsp-server.ts'

function opts(overrides: Partial<ConstructorParameters<typeof GodotLspEndpoint>[0]> = {}) {
  return {
    host: '127.0.0.1',
    port: 0,
    connectTimeoutMs: 2000,
    idleTimeoutMs: 500,
    maxMessageBytes: 1_000_000,
    onNotification: () => {},
    ...overrides,
  }
}

describe('GodotLspEndpoint connect', () => {
  it('connects to a listening server', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()
    expect(endpoint.connected).toBe(true)
    endpoint.close()
    await server.close()
  })

  it('rejects with CONNECT_FAILED when nothing listens', async () => {
    const endpoint = new GodotLspEndpoint(opts({ port: 1 }))
    await expect(endpoint.connect()).rejects.toMatchObject({ code: 'CONNECT_FAILED' })
  })

  it('stays disconnected after a failed connect', async () => {
    const endpoint = new GodotLspEndpoint(opts({ port: 1 }))
    await expect(endpoint.connect()).rejects.toThrow()
    expect(endpoint.connected).toBe(false)
  })

  it('resolves immediately when already connected', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()
    await expect(endpoint.connect()).resolves.toBeUndefined()
    expect(endpoint.connected).toBe(true)
    endpoint.close()
    await server.close()
  })

  it('rejects a request before connect with CONNECTION_CLOSED', async () => {
    const endpoint = new GodotLspEndpoint(opts({ port: 1 }))
    await expect(endpoint.request('textDocument/hover', {})).rejects.toMatchObject({ code: 'CONNECTION_CLOSED' })
    // notify is fire-and-forget: a pre-connect no-op.
    endpoint.notify('textDocument/didOpen', {})
  })

  it('rejects a request after close with CONNECTION_CLOSED', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()
    endpoint.close()
    await expect(endpoint.request('textDocument/hover', {})).rejects.toMatchObject({ code: 'CONNECTION_CLOSED' })
    await server.close()
  })

  it('close before connect is a no-op and leaves the endpoint dead-clean', async () => {
    const endpoint = new GodotLspEndpoint(opts({ port: 1 }))
    endpoint.close()
    expect(endpoint.connected).toBe(false)
    await expect(endpoint.connect()).rejects.toMatchObject({ code: 'CONNECTION_CLOSED' })
  })
})

describe('GodotLspEndpoint request/response', () => {
  it('sends a framed request and resolves the paired response', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const result = { capabilities: { hoverProvider: true } }
    const request = endpoint.request('initialize', { rootUri: 'file:///x' })
    server.respond(1, result)
    await expect(request).resolves.toEqual(result)

    expect(server.inbound[0]).toMatchObject({ kind: 'request', id: 1, method: 'initialize' })
    expect(server.inbound[0]?.params).toEqual({ rootUri: 'file:///x' })
    endpoint.close()
    await server.close()
  })

  it('pairs out-of-order responses to the right request ids', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const first = endpoint.request('textDocument/hover', { id: 'a' })
    const second = endpoint.request('textDocument/definition', { id: 'b' })
    server.respond(2, { for: 'second' })
    server.respond(1, { for: 'first' })
    await expect(first).resolves.toEqual({ for: 'first' })
    await expect(second).resolves.toEqual({ for: 'second' })
    endpoint.close()
    await server.close()
  })

  it('rejects with SERVER_ERROR on a JSON-RPC error response', async () => {
    const server = new FakeGodotLspServer({ forceError: { code: -32601, message: 'method not found' } })
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    await expect(endpoint.request('textDocument/unknown', {})).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      message: 'method not found',
    })
    endpoint.close()
    await server.close()
  })

  it('sends notifications without ids', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    endpoint.notify('textDocument/didOpen', { textDocument: { uri: 'file:///x.gd' } })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(server.inbound[0]).toMatchObject({ kind: 'notify', method: 'textDocument/didOpen' })
    endpoint.close()
    await server.close()
  })
})

describe('GodotLspEndpoint notifications', () => {
  it('routes server notifications through onNotification', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const received: Array<{ method: string; params: unknown }> = []
    const onNotification = (method: string, params: unknown) => { received.push({ method, params }) }
    const endpoint = new GodotLspEndpoint(opts({ port: server.port, onNotification }))
    await endpoint.connect()

    server.sendNotification('gdscript_client/changeWorkspace', { path: 'D:/proj' })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(received).toEqual([{ method: 'gdscript_client/changeWorkspace', params: { path: 'D:/proj' } }])
    endpoint.close()
    await server.close()
  })

  it('routes multiple notifications in arrival order', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const methods: string[] = []
    const endpoint = new GodotLspEndpoint(opts({ port: server.port, onNotification: method => methods.push(method) }))
    await endpoint.connect()

    server.sendNotification('gdscript/capabilities', { native_classes: [] })
    server.sendNotification('textDocument/publishDiagnostics', { diagnostics: [] })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(methods).toEqual(['gdscript/capabilities', 'textDocument/publishDiagnostics'])
    endpoint.close()
    await server.close()
  })
})

describe('GodotLspEndpoint failure paths', () => {
  it('rejects pending requests and disconnects when the server closes', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const pending = endpoint.request('textDocument/hover', {})
    await new Promise(resolve => setTimeout(resolve, 30))
    server.dropClients()
    await expect(pending).rejects.toMatchObject({ code: 'CONNECTION_CLOSED' })
    expect(endpoint.connected).toBe(false)
    endpoint.close()
    await server.close()
  })

  it('rejects with IDLE_TIMEOUT when a partial frame stalls', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port, idleTimeoutMs: 100 }))
    await endpoint.connect()

    const pending = endpoint.request('textDocument/hover', {})
    // Half a frame: header says 1000 bytes, body never arrives.
    server.sendRawBody('Content-Length: 1000\r\n\r\n{"jsonrpc":"2.0"')
    await expect(pending).rejects.toMatchObject({ code: 'IDLE_TIMEOUT' })
    expect(endpoint.connected).toBe(false)
    endpoint.close()
    await server.close()
  })

  it('rejects with MALFORMED_MESSAGE on an invalid header', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const pending = endpoint.request('textDocument/hover', {})
    server.sendRawBody('No-Content-Length: here\r\n\r\n{}')
    await expect(pending).rejects.toMatchObject({ code: 'MALFORMED_MESSAGE' })
    endpoint.close()
    await server.close()
  })

  it('rejects with MALFORMED_MESSAGE when a body exceeds maxMessageBytes', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port, maxMessageBytes: 16 }))
    await endpoint.connect()

    const pending = endpoint.request('textDocument/hover', {})
    server.sendRawBody('Content-Length: 100000\r\n\r\n{}')
    await expect(pending).rejects.toMatchObject({ code: 'MALFORMED_MESSAGE' })
    endpoint.close()
    await server.close()
  })

  it('falls back to a generic message for an error response without one', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const pending = endpoint.request('textDocument/hover', {})
    server.sendRawBody(frame({ jsonrpc: '2.0', id: 1, error: { code: -1 } }))
    await expect(pending).rejects.toMatchObject({ code: 'SERVER_ERROR', message: 'LSP server error' })
    endpoint.close()
    await server.close()
  })

  it('ignores unknown messages without id or method', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    server.sendRawBody(frame({ jsonrpc: '2.0' }))
    server.sendRawBody(frame({ jsonrpc: '2.0', id: 99 }))
    await new Promise(resolve => setTimeout(resolve, 50))
    // Still usable: a follow-up request succeeds (scripted before it is sent).
    server.respond(1, { ok: true })
    const pending = endpoint.request('textDocument/hover', {})
    await expect(pending).resolves.toEqual({ ok: true })
    endpoint.close()
    await server.close()
  })

  it('survives an idle window without a partial frame', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port, idleTimeoutMs: 50 }))
    await endpoint.connect()

    // A complete frame arrives; the idle timer must not fire while no partial
    // frame is pending.
    const pending = endpoint.request('textDocument/hover', {})
    server.respond(1, { ok: true })
    await expect(pending).resolves.toEqual({ ok: true })
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(endpoint.connected).toBe(true)
    endpoint.close()
    await server.close()
  })
})

describe('GodotLspEndpoint cancellation', () => {
  it('sends $/cancelRequest and rejects with CANCELED on abort', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const controller = new AbortController()
    const pending = endpoint.request('textDocument/hover', {}, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 30))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELED' })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(server.methods()).toContain('$/cancelRequest')
    expect(server.inbound.find(m => m.method === '$/cancelRequest')?.params).toEqual({ id: 1 })
    endpoint.close()
    await server.close()
  })

  it('rejects immediately with CANCELED for an already-aborted signal', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const controller = new AbortController()
    controller.abort()
    await expect(endpoint.request('textDocument/hover', {}, controller.signal)).rejects.toMatchObject({ code: 'CANCELED' })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(server.methods()).not.toContain('textDocument/hover')
    endpoint.close()
    await server.close()
  })

  it('ignores the late response after abort', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const controller = new AbortController()
    const pending = endpoint.request('textDocument/hover', {}, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 30))
    controller.abort()
    server.respond(1, { late: true })
    await expect(pending).rejects.toMatchObject({ code: 'CANCELED' })
    // The endpoint survives a late response for an aborted id.
    const next = endpoint.request('textDocument/definition', {})
    server.respond(2, { ok: true })
    await expect(next).resolves.toEqual({ ok: true })
    endpoint.close()
    await server.close()
  })
})

describe('GodotLspEndpoint close', () => {
  it('close is idempotent and rejects pending work', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()
    const endpoint = new GodotLspEndpoint(opts({ port: server.port }))
    await endpoint.connect()

    const pending = endpoint.request('textDocument/hover', {})
    await new Promise(resolve => setTimeout(resolve, 30))
    endpoint.close()
    endpoint.close()
    await expect(pending).rejects.toMatchObject({ code: 'CONNECTION_CLOSED' })
    expect(endpoint.connected).toBe(false)
    await server.close()
  })
})
