/**
 * `godot_stop`: graceful stop through the registry, idempotent when nothing is
 * running, and the tool projection (exit facts present only when known).
 */

import { describe, expect, it, vi } from 'vitest'
import { GameSessionRegistry } from '../src/session-service.ts'
import type { EgoSessionHandle } from '../src/session-service.ts'
import { stopTool } from '../src/stop.ts'

const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }

function handle(stopResult?: { exitCode: number | null; signal: string | null }): EgoSessionHandle {
  return {
    sessionId: 's1',
    workspace: '/ws',
    pid: 42,
    dispose: async () => {},
    request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    ...(stopResult === undefined ? {} : { stop: async () => stopResult }),
  }
}

describe('registry.stop', () => {
  it('stops a session through its own stop and reports the exit facts', async () => {
    const registry = new GameSessionRegistry(async () => handle({ exitCode: 0, signal: null }))
    await registry.ensure('/ws', {})
    const result = await registry.stop('/ws')
    expect(result).toEqual({ stopped: true, sessionId: 's1', exitCode: 0, signal: null })
    expect(registry.get('/ws')).toBeUndefined()
  })

  it('falls back to dispose when the handle has no graceful stop', async () => {
    let disposed = 0
    const registry = new GameSessionRegistry(async workspace => ({
      sessionId: 's2',
      workspace,
      pid: 1,
      dispose: async () => { disposed += 1 },
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    }))
    await registry.ensure('/ws', {})
    const result = await registry.stop('/ws')
    expect(result).toEqual({ stopped: true, sessionId: 's2', exitCode: null, signal: null })
    expect(disposed).toBe(1)
  })

  it('reports nothing to stop and rejects after disposal', async () => {
    const registry = new GameSessionRegistry(async () => handle())
    await expect(registry.stop('/ws')).resolves.toEqual({ stopped: false })
    await registry.disposeAll()
    await expect(registry.stop('/ws')).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
  })
})

describe('stopTool', () => {
  it('projects a stopped session and renders its exit', async () => {
    const registry = new GameSessionRegistry(async () => handle({ exitCode: 0, signal: null }))
    await registry.ensure('/ws', {})
    const tool = stopTool(registry)
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({ stopped: true, sessionId: 's1', exitCode: 0 })
    const rendered = tool.output.render({}, value)
    if (rendered[0]?.type !== 'text') throw new Error('expected text')
    expect(rendered[0].text).toBe('stopped session s1 (exit 0)')
  })

  it('renders the signal and the empty case', async () => {
    const signalled = new GameSessionRegistry(async () => handle({ exitCode: null, signal: 'SIGTERM' }))
    await signalled.ensure('/ws', {})
    const tool = stopTool(signalled)
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({ stopped: true, sessionId: 's1', signal: 'SIGTERM' })
    const text = tool.output.render({}, value)[0]
    if (text?.type !== 'text') throw new Error('expected text')
    expect(text.text).toContain('(SIGTERM)')

    const empty = new GameSessionRegistry(async () => handle())
    const emptyTool = stopTool(empty)
    const none = await emptyTool.execute({}, exec as never)
    expect(none).toEqual({ stopped: false })
    const noneText = emptyTool.output.render({}, none)[0]
    if (noneText?.type !== 'text') throw new Error('expected text')
    expect(noneText.text).toBe('no running session for this workspace')
  })

  it('renders a stop without exit facts', async () => {
    const registry = new GameSessionRegistry(async workspace => ({
      sessionId: 's3',
      workspace,
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    }))
    await registry.ensure('/ws', {})
    const tool = stopTool(registry)
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({ stopped: true, sessionId: 's3' })
    const block = tool.output.render({}, value)[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.text).toBe('stopped session s3')
  })

  it('uses the process cwd when the agent is absent', async () => {
    const registry = new GameSessionRegistry(async () => handle({ exitCode: 0, signal: null }))
    const spy = vi.spyOn(registry, 'stop')
    const tool = stopTool(registry)
    await tool.execute({}, { agent: undefined, signal: new AbortController().signal } as never)
    expect(spy).toHaveBeenCalledWith(process.cwd())
  })
})
