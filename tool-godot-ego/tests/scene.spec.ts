/**
 * `godot_scene`: report or switch the current scene, including the argument
 * validation and the rendering of both outcomes.
 */

import { describe, expect, it, vi } from 'vitest'
import { EgoGodotError } from '../src/errors.ts'
import { sceneTool } from '../src/scene.ts'
import { GameSessionRegistry } from '../src/session-service.ts'

const exec = {
  agent: { session: { header: { cwd: '/ws' } } },
  signal: new AbortController().signal,
}

type Handler = (cmd: string, params: Readonly<Record<string, unknown>>) => Record<string, unknown>

async function setup(handler: Handler) {
  const calls: Array<{ cmd: string; params: Readonly<Record<string, unknown>> }> = []
  const request = vi.fn(async (cmd: string, params: Readonly<Record<string, unknown>>) => {
    calls.push({ cmd, params })
    return { kind: 'ok' as const, id: calls.length, payload: handler(cmd, params) }
  })
  const registry = new GameSessionRegistry(async () => ({
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request,
  }))
  await registry.ensure('/ws', {})
  return { tool: sceneTool(registry), calls }
}

function textOf(blocks: ReturnType<ReturnType<typeof sceneTool>['output']['render']>): string {
  const block = blocks[0]
  if (block?.type !== 'text') throw new Error('expected a text block')
  return block.text
}

describe('godot_scene', () => {
  it('reports the current scene', async () => {
    const { tool, calls } = await setup(() => ({ scene: 'res://main.tscn', sceneCount: 12 }))
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({ scene: 'res://main.tscn', changed: false })
    expect(calls[0]).toEqual({ cmd: 'scene', params: {} })
    expect(textOf(tool.output.render({}, value))).toBe('scene res://main.tscn')
  })

  it('reports a missing scene and tolerates a malformed reply', async () => {
    const empty = await setup(() => ({ scene: '' }))
    expect(textOf(empty.tool.output.render({}, await empty.tool.execute({}, exec as never)))).toBe('scene (no scene)')
    const malformed = await setup(() => ({ scene: 42 }))
    await expect(malformed.tool.execute({}, exec as never)).resolves.toEqual({ scene: '', changed: false })
  })

  it('switches to a scene and reports the new frame', async () => {
    const { tool, calls } = await setup(() => ({ scene: 'res://levels/test.tscn', frames: 77 }))
    const value = await tool.execute({ path: 'res://levels/test.tscn' }, exec as never)
    expect(value).toEqual({ scene: 'res://levels/test.tscn', changed: true, frames: 77 })
    expect(calls[0]).toEqual({ cmd: 'scene', params: { path: 'res://levels/test.tscn' } })
    expect(textOf(tool.output.render({}, value))).toBe('switched to res://levels/test.tscn · frame 77')
  })

  it('falls back to the requested path and frame zero', async () => {
    const { tool } = await setup(() => ({}))
    const value = await tool.execute({ path: 'res://a.tscn' }, exec as never)
    expect(value).toEqual({ scene: 'res://a.tscn', changed: true, frames: 0 })
    expect(textOf(tool.output.render({}, value))).toBe('switched to res://a.tscn · frame 0')
    expect(textOf(tool.output.render({}, { scene: 'res://a.tscn', changed: true }))).toBe('switched to res://a.tscn · frame 0')
  })

  it('rejects a non-res path without contacting the bridge', async () => {
    const { tool, calls } = await setup(() => ({}))
    await expect(tool.execute({ path: 'levels/test.tscn' }, exec as never)).rejects.toThrow(/res:\/\//)
    expect(calls).toHaveLength(0)
  })

  it('surfaces a bridge rejection and requires a running session', async () => {
    const registry = new GameSessionRegistry(async () => ({
      sessionId: 's1',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => { throw new EgoGodotError('bridge rejected the command (BAD_REQUEST): change_scene failed: 31', 'GODOT_EGO_REJECTED') },
    }))
    await registry.ensure('/ws', {})
    await expect(sceneTool(registry).execute({ path: 'res://missing.tscn' }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(sceneTool(new GameSessionRegistry(async () => ({
      sessionId: 's2',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    }))).execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
