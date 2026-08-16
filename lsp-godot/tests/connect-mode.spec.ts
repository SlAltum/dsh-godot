/**
 * S4b-1: connect-mode orchestration (attach / spawn / auto). `connectForWorkspace`
 * picks the mode per config, falls back from attach to spawn in auto mode,
 * and wraps spawned connections so closing them terminates the owned editor
 * (the provider's pool evicts through close). Deps are injected so the mode
 * decisions are testable without processes or sockets.
 */

import { describe, expect, it, vi } from 'vitest'
import type { GodotLspConnection } from '../src/connection.ts'
import type { ConnectMode } from '../src/config.ts'
import type { GodotLspConfig } from '../src/config.ts'
import { Config } from '../src/config.ts'
import { connectForWorkspace, type ConnectModeDeps } from '../src/connect-mode.ts'
import type { SpawnedEditor } from '../src/spawn.ts'

const WORKSPACE = {
  canonicalPath: 'D:\\proj',
  fileUrl: 'file:///D:/proj',
  target: { targetKey: 'D:\\proj', displayPath: 'D:\\proj' },
} as never

/** A connection double whose close is observable. */
function fakeConnection(name: string): GodotLspConnection & { closed: boolean } {
  const connection = {
    name,
    closed: false,
    endpoint: { connected: true } as never,
    capabilities: {},
    serverProjectPath: undefined,
    get dead() { return this.closed },
    close() { this.closed = true },
    matchesWorkspace: () => true,
  }
  return connection
}

/** An editor double whose close is observable. */
function fakeEditor(): SpawnedEditor & { closed: boolean } {
  return { closed: false, port: 6010, stderrTail: '', close() { this.closed = true }, get dead() { return this.closed } }
}

type DepsResult = ConnectModeDeps & { attachLog: string[]; spawnLog: string[]; editors: Array<SpawnedEditor & { closed: boolean }> }

function deps(overrides: Partial<ConnectModeDeps> = {}): DepsResult {
  const attachLog: string[] = []
  const spawnLog: string[] = []
  const editors: Array<SpawnedEditor & { closed: boolean }> = []
  return {
    attach: vi.fn(async (options: { ports: number[] }) => {
      attachLog.push(options.ports.join(','))
      return fakeConnection(`attach:${options.ports.join(',')}`)
    }),
    spawnEditor: vi.fn(async () => {
      spawnLog.push('spawn')
      const editor = fakeEditor()
      editors.push(editor)
      return { port: editor.port, editor }
    }),
    attachLog,
    spawnLog,
    editors,
    ...overrides,
  }
}

function config(mode: ConnectMode): GodotLspConfig {
  return Config({ connectMode: mode, ports: [6005] })
}

describe('connectForWorkspace', () => {
  it('attach mode connects through the configured ports and never spawns', async () => {
    const d = deps()
    const connection = await connectForWorkspace(config('attach'), WORKSPACE, new AbortController().signal, d)
    expect(d.attachLog).toEqual(['6005'])
    expect(d.spawnLog).toEqual([])
    expect(connection.endpoint).toBeDefined()
  })

  it('spawn mode spawns an editor and attaches to its port', async () => {
    const d = deps()
    const connection = await connectForWorkspace(config('spawn'), WORKSPACE, new AbortController().signal, d)
    expect(d.spawnLog).toEqual(['spawn'])
    expect(d.attachLog).toEqual(['6010'])
    expect(connection.endpoint).toBeDefined()
  })

  it('spawned connections delegate capability and workspace facts to the attach connection', async () => {
    const d = deps()
    const connection = await connectForWorkspace(config('spawn'), WORKSPACE, new AbortController().signal, d)
    expect(connection.capabilities).toEqual({})
    expect(connection.serverProjectPath).toBeUndefined()
    expect(connection.matchesWorkspace()).toBe(true)
  })

  it('closing a spawned connection closes the owned editor', async () => {
    const d = deps()
    const connection = await connectForWorkspace(config('spawn'), WORKSPACE, new AbortController().signal, d)
    expect(d.editors).toHaveLength(1)
    const editor = d.editors[0]
    expect(editor).toBeDefined()
    connection.close()
    expect(editor?.closed).toBe(true)
    expect(connection.dead).toBe(true)
  })

  it('closing an attached connection does not kill anything', async () => {
    const d = deps()
    const connection = await connectForWorkspace(config('attach'), WORKSPACE, new AbortController().signal, d)
    connection.close()
    expect(connection.dead).toBe(true)
  })

  it('auto mode uses attach when it succeeds', async () => {
    const d = deps()
    await connectForWorkspace(config('auto'), WORKSPACE, new AbortController().signal, d)
    expect(d.attachLog).toEqual(['6005'])
    expect(d.spawnLog).toEqual([])
  })

  it('auto mode falls back to spawn when attach fails', async () => {
    const d = deps({
      attach: vi.fn()
        .mockImplementationOnce(async () => { throw new Error('refused') })
        .mockImplementation(async (options: { ports: number[] }) => {
          d.attachLog.push(options.ports.join(','))
          return fakeConnection(`attach:${options.ports.join(',')}`)
        }),
    })
    const connection = await connectForWorkspace(config('auto'), WORKSPACE, new AbortController().signal, d)
    expect(d.spawnLog).toEqual(['spawn'])
    expect(d.attachLog).toEqual(['6010'])
    expect(connection.endpoint).toBeDefined()
  })

  it('auto mode reports the attach failure when spawn also fails', async () => {
    const d = deps({
      attach: vi.fn(async () => { throw new Error('refused') }),
      spawnEditor: vi.fn(async () => { throw new Error('version gate') }),
    })
    await expect(connectForWorkspace(config('auto'), WORKSPACE, new AbortController().signal, d)).rejects.toThrow('version gate')
  })
})
