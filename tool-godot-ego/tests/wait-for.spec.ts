/**
 * `godot_wait_for`: polling a state field or a node property, the strict
 * comparison, the timeout report, and the session requirement.
 */

import { describe, expect, it, vi } from 'vitest'
import { EgoGodotError } from '../src/errors.ts'
import { waitForTool } from '../src/wait-for.ts'
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
  return { tool: waitForTool(registry), calls }
}

function textOf(blocks: Array<{ type: string; text?: string }>): string {
  const block = blocks[0]
  if (block?.type !== 'text' || block.text === undefined) throw new Error('expected a text block')
  return block.text
}

describe('godot_wait_for', () => {
  it('returns as soon as a state field matches', async () => {
    const { tool, calls } = await setup(() => ({ frames: 42 }))
    const value = await tool.execute({ property: 'frames', equals: 42 }, exec as never)
    expect(value).toMatchObject({ property: 'frames', value: 42 })
    expect(calls[0]).toEqual({ cmd: 'state', params: {} })
    expect(textOf(tool.output.render({ property: 'frames', equals: 42 }, value)))
      .toContain('state.frames = 42 after')
  })

  it('polls until a node property matches', async () => {
    let poll = 0
    const { tool, calls } = await setup(() => {
      poll += 1
      return { props: [{ name: 'text', type: 'String', value: poll < 3 ? 'waiting' : 'done' }] }
    })
    const value = await tool.execute({ path: 'Main/Label', property: 'text', equals: 'done', intervalMs: 1, timeoutMs: 2_000 }, exec as never)
    expect(value).toMatchObject({ property: 'text', value: 'done' })
    expect(poll).toBe(3)
    expect(calls[0]).toEqual({ cmd: 'node', params: { path: 'Main/Label', props: ['text'], maxProps: 1 } })
    expect(textOf(tool.output.render({ path: 'Main/Label', property: 'text', equals: 'done' }, value)))
      .toContain('Main/Label.text = "done" after')
  })

  it('keeps polling while the property is missing', async () => {
    let poll = 0
    const { tool } = await setup(() => {
      poll += 1
      if (poll === 1) return { props: [] }
      if (poll === 2) return {}
      return { props: [{ name: 'visible', value: true }] }
    })
    await expect(tool.execute({ path: 'Main/Node', property: 'visible', equals: true, intervalMs: 1 }, exec as never))
      .resolves.toMatchObject({ value: true })
  })

  it('reports a timeout with the last observed value', async () => {
    const { tool } = await setup(() => ({ frames: 7 }))
    await expect(tool.execute({ property: 'frames', equals: 99, timeoutMs: 2, intervalMs: 1 }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_TIMEOUT' })
    await expect(tool.execute({ property: 'frames', equals: 99, timeoutMs: 2, intervalMs: 1 }, exec as never))
      .rejects.toThrow(/last 7/)
  })

  it('propagates a missing node as a rejection', async () => {
    const { tool } = await setup(() => ({ error: 'NOT_FOUND', path: 'Nope' }))
    await expect(tool.execute({ path: 'Nope', property: 'x', equals: 1 }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
  })

  it('rejects invalid budgets', async () => {
    const { tool } = await setup(() => ({}))
    await expect(tool.execute({ property: 'frames', equals: 1, timeoutMs: 0 }, exec as never))
      .rejects.toThrow(/timeoutMs must be positive/)
    await expect(tool.execute({ property: 'frames', equals: 1, intervalMs: 0 }, exec as never))
      .rejects.toThrow(/intervalMs must be positive/)
  })

  it('waits for a node to appear and for it to disappear', async () => {
    let poll = 0
    const appearing = await setup(() => {
      poll += 1
      return poll < 3 ? { error: 'NOT_FOUND' } : { class: 'Button', props: [] }
    })
    const value = await appearing.tool.execute({ path: 'Main/Btn', exists: true, intervalMs: 1 }, exec as never)
    expect(value).toMatchObject({ property: 'exists', value: true })
    expect(appearing.calls[0]).toEqual({ cmd: 'node', params: { path: 'Main/Btn', maxProps: 0 } })
    expect(textOf(appearing.tool.output.render({ path: 'Main/Btn', exists: true }, value)))
      .toContain('Main/Btn exists after')

    const vanishing = await setup(() => ({ error: 'NOT_FOUND' }))
    const absent = await vanishing.tool.execute({ path: 'Main/Toast', exists: false }, exec as never)
    expect(absent).toMatchObject({ property: 'exists', value: false })
    expect(textOf(vanishing.tool.output.render({ path: 'Main/Toast', exists: false }, absent)))
      .toContain('Main/Toast is absent after')
  })

  it('reports an existence timeout', async () => {
    const { tool } = await setup(() => ({ error: 'NOT_FOUND' }))
    await expect(tool.execute({ path: 'Main/Toast', exists: true, timeoutMs: 2, intervalMs: 1 }, exec as never))
      .rejects.toThrow(/did not appear/)
    const present = await setup(() => ({}))
    await expect(present.tool.execute({ path: 'Main/Toast', exists: false, timeoutMs: 2, intervalMs: 1 }, exec as never))
      .rejects.toThrow(/did not disappear/)
  })

  it('validates the condition arguments', async () => {
    const { tool, calls } = await setup(() => ({}))
    await expect(tool.execute({ exists: true }, exec as never)).rejects.toThrow(/exists requires path/)
    await expect(tool.execute({ path: 'Main/Btn', exists: true, property: 'text' }, exec as never))
      .rejects.toThrow(/cannot be combined/)
    await expect(tool.execute({ path: 'Main/Btn' }, exec as never)).rejects.toThrow(/requires property and equals/)
    await expect(tool.execute({ path: 'Main/Btn', property: 'text' }, exec as never)).rejects.toThrow(/requires equals/)
    expect(calls).toHaveLength(0)
  })

  it('surfaces a bridge rejection and requires a running session', async () => {
    const registry = new GameSessionRegistry(async () => ({
      sessionId: 's1',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => { throw new EgoGodotError('bridge rejected the command (INTERNAL): state', 'GODOT_EGO_REJECTED') },
    }))
    await registry.ensure('/ws', {})
    await expect(waitForTool(registry).execute({ property: 'frames', equals: 1 }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(waitForTool(new GameSessionRegistry(async () => ({
      sessionId: 's2',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    }))).execute({ property: 'frames', equals: 1 }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
