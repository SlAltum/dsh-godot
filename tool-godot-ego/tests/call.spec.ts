/** `godot_call`: request shape, the reply projection, and the failure paths. */

import { describe, expect, it, vi } from 'vitest'
import { callTool } from '../src/call.ts'
import { GameSessionRegistry } from '../src/session-service.ts'
import type { EgoSessionHandle } from '../src/session-service.ts'

const exec = {
  agent: { session: { header: { cwd: '/ws' } } },
  signal: new AbortController().signal,
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

/** The first text block of a render result. */
function textOf(blocks: Array<{ type: string; text?: string }>): string {
  const block = blocks[0]
  if (block?.type !== 'text' || block.text === undefined) throw new Error('expected a text block')
  return block.text
}

describe('godot_call', () => {
  it('calls the method, reports its return value, and names what it called', async () => {
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload: { value: true, type: 'bool' } }))
    const tool = callTool(await registryWith(request))
    const value = await tool.execute({ path: 'Main/HUD/Start', method: 'show' }, exec as never)
    expect(request).toHaveBeenCalledWith('call', { path: 'Main/HUD/Start', method: 'show', args: [] }, exec.signal)
    expect(value.text).toBe('Main/HUD/Start.show() → true  (bool)')
    expect(textOf(tool.output.render({ path: 'Main/HUD/Start', method: 'show' }, value)))
      .toBe('Main/HUD/Start.show() → true  (bool)')
  })

  it('passes arguments in call order and renders void returns', async () => {
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload: { value: null, type: 'null' } }))
    const tool = callTool(await registryWith(request))
    const value = await tool.execute({ path: 'Main/Player', method: 'set_health', args: [42, 'heal'] }, exec as never)
    expect(request.mock.calls[0]?.[1]).toEqual({ path: 'Main/Player', method: 'set_health', args: [42, 'heal'] })
    expect(value.text).toBe('Main/Player.set_health(42, "heal") → no return value')
  })

  it('surfaces the bridge message when the node or the method is missing', async () => {
    const request = vi.fn(async () => ({
      kind: 'ok' as const,
      id: 1,
      payload: { error: 'REJECTED', message: 'no method hdie on Button; did you mean hide?' },
    }))
    const tool = callTool(await registryWith(request))
    await expect(tool.execute({ path: 'Main/Btn', method: 'hdie' }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED', message: 'no method hdie on Button; did you mean hide?' })
  })

  it('falls back to its own message when the bridge sends none', async () => {
    const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload: { error: 'NOT_FOUND' } }))
    const tool = callTool(await registryWith(request))
    await expect(tool.execute({ path: 'Main/Nope', method: 'show' }, exec as never)).rejects.toThrow(/could not call show/)
  })

  it('rejects a blank method name and a missing session', async () => {
    const tool = callTool(await registryWith(vi.fn()))
    await expect(tool.execute({ path: 'Main/Btn', method: '  ' }, exec as never)).rejects.toThrow(/non-empty/)
    const offline = callTool(new GameSessionRegistry(async () => ({
      sessionId: 's1',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })))
    await expect(offline.execute({ path: 'Main/Btn', method: 'show' }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
