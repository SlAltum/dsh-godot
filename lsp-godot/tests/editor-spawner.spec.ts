/**
 * S7b: the real editor spawner over the subprocess seam. Pins the argv
 * template (`--path --editor --headless --no-window --lsp-port`), the
 * TCP-ready wait with early-exit detection, the retained stderr tail, and
 * tree-scoped termination. The subprocess service is faked; the ready port is
 * a real TCP server so the readiness probe is exercised for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:net'
import { createEditorSpawner, type SubprocessLike } from '../src/editor-spawner.ts'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

/** A fake SubprocessHandle whose done/terminate are scriptable. */
function fakeHandle(overrides: Partial<SubprocessHandle> = {}): SubprocessHandle & { terminated: boolean } {
  let resolveDone: (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void = () => {}
  const handle: SubprocessHandle & { terminated: boolean } = {
    control: undefined,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {},
    done: new Promise((resolve) => { resolveDone = resolve }),
    terminate: vi.fn(() => { handle.terminated = true }),
    waitForExit: vi.fn(async () => true),
    terminated: false,
    ...overrides,
  }
  ;(handle as unknown as { resolveDone: typeof resolveDone }).resolveDone = resolveDone
  return handle
}

let server: Server | undefined
beforeEach(() => { server = undefined })
afterEach(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => { server!.close(() => { resolve() }) })
})

/** Start a real TCP listener and return its port. */
async function listeningPort(): Promise<number> {
  server = createServer()
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => { resolve() })
  })
  return (server.address() as { port: number }).port
}

/** Settle a fake handle's done promise. */
function settleHandle(handle: SubprocessHandle, facts: { exitCode: number | null; signal: NodeJS.Signals | null }): void {
  const withDone = handle as unknown as { resolveDone: (v: { exitCode: number | null; signal: NodeJS.Signals | null }) => void }
  withDone.resolveDone(facts)
}

type FakeSubprocess = SubprocessLike & { spawnSpecs: unknown[]; resolveExecutableMock: ReturnType<typeof vi.fn> }

function fakeSubprocess(handle: SubprocessHandle): FakeSubprocess {
  const spawnSpecs: unknown[] = []
  const resolveExecutableMock = vi.fn(async () => 'C:/Godot/godot.exe')
  return {
    spawnSpecs,
    resolveExecutableMock,
    resolveExecutable: resolveExecutableMock,
    spawn: vi.fn((spec) => { spawnSpecs.push(spec); return handle }),
  }
}

const baseConfig = { maxStderrBytes: 1024, killGraceMs: 500, spawnReadyTimeoutMs: 10_000 }

describe('createEditorSpawner', () => {
  it('spawns with the headless editor argv template and waits for the port', async () => {
    const port = await listeningPort()
    const handle = fakeHandle()
    const subprocess = fakeSubprocess(handle)
    const spawner = createEditorSpawner(subprocess, baseConfig)

    const editor = await spawner.spawnEditor({ projectDir: 'D:/proj', port, executable: 'godot', extraArgs: ['--verbose'] }, new AbortController().signal)

    expect(subprocess.resolveExecutableMock).toHaveBeenCalledWith('godot', undefined, expect.anything())
    expect(subprocess.spawnSpecs[0]).toMatchObject({
      argv: ['C:/Godot/godot.exe', '--path', 'D:/proj', '--editor', '--headless', '--no-window', '--lsp-port', String(port), '--verbose'],
      cwd: 'D:/proj',
    })
    expect(editor.port).toBe(port)
    expect(editor.dead).toBe(false)
  })

  it('kill terminates the process tree', async () => {
    const port = await listeningPort()
    const handle = fakeHandle()
    const spawner = createEditorSpawner(fakeSubprocess(handle), baseConfig)

    const editor = await spawner.spawnEditor({ projectDir: 'D:/proj', port, executable: 'godot', extraArgs: [] }, new AbortController().signal)
    editor.close()
    expect(handle.terminated).toBe(true)
    expect(editor.dead).toBe(true)
  })

  it('reports the stderr tail and marks the editor dead after the process exits', async () => {
    const port = await listeningPort()
    const handle = fakeHandle()
    const spawner = createEditorSpawner(fakeSubprocess(handle), baseConfig)

    const editor = await spawner.spawnEditor({ projectDir: 'D:/proj', port, executable: 'godot', extraArgs: [] }, new AbortController().signal)
    expect(editor.stderrTail).toBe('')
    settleHandle(handle, { exitCode: 0, signal: null })
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(editor.dead).toBe(true)
  })

  it('fails with the stderr tail when the editor exits before the port is ready', async () => {
    // Port 1 is not listening: the readiness probe keeps failing while the
    // process exits on the next round.
    const handle = fakeHandle()
    const subprocess = fakeSubprocess(handle)
    const spawner = createEditorSpawner(subprocess, baseConfig)

    const spawning = spawner.spawnEditor({ projectDir: 'D:/proj', port: 1, executable: 'godot', extraArgs: [] }, new AbortController().signal)
    settleHandle(handle, { exitCode: 1, signal: null })
    await expect(spawning).rejects.toThrow(/exited before LSP started/)
  })

  it('times out when the port never becomes ready', async () => {
    // No listener: the readiness probe cannot connect.
    const spawner = createEditorSpawner(fakeSubprocess(fakeHandle()), { ...baseConfig, spawnReadyTimeoutMs: 1500 })
    await expect(spawner.spawnEditor({ projectDir: 'D:/proj', port: 1, executable: 'godot', extraArgs: [] }, new AbortController().signal))
      .rejects.toThrow(/not ready within/)
  })

  it('aborts the wait when the caller signal fires', async () => {
    const controller = new AbortController()
    const spawner = createEditorSpawner(fakeSubprocess(fakeHandle()), { ...baseConfig, spawnReadyTimeoutMs: 30_000 })
    const spawning = spawner.spawnEditor({ projectDir: 'D:/proj', port: 1, executable: 'godot', extraArgs: [] }, controller.signal)
    setTimeout(() => { controller.abort() }, 50)
    await expect(spawning).rejects.toThrow()
  })
})
