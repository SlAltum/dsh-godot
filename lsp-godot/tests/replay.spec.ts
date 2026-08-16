/**
 * S4c: keyless replay of the T0 transcript data. The fixture
 * (`tests/fixtures/t0-responses.json`) holds responses recorded from a real
 * Godot 4.7 headless editor; replaying them through the provider pins the
 * full pipeline — real capabilities, real hover markdown, real URL-encoded
 * URIs — without needing a Godot binary in CI (T0 facts,
 * `.context/t0/facts.md`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { HostWorkspace } from '@deepseek-ai/dsh-lsp-stdio/src/host.ts'
import { Config } from '../src/config.ts'
import { establishConnection } from '../src/connection.ts'
import { GodotLspProvider } from '../src/provider.ts'
import { FakeGodotLspServer } from './fixtures/fake-lsp-server.ts'

/** Real Godot 4.7 responses recorded by the T0 probe. */
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/t0-responses.json', import.meta.url), 'utf8'),
) as {
  initializeCapabilities: Record<string, unknown>
  hoverRaw: {
    vector2Right: { contents: { kind: string; value: string }; range: unknown }
    refCounted: { contents: { kind: string; value: string } }
    playerClass: { contents: { kind: string; value: string } }
    emptyContents: { contents: unknown[] }
  }
  definitionUri: string
  changeWorkspaceOnMismatch: { method: string; params: { path: string } }
}

let root: string
let ws: string
const contexts: Context[] = []

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-godot-replay-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'main.gd'), 'extends Node\nvar hero: Player\nfunc _ready():\n\thero.move()\n')
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

async function providerFor(server: FakeGodotLspServer): Promise<GodotLspProvider> {
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

function query(operation: string) {
  return {
    operation,
    filePath: 'main.gd',
    position: { line: 1, character: 10 },
    workspaceRoot: ws,
    languageId: 'gdscript',
  } as Parameters<GodotLspProvider['query']>[0]
}

describe('T0 transcript replay', () => {
  it('serves definition with the real Godot URI normalized to the fs form', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', { capabilities: FIXTURE.initializeCapabilities })
    server.setMethodResult('textDocument/definition', [
      { uri: FIXTURE.definitionUri, range: { start: { line: 0, character: 11 }, end: { line: 0, character: 17 } } },
    ])
    const provider = await providerFor(server)

    const result = await provider.query(query('goToDefinition'))
    expect(result.kind).toBe('locations')
    if (result.kind !== 'locations') return
    expect(result.locations).toHaveLength(1)
    // The recorded `file:///D%3A/...` URI comes back in DSH fs form.
    expect(result.locations[0]?.uri).toBe('file:///D:/project/player.gd')
    await server.close()
  })

  it('cleans the recorded native-class hover (leading tab) end to end', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', { capabilities: FIXTURE.initializeCapabilities })
    server.setMethodResult('textDocument/hover', FIXTURE.hoverRaw.vector2Right)
    const provider = await providerFor(server)

    const result = await provider.query(query('hover'))
    expect(result.kind).toBe('hover')
    if (result.kind !== 'hover') return
    expect(result.hover?.contents.startsWith('<Native> class Vector2')).toBe(true)
    expect(result.hover?.contents).toContain('使用浮点数坐标的 2D 向量。')
    await server.close()
  })

  it('normalizes a recorded empty hover to null', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', { capabilities: FIXTURE.initializeCapabilities })
    server.setMethodResult('textDocument/hover', FIXTURE.hoverRaw.emptyContents)
    const provider = await providerFor(server)

    const result = await provider.query(query('hover'))
    expect(result).toEqual({ kind: 'hover', hover: null })
    await server.close()
  })

  it('rejects goToImplementation against the recorded real capabilities', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', { capabilities: FIXTURE.initializeCapabilities })
    const provider = await providerFor(server)

    await expect(provider.query(query('goToImplementation'))).rejects.toMatchObject({
      code: 'LSP_UNSUPPORTED_OPERATION',
    })
    await server.close()
  })
})
