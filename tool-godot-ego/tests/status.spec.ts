/**
 * `godot_status`: the host-side session snapshot, including the degraded view
 * for a factory that does not expose snapshots, and the rendering.
 */

import { describe, expect, it } from 'vitest'
import type { SessionSnapshot } from '../src/session.ts'
import { GameSessionRegistry } from '../src/session-service.ts'
import type { EgoSessionHandle } from '../src/session-service.ts'
import { statusTool } from '../src/status.ts'

const exec = {
  agent: { session: { header: { cwd: '/ws' } } },
  signal: new AbortController().signal,
}

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 's1',
    workspace: '/ws',
    state: 'ready',
    port: 5555,
    pid: 4321,
    window: [1280, 720],
    lostReason: null,
    ...overrides,
  }
}

async function registryWith(handle: Omit<EgoSessionHandle, 'workspace'>): Promise<GameSessionRegistry> {
  const registry = new GameSessionRegistry(async () => ({ ...handle, workspace: '/ws' }))
  await registry.ensure('/ws', {})
  return registry
}

function textOf(blocks: Array<{ type: string; text?: string }>): string {
  const block = blocks[0]
  if (block?.type !== 'text' || block.text === undefined) throw new Error('expected a text block')
  return block.text
}

describe('godot_status', () => {
  it('reports the snapshot without contacting the game', async () => {
    const registry = await registryWith({
      sessionId: 's1',
      pid: 4321,
      projectRoot: '/ws/proj',
      imported: true,
      dispose: async () => {},
      request: async () => { throw new Error('status must not request the game') },
      snapshot: () => snapshot(),
    })
    const tool = statusTool(registry)
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({
      sessionId: 's1',
      state: 'ready',
      pid: 4321,
      window: [1280, 720],
      projectRoot: '/ws/proj',
      imported: true,
    })
    expect(textOf(tool.output.render({}, value))).toBe([
      'session s1 · ready · pid 4321',
      'window 1280x720',
      'project /ws/proj (imported)',
    ].join('\n'))
  })

  it('reports a lost session and a project without an import pass', async () => {
    const registry = await registryWith({
      sessionId: 's1',
      pid: 9,
      projectRoot: '/ws/proj',
      imported: false,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
      snapshot: () => snapshot({ state: 'lost', pid: 9, window: null, lostReason: 'game exited with code 1' }),
    })
    const tool = statusTool(registry)
    const value = await tool.execute({}, exec as never)
    expect(value).toMatchObject({ state: 'lost', lostReason: 'game exited with code 1' })
    expect(value).not.toHaveProperty('window')
    const text = textOf(tool.output.render({}, value))
    expect(text).toContain('project /ws/proj\n')
    expect(text).not.toContain('(imported)')
    expect(text).toContain('lost: game exited with code 1')
  })

  it('degrades when the session factory exposes no snapshot', async () => {
    const registry = await registryWith({
      sessionId: 's1',
      pid: null,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })
    const tool = statusTool(registry)
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({ sessionId: 's1', state: 'unknown' })
    expect(textOf(tool.output.render({}, value))).toBe('session s1 · unknown')
  })

  it('requires a running session', async () => {
    const registry = new GameSessionRegistry(async () => ({
      sessionId: 's1',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    }))
    await expect(statusTool(registry).execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
