/**
 * S4a-2: the provider's full query flow over a real local filesystem and a
 * fake Godot LSP server (attach mode): workspace canonicalization, connection
 * establishment, capability negotiation, transient open/query/close, Godot
 * hover cleaning and URI normalization (T0 real samples), workspace-matching
 * enforcement, and endpoint-failure mapping.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LspProviderId, type LspProviderQuery } from '@deepseek-ai/dsh-lsp'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { HostWorkspace } from '@deepseek-ai/dsh-lsp-stdio/src/host.ts'
import { Config } from '../src/config.ts'
import { establishConnection } from '../src/connection.ts'
import { GodotLspProvider } from '../src/provider.ts'
import { FakeGodotLspServer } from './fixtures/fake-lsp-server.ts'

/** The real Godot 4.7 hover on `Vector2.RIGHT` (T0 sample). */
const VECTOR2_HOVER =
  '\t<Native> class Vector2\n\n使用浮点数坐标的 2D 向量。\n**注意：**在布尔语境中，如果 Vector2 等于 `Vector2(0, 0)` 则求值结果为 `false`。'

/** The real Godot 4.7 definition URI (T0 sample, drive letter URL-encoded). */
const REAL_GODOT_URI = 'file:///D%3A/project/player.gd'

let root: string
let ws: string
const contexts: Context[] = []

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-godot-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'main.gd'), 'extends Node\nvar hero: Player\nfunc _ready():\n\thero.move()\n')
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

/** A provider whose connections attach to the given fake server (no scripted responses). */
async function attachProvider(server: FakeGodotLspServer): Promise<GodotLspProvider> {
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  contexts.push(ctx)
  return new GodotLspProvider(
    ctx.fs,
    Config({}),
    async (_key: string, workspace: HostWorkspace, signal) =>
      establishConnection({
        host: '127.0.0.1',
        ports: [server.port],
        connectTimeoutMs: 2000,
        idleTimeoutMs: 1000,
        maxMessageBytes: 1_000_000,
        workspaceRoot: workspace.canonicalPath,
        workspaceFileUrl: workspace.fileUrl,
      }).then((connection) => {
        signal?.throwIfAborted()
        return connection
      }),
  )
}

/** The capabilities a Godot 4.7 server advertises (T0 facts, corrected recording). */
const GODOT_CAPABILITIES = {
  hoverProvider: true,
  definitionProvider: true,
  referencesProvider: true,
  textDocumentSync: { change: 1, openClose: true },
}

/** A scripted initialize response for the given capabilities. */
function initResult(capabilities: Record<string, unknown>): { capabilities: Record<string, unknown> } {
  return { capabilities }
}

function baseQuery(overrides: Partial<Parameters<GodotLspProvider['query']>[0]> = {}): LspProviderQuery {
  return {
    operation: 'goToDefinition',
    filePath: 'main.gd',
    position: { line: 1, character: 10 },
    workspaceRoot: ws,
    // The seam derives the language id from the provider's extension mapping
    // and injects it before calling query (seam contract).
    languageId: 'gdscript',
    ...overrides,
  }
}

describe('GodotLspProvider.query', () => {
  it('registers the godot id with the .gd extension mapping', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    contexts.push(ctx)
    const provider = new GodotLspProvider(ctx.fs, Config({}), async () => {
      throw new Error('unused')
    })
    expect(provider.id).toBe(LspProviderId('godot'))
    expect(provider.extensionToLanguage).toEqual({ '.gd': 'gdscript' })
  })

  it('serves goToDefinition with transient open/close and normalized locations', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', initResult(GODOT_CAPABILITIES))
    server.setMethodResult('textDocument/definition', [
      { uri: REAL_GODOT_URI, range: { start: { line: 0, character: 11 }, end: { line: 0, character: 17 } } },
    ])
    const provider = await attachProvider(server)

    const result = await provider.query(baseQuery())
    expect(result.kind).toBe('locations')
    if (result.kind !== 'locations') return
    expect(result.locations).toHaveLength(1)
    // The URL-encoded drive letter is normalized to the fs form.
    expect(result.locations[0]?.uri).toBe('file:///D:/project/player.gd')
    expect(result.resolvedWorkspaceUri).toMatch(/^file:\/\//)

    const opened = server.inbound.find(m => m.method === 'textDocument/didOpen')
    expect(opened?.params).toMatchObject({
      textDocument: { languageId: 'gdscript', version: 1 },
    })
    expect((opened?.params as { textDocument: { text: string } }).textDocument.text).toContain('extends Node')
    expect(server.methods()).toContain('textDocument/definition')
    // didClose lands a tick after the query resolves (notify is fire-and-forget).
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(server.methods()).toContain('textDocument/didClose')
    // didClose follows didOpen.
    const openIdx = server.methods().indexOf('textDocument/didOpen')
    const closeIdx = server.methods().indexOf('textDocument/didClose')
    expect(closeIdx).toBeGreaterThan(openIdx)
    await server.close()
  })

  it('serves queries without a caller signal (lifetime signal fallback)', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', initResult(GODOT_CAPABILITIES))
    server.setMethodResult('textDocument/definition', [])
    const provider = await attachProvider(server)

    const queryRequest = { operation: 'goToDefinition' as const, filePath: 'main.gd', position: { line: 1, character: 10 }, workspaceRoot: ws, languageId: 'gdscript' }
    const result = await provider.query(queryRequest)
    expect(result).toMatchObject({ kind: 'locations', locations: [] })
    expect((result as { resolvedWorkspaceUri: string }).resolvedWorkspaceUri).toEqual(expect.any(String))
    await server.close()
  })

  it('serves queries with a caller signal fused into the query lifecycle', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', initResult(GODOT_CAPABILITIES))
    server.setMethodResult('textDocument/definition', [])
    const provider = await attachProvider(server)

    const controller = new AbortController()
    const result = await provider.query({ operation: 'goToDefinition', filePath: 'main.gd', position: { line: 1, character: 10 }, workspaceRoot: ws, languageId: 'gdscript' }, controller.signal)
    expect(result.kind).toBe('locations')
    await server.close()
  })

  it('skips didClose when the connection dies mid-query', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()
    const provider = await attachProvider(server)

    const querying = provider.query(baseQuery())
    await new Promise(resolve => setTimeout(resolve, 30))
    server.respond(1, initResult(GODOT_CAPABILITIES))
    await new Promise(resolve => setTimeout(resolve, 30))
    // The definition request is in flight when the server dies.
    server.dropClients()
    await expect(querying).rejects.toMatchObject({ code: 'LSP_UNAVAILABLE' })
    // No didClose was sent after the teardown.
    expect(server.methods().filter(m => m === 'textDocument/didClose')).toHaveLength(0)
    await server.close()
  })

  it('includes declarations in findReferences', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', initResult(GODOT_CAPABILITIES))
    server.setMethodResult('textDocument/references', [])
    const provider = await attachProvider(server)

    await provider.query(baseQuery({ operation: 'findReferences' }))
    const refs = server.inbound.find(m => m.method === 'textDocument/references')
    expect(refs?.params).toMatchObject({ context: { includeDeclaration: true } })
    await server.close()
  })

  it('cleans Godot hover markdown and returns null for empty contents', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', initResult(GODOT_CAPABILITIES))
    server.setMethodResult('textDocument/hover', { contents: { kind: 'markdown', value: VECTOR2_HOVER } })
    const provider = await attachProvider(server)

    const hover = await provider.query(baseQuery({ operation: 'hover' }))
    expect(hover.kind).toBe('hover')
    if (hover.kind !== 'hover') return
    expect(hover.hover?.contents.startsWith('<Native> class Vector2')).toBe(true)
    expect(hover.hover?.contents).not.toContain('\n\t')

    // Empty contents arrays (Godot on type positions, T0) normalize to null.
    server.setMethodResult('textDocument/hover', { contents: [] })
    const empty = await provider.query(baseQuery({ operation: 'hover' }))
    expect(empty).toEqual({ kind: 'hover', hover: null })
    await server.close()
  })

  it('rejects goToImplementation with LSP_UNSUPPORTED_OPERATION', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    // Godot's capabilities never include implementationProvider (T0 fact).
    server.setMethodResult('initialize', initResult(GODOT_CAPABILITIES))
    const provider = await attachProvider(server)

    await expect(provider.query(baseQuery({ operation: 'goToImplementation' }))).rejects.toMatchObject({
      code: 'LSP_UNSUPPORTED_OPERATION',
    })
    await server.close()
  })

  it('rejects a server that does not advertise transient open support', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    // A textDocumentSync form without openClose:true cannot serve transient opens.
    server.setMethodResult('initialize', initResult({ hoverProvider: true, definitionProvider: true, textDocumentSync: { change: 1 } }))
    const provider = await attachProvider(server)

    await expect(provider.query(baseQuery())).rejects.toMatchObject({ code: 'LSP_UNSUPPORTED_OPERATION' })
    await server.close()
  })

  it('fails with LSP_UNAVAILABLE when the server project does not match the workspace', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()
    const provider = await attachProvider(server)

    const querying = provider.query(baseQuery())
    await new Promise(resolve => setTimeout(resolve, 30))
    // Godot announces a different project before the initialize response (T0 Phase C).
    server.sendNotification('gdscript_client/changeWorkspace', { path: 'D:/different-project' })
    server.respond(1, initResult(GODOT_CAPABILITIES))
    await expect(querying).rejects.toMatchObject({ code: 'LSP_UNAVAILABLE' })
    await server.close()
  })

  it('maps endpoint failures to LSP_UNAVAILABLE and rebuilds on the next query', async () => {
    const server = new FakeGodotLspServer({ hold: true })
    await server.listen()
    const provider = await attachProvider(server)

    const first = provider.query(baseQuery())
    await new Promise(resolve => setTimeout(resolve, 30))
    server.dropClients()
    await expect(first).rejects.toMatchObject({ code: 'LSP_UNAVAILABLE' })

    // The dead connection is evicted; the next query reconnects to the still
    // listening server and succeeds.
    const second = provider.query(baseQuery())
    server.respond(1, initResult(GODOT_CAPABILITIES))
    server.respond(2, [])
    await expect(second).resolves.toMatchObject({ kind: 'locations', locations: [] })
    await server.close()
  })
})
