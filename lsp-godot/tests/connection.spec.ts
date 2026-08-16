/**
 * S4a-1: connection establishment against a running LSP server. Pins the
 * initialize handshake payload, capabilities parsing, changeWorkspace
 * collection, port fallback order, and the workspace-matching rule (T0 facts:
 * the server sends `gdscript_client/changeWorkspace` only when the client
 * rootUri does not match the opened project, before the initialize response).
 */

import { describe, expect, it } from 'vitest'
import { establishConnection, workspaceMatches } from '../src/connection.ts'
import { FakeGodotLspServer } from './fixtures/fake-lsp-server.ts'

const WORKSPACE_URL = 'file:///D:/proj'
const WORKSPACE_ROOT = 'D:\\proj'

function baseOptions(port: number) {
  return {
    host: '127.0.0.1',
    ports: [port],
    connectTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    maxMessageBytes: 1_000_000,
    workspaceRoot: WORKSPACE_ROOT,
    workspaceFileUrl: WORKSPACE_URL,
  }
}

describe('establishConnection', () => {
  it('performs the initialize handshake and returns capabilities', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setDefaultResult({ capabilities: { hoverProvider: true, referencesProvider: true } })

    const connection = await establishConnection(baseOptions(server.port))

    expect(connection.capabilities.hoverProvider).toBe(true)
    expect(connection.capabilities.referencesProvider).toBe(true)
    // initialize payload: rootUri, workspaceFolders, position encoding, link support.
    const init = server.inbound.find(m => m.method === 'initialize')
    expect(init?.params).toMatchObject({
      processId: null,
      rootUri: WORKSPACE_URL,
      workspaceFolders: [{ uri: WORKSPACE_URL, name: 'workspace' }],
    })
    expect((init?.params as { capabilities: Record<string, unknown> }).capabilities).toMatchObject({
      general: { positionEncodings: ['utf-16'] },
      textDocument: { definition: { linkSupport: true } },
    })
    // The client announces readiness.
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(server.methods()).toContain('initialized')
    connection.close()
    await server.close()
  })

  it('collects the server project path from changeWorkspace notifications', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()

    const connecting = establishConnection(baseOptions(server.port))
    await new Promise(resolve => setTimeout(resolve, 30))
    // Godot sends the notification before the initialize response (T0 Phase C).
    server.sendNotification('gdscript_client/changeWorkspace', { path: 'D:/other-project' })
    server.respond(1, { capabilities: {} })
    const connection = await connecting

    expect(connection.serverProjectPath).toBe('D:/other-project')
    connection.close()
    await server.close()
  })

  it('treats a changeWorkspace notification without params as matching', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()

    const connecting = establishConnection(baseOptions(server.port))
    await new Promise(resolve => setTimeout(resolve, 30))
    server.sendNotification('gdscript_client/changeWorkspace', null)
    server.respond(1, { capabilities: {} })
    const connection = await connecting

    expect(connection.serverProjectPath).toBeUndefined()
    expect(connection.matchesWorkspace()).toBe(true)
    connection.close()
    await server.close()
  })

  it('treats a changeWorkspace notification without a params field as matching', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()

    const connecting = establishConnection(baseOptions(server.port))
    await new Promise(resolve => setTimeout(resolve, 30))
    // An undefined params value serializes away, leaving the message without
    // the field at all.
    server.sendNotification('gdscript_client/changeWorkspace', undefined)
    server.respond(1, { capabilities: {} })
    const connection = await connecting

    expect(connection.serverProjectPath).toBeUndefined()
    expect(connection.matchesWorkspace()).toBe(true)
    connection.close()
    await server.close()
  })

  it('falls back to empty capabilities when initialize omits them', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()

    const connecting = establishConnection(baseOptions(server.port))
    await new Promise(resolve => setTimeout(resolve, 30))
    server.respond(1, { serverInfo: { name: 'godot' } })
    const connection = await connecting

    expect(connection.capabilities).toEqual({})
    connection.close()
    await server.close()
  })

  it('tries ports in order and succeeds on a later one', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setDefaultResult({ capabilities: { hoverProvider: true } })

    const connection = await establishConnection({ ...baseOptions(server.port), ports: [1, server.port] })
    expect(connection.capabilities.hoverProvider).toBe(true)
    connection.close()
    await server.close()
  })

  it('fails with LSP_UNAVAILABLE when no port answers', async () => {
    await expect(establishConnection({ ...baseOptions(1), ports: [1, 2] })).rejects.toMatchObject({
      code: 'LSP_UNAVAILABLE',
    })
  })

  it('closes the endpoint when initialize fails', async () => {
    const server = new FakeGodotLspServer({ forceError: { code: -32600, message: 'bad initialize' } })
    await server.listen()
    await expect(establishConnection(baseOptions(server.port))).rejects.toMatchObject({ code: 'LSP_UNAVAILABLE' })
    await server.close()
  })
})

describe('workspaceMatches', () => {
  it('accepts identical roots', () => {
    expect(workspaceMatches('D:/proj', 'D:\\proj')).toBe(true)
  })

  it('accepts a client workspace that is a subfolder of the server project', () => {
    expect(workspaceMatches('D:/proj', 'D:/proj/sub/folder')).toBe(true)
  })

  it('rejects a different project', () => {
    expect(workspaceMatches('D:/proj', 'D:/other')).toBe(false)
    expect(workspaceMatches('D:/proj', 'D:/projects-other')).toBe(false)
  })

  it('treats a missing server project path as matching (no notification = matching root)', () => {
    expect(workspaceMatches(undefined, 'D:/proj')).toBe(true)
  })
})
