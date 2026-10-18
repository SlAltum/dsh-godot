/**
 * `godot_actions`: the InputMap action list request, malformed payloads, the
 * empty project, and the rendering.
 */

import { describe, expect, it, vi } from 'vitest'
import { actionsTool } from '../src/actions.ts'
import { EgoGodotError } from '../src/errors.ts'
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
  return { tool: actionsTool(registry), calls }
}

function textOf(blocks: Array<{ type: string; text?: string }>): string {
  const block = blocks[0]
  if (block?.type !== 'text' || block.text === undefined) throw new Error('expected a text block')
  return block.text
}

describe('godot_actions', () => {
  it('lists the project InputMap actions', async () => {
    const { tool, calls } = await setup(() => ({ actions: ['jump', 'ui_accept'], count: 2 }))
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({ actions: ['jump', 'ui_accept'], count: 2 })
    expect(calls[0]).toEqual({ cmd: 'actions', params: {} })
    expect(textOf(tool.output.render({}, value))).toBe('InputMap actions (2)\n  jump\n  ui_accept')
  })

  it('reports a project without actions', async () => {
    const { tool } = await setup(() => ({ actions: [] }))
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({ actions: [], count: 0 })
    expect(textOf(tool.output.render({}, value))).toBe('This project defines no InputMap actions.')
  })

  it('drops malformed entries and a missing list', async () => {
    const mixed = await setup(() => ({ actions: ['jump', 7, null] }))
    await expect(mixed.tool.execute({}, exec as never)).resolves.toEqual({ actions: ['jump'], count: 1 })
    const missing = await setup(() => ({}))
    await expect(missing.tool.execute({}, exec as never)).resolves.toEqual({ actions: [], count: 0 })
  })

  it('surfaces a bridge rejection and requires a running session', async () => {
    const registry = new GameSessionRegistry(async () => ({
      sessionId: 's1',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => { throw new EgoGodotError('bridge rejected the command (UNKNOWN_CMD): actions', 'GODOT_EGO_REJECTED') },
    }))
    await registry.ensure('/ws', {})
    await expect(actionsTool(registry).execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(actionsTool(new GameSessionRegistry(async () => ({
      sessionId: 's2',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    }))).execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
