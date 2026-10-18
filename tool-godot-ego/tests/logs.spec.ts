/**
 * `godot_logs`: incremental process output, cursor round-trip, and the
 * unavailable/no-session paths.
 */

import { describe, expect, it, vi } from 'vitest'
import { GameSessionRegistry } from '../src/session-service.ts'
import type { EgoSessionHandle } from '../src/session-service.ts'
import { logsTool } from '../src/logs.ts'

const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }

async function setup(logs: EgoSessionHandle['logs']): Promise<GameSessionRegistry> {
  const registry = new GameSessionRegistry(async () => ({
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    ...(logs === undefined ? {} : { logs }),
  }))
  await registry.ensure('/ws', {})
  return registry
}

describe('logsTool', () => {
  it('reads both streams with the cursor and renders them', async () => {
    const logs = vi.fn(() => ({ stdout: 'hello\n', stderr: 'warn\n', nextOffset: 42 }))
    const tool = logsTool(await setup(logs))
    const value = await tool.execute({ since: 7, maxBytes: 128 }, exec as never)
    expect(logs).toHaveBeenCalledWith(7, 128)
    expect(value).toEqual({ text: 'stdout:\nhello\n\nstderr:\nwarn\n', nextOffset: 42 })
    const block = tool.output.render({}, value)[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.text).toContain('stdout:')
  })

  it('reports an empty read and defaults', async () => {
    const logs = vi.fn(() => ({ stdout: '', stderr: '', nextOffset: 3 }))
    const tool = logsTool(await setup(logs))
    const value = await tool.execute({}, exec as never)
    expect(logs).toHaveBeenCalledWith(0, 4096)
    expect(value.text).toBe('(no new output)')
  })

  it('rejects when output capture or the session is unavailable', async () => {
    const tool = logsTool(await setup(undefined))
    await expect(tool.execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_UNAVAILABLE' })
    const empty = logsTool(new GameSessionRegistry(async () => ({
      sessionId: 's',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })))
    await expect(empty.execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
