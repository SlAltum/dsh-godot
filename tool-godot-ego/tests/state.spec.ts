/**
 * `godot_state`: request shape (defaults and overrides) and the projected
 * snapshot text.
 */

import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { GameSessionRegistry } from '../src/session-service.ts'
import type { EgoSessionHandle } from '../src/session-service.ts'
import { stateTool } from '../src/state.ts'

const exec = {
  agent: { session: { header: { cwd: '/ws' } } },
  signal: new AbortController().signal,
}

const payload = {
  scene: 'res://main.tscn',
  fps: 60,
  frames: 128,
  nodeCount: 3,
  paused: false,
  tree: { name: 'Main', class: 'Node2D', id: '1' },
  targets: [{ path: 'Main/Btn', class: 'Button', rect: [100, 100, 120, 40], text: 'A0' }],
}

async function registryWith(request: ReturnType<typeof vi.fn>): Promise<GameSessionRegistry> {
  const session: EgoSessionHandle = {
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request,
  }
  const registry = new GameSessionRegistry(async () => session)
  await registry.ensure('/ws', {})
  return registry
}

describe('stateTool', () => {
  it('requests the default sections and renders the snapshot', async () => {
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload }))
    const tool = stateTool(await registryWith(request), resolveConfig({ maxNodes: 50 }))
    const value = await tool.execute({}, exec as never)
    expect(request).toHaveBeenCalledWith('state', { tree: true, targets: true, diff: false, maxNodes: 50 }, exec.signal)
    expect(value.snapshot).toContain('scene res://main.tscn · 60 fps · frame 128 · 3 nodes')
    expect(value.snapshot).toContain('Main [Node2D] (1)')
    expect(value.snapshot).toContain('Main/Btn [Button]')
    const blocks = tool.output.render({}, value)
    const block = blocks[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.text).toContain('scene res://main.tscn')
  })

  it('honors explicit section and budget overrides', async () => {
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload }))
    const tool = stateTool(await registryWith(request), resolveConfig({}))
    await tool.execute({ tree: false, targets: false, diff: true, maxNodes: 10 }, exec as never)
    expect(request).toHaveBeenCalledWith('state', { tree: false, targets: false, diff: true, maxNodes: 10 }, exec.signal)
  })

  it('rejects when no session is running', async () => {
    const tool = stateTool(new GameSessionRegistry(async () => ({
      sessionId: 's1',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })), resolveConfig({}))
    await expect(tool.execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
    await expect(tool.execute({}, { agent: undefined, signal: new AbortController().signal } as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
