/**
 * S4b/S6: REAL composition and plugin assembly. (1) The full in-process chain
 * — tool-lsp tool → ctx.lsp seam → lsp-godot provider → fake Godot LSP server
 * — asserting the model-visible rendered output, plus disposal semantics
 * (provider unregisters, connections torn down). (2) `createConnectDeps`
 * spawn pipeline against a fake subprocess: version probe, headless spawn,
 * readiness, without a real Godot binary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import Lsp from '@deepseek-ai/dsh-lsp'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import * as ToolLsp from '@deepseek-ai/dsh-tool-lsp'
import * as GodotLsp from '../src/index.ts'
import { Config, createConnectDeps } from '../src/index.ts'
import type { SubprocessLike } from '../src/index.ts'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { FakeGodotLspServer } from './fixtures/fake-lsp-server.ts'

let root: string
let ws: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-godot-real-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'main.gd'), 'extends Node\nvar hero: Player\nfunc _ready():\n\thero.move()\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Mount the full tool chain with lsp-godot attached to a fake server. */
async function mount(server: FakeGodotLspServer): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Lsp)
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(TimeoutPolicy)
  await ctx.plugin(GodotLsp, GodotLsp.Config({ connectMode: 'attach', ports: [server.port] }))
  await ctx.plugin(ToolLsp)
  return ctx
}

let seq = 0
function callLsp(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `real-${++seq}` as never,
    name: 'lsp',
    arguments: args,
    agent: { session: { header: { cwd: ws } } } as never,
  })
}

describe('REAL composition: tool → seam → provider → fake Godot server', () => {
  it('round-trips a definition query to model-visible rendered locations', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', { capabilities: { hoverProvider: true, definitionProvider: true, referencesProvider: true, textDocumentSync: { change: 1, openClose: true } } })
    // The fixture URI points INTO the workspace so tool-lsp renders a
    // workspace-relative path.
    const targetUrl = `file:///${join(ws, 'player.gd').replace(/\\/g, '/')}`
    server.setMethodResult('textDocument/definition', [
      { uri: targetUrl, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } },
    ])
    const ctx = await mount(server)

    const result = await callLsp(ctx, { operation: 'goToDefinition', file_path: 'main.gd', line: 2, character: 11 })
    expect(result.isError).toBe(false)
    // tool-lsp renders one-based locations relative to the workspace.
    expect(result.content[0]).toEqual({ type: 'text', text: 'player.gd:1:1' })
    await ctx.fiber.dispose()
    await server.close()
  }, 30_000)

  it('unregisters the provider and closes connections on disposal', async () => {
    const server = new FakeGodotLspServer()
    await server.listen()
    server.setMethodResult('initialize', { capabilities: { hoverProvider: true, definitionProvider: true, referencesProvider: true, textDocumentSync: { change: 1, openClose: true } } })
    server.setMethodResult('textDocument/definition', [])
    const ctx = await mount(server)

    // Warm the connection pool once, then keep the seam reference: after
    // disposal the ctx proxy itself is gone.
    await callLsp(ctx, { operation: 'goToDefinition', file_path: 'main.gd', line: 2, character: 11 })
    const lsp = ctx.lsp
    await ctx.fiber.dispose()
    // After disposal the seam has no provider for .gd files.
    await expect(lsp.query({ operation: 'goToDefinition', filePath: 'main.gd', position: { line: 1, character: 10 }, workspaceRoot: ws }))
      .rejects.toMatchObject({ code: 'LSP_UNAVAILABLE' })
    await server.close()
  }, 30_000)
})

describe('createConnectDeps spawn pipeline over a fake subprocess', () => {
  /** A fake handle whose collected stdout yields the given text; `pending` keeps done unsettled (a long-lived editor). */
  function handleWithOutput(stdoutText: string, pending = false): SubprocessHandle {
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => ({ text: stdoutText, nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done: pending ? new Promise(() => {}) : Promise.resolve({ exitCode: 0, signal: null }),
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => true),
    }
  }

  it('probes the version, spawns the headless editor, and returns the ready editor', async () => {
    let server: Server | undefined
    const port = await new Promise<number>((resolve, reject) => {
      server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () =>{  resolve((server!.address() as { port: number }).port) })
    })
    try {
      const probeHandle = handleWithOutput('4.7.stable.mono.official')
      const editorHandle = handleWithOutput('', true)
      const spawns: unknown[] = []
      const spawnImpl = vi.fn((spec: unknown) => { spawns.push(spec); return probeHandle })
      const subprocess: SubprocessLike = {
        resolveExecutable: vi.fn(async () => 'C:/Godot/godot.exe'),
        spawn: spawnImpl,
      }
      const deps = createConnectDeps(subprocess, Config({ connectMode: 'spawn', spawnReadyTimeoutMs: 5000 }))
      // The first spawn is the version probe; the second is the editor itself.
      spawnImpl.mockImplementationOnce((spec: unknown) => { spawns.push(spec); return probeHandle })
      spawnImpl.mockImplementationOnce((spec: unknown) => { spawns.push(spec); return editorHandle })

      const result = await deps.spawnEditor(Config({ connectMode: 'spawn', spawnExecutable: 'godot', spawnPort: port }), {
        canonicalPath: ws,
        fileUrl: `file:///${ws.replace(/\\/g, '/')}`,
        target: { targetKey: ws, displayPath: ws },
      } as never, new AbortController().signal)

      expect((spawns[0] as { argv: string[] }).argv).toEqual(['C:/Godot/godot.exe', '--version'])
      const editorArgv = (spawns[1] as { argv: string[] }).argv
      expect(editorArgv.slice(0, -1)).toEqual(['C:/Godot/godot.exe', '--path', ws, '--editor', '--headless', '--no-window', '--lsp-port'])
      expect(Number(editorArgv.at(-1))).toBe(port)
      expect(result.port).toBe(port)
      expect(result.editor).toBeDefined()
    } finally {
      await new Promise<void>(resolve => server!.close(() =>{  resolve() }))
    }
  }, 30_000)

  it('falls back to an empty version when the probe has no stdout', async () => {
    const noOutputHandle: SubprocessHandle = {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => true),
    }
    const subprocess: SubprocessLike = {
      resolveExecutable: vi.fn(async () => 'C:/Godot/godot.exe'),
      spawn: vi.fn(() => noOutputHandle),
    }
    const deps = createConnectDeps(subprocess, Config({ connectMode: 'spawn' }))
    await expect(deps.spawnEditor(Config({ connectMode: 'spawn' }), {
      canonicalPath: ws,
      fileUrl: `file:///${ws.replace(/\\/g, '/')}`,
      target: { targetKey: ws, displayPath: ws },
    } as never, new AbortController().signal)).rejects.toThrow(/headless LSP requires/)
  }, 30_000)

  it('arms a per-workspace spawn cooldown after a failure and clears it on success (T17-A)', async () => {
    let server: Server | undefined
    const port = await new Promise<number>((resolve, reject) => {
      server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () =>{  resolve((server!.address() as { port: number }).port) })
    })
    const probeHandle = handleWithOutput('4.7.stable.mono.official')
    const spawns: unknown[] = []
    // The version probe and the editor spawn are distinguished by argv; the
    // EDITOR handle is switched per phase (exits-immediately vs long-lived).
    let editorHandle: SubprocessHandle = handleWithOutput('', false)
    const spawnImpl = vi.fn((spec: { argv: string[] }) => {
      spawns.push(spec)
      return spec.argv.includes('--version') ? probeHandle : editorHandle
    })
    const subprocess: SubprocessLike = {
      resolveExecutable: vi.fn(async () => 'C:/Godot/godot.exe'),
      spawn: spawnImpl,
    }
    const workspace = {
      canonicalPath: ws,
      fileUrl: `file:///${ws.replace(/\\/g, '/')}`,
      target: { targetKey: ws, displayPath: ws },
    } as never
    // Failure injection uses an UNLISTENED port (the readiness probe wins the
    // race against the exited-process check when the port answers); success
    // uses the listening server port. The cooldown is per-workspace, so the
    // two configs share it.
    const failCfg = Config({ connectMode: 'spawn', spawnExecutable: 'godot', spawnPort: 1, spawnReadyTimeoutMs: 500, spawnRetryCooldownMs: 150 })
    const okCfg = Config({ connectMode: 'spawn', spawnExecutable: 'godot', spawnPort: port, spawnReadyTimeoutMs: 500, spawnRetryCooldownMs: 150 })
    try {
      const deps = createConnectDeps(subprocess, failCfg)
      // 1. The editor process exits before its LSP starts → the spawn fails.
      await expect(deps.spawnEditor(failCfg, workspace, new AbortController().signal)).rejects.toThrow(/exited before LSP/)
      const spawnsAfterFailure = spawns.length
      // 2. Inside the cooldown: fail fast with LSP_UNAVAILABLE, no re-spawn.
      await expect(deps.spawnEditor(okCfg, workspace, new AbortController().signal))
        .rejects.toMatchObject({ code: 'LSP_UNAVAILABLE' })
      expect(spawns.length).toBe(spawnsAfterFailure) // neither probe nor editor spawned again
      // 3. After the cooldown elapses a retry succeeds against the listening
      //    server and clears the cooldown.
      await new Promise(resolve => setTimeout(resolve, 200))
      editorHandle = handleWithOutput('', true) // long-lived editor; the port answers
      const result = await deps.spawnEditor(okCfg, workspace, new AbortController().signal)
      expect(result.port).toBe(port)
      const spawnsAfterSuccess = spawns.length
      // 4. The cooldown was cleared: the next call spawns again (no fast fail).
      await deps.spawnEditor(okCfg, workspace, new AbortController().signal)
      expect(spawns.length).toBeGreaterThan(spawnsAfterSuccess)
    } finally {
      await new Promise<void>(resolve => server!.close(() =>{  resolve() }))
    }
  }, 30_000)
})
