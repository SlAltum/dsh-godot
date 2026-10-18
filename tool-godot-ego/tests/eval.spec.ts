/**
 * `godot_eval`: request shape, value rendering, and the missing-payload
 * fallbacks.
 */

import { describe, expect, it, vi } from 'vitest'
import { GameSessionRegistry } from '../src/session-service.ts'
import { evalTool } from '../src/eval.ts'

const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }

async function setup(payload: Record<string, unknown>) {
  const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload }))
  const registry = new GameSessionRegistry(async () => ({
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request,
  }))
  await registry.ensure('/ws', {})
  return { tool: evalTool(registry), request }
}

describe('evalTool', () => {
  it('sends the expression and renders value with its type', async () => {
    const { tool, request } = await setup({ value: 3, type: 'int' })
    const value = await tool.execute({ expression: '1 + 2' }, exec as never)
    expect(request).toHaveBeenCalledWith('eval', { expression: '1 + 2' }, exec.signal)
    expect(value).toEqual({ value: '3', type: 'int' })
    const block = tool.output.render({}, value)[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.text).toBe('3 (int)')
  })

  it('falls back for a payload without value or type', async () => {
    const { tool } = await setup({})
    await expect(tool.execute({ expression: 'null' }, exec as never)).resolves.toEqual({ value: 'null', type: 'unknown' })
  })

  it('requires a running session', async () => {
    const tool = evalTool(new GameSessionRegistry(async () => ({
      sessionId: 's',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })))
    await expect(tool.execute({ expression: '1' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
