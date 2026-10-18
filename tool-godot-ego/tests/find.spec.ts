/**
 * `godot_find`: target filtering by name, class, and text, the no-match
 * message, the line budget, and the session requirement.
 */

import { describe, expect, it, vi } from 'vitest'
import { EgoGodotError } from '../src/errors.ts'
import { findTool } from '../src/find.ts'
import { GameSessionRegistry } from '../src/session-service.ts'

const exec = {
  agent: { session: { header: { cwd: '/ws' } } },
  signal: new AbortController().signal,
}

const targets = [
  { path: 'Main/HUD/StartButton', class: 'Button', rect: [10, 20, 100, 40], text: 'Start' },
  { path: 'Main/HUD/QuitButton', class: 'Button', rect: [10, 80, 100, 40], text: 'Quit' },
  { path: 'Main/HUD/Title', class: 'Label', rect: [10, 0, 100, 20], text: 'Hello' },
]

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
  return { tool: findTool(registry), calls }
}

describe('godot_find', () => {
  it('filters by path substring, case-insensitively', async () => {
    const { tool, calls } = await setup(() => ({ targets }))
    const value = await tool.execute({ name: 'start' }, exec as never)
    expect(calls[0]).toEqual({ cmd: 'state', params: { tree: false, targets: true, diff: false } })
    expect(value.text).toContain('1 of 3 Controls match')
    expect(value.text).toContain('Main/HUD/StartButton [Button]')
    expect(value.text).not.toContain('QuitButton')
    expect(tool.output.render({ name: 'start' }, { text: 'rendered' })[0]).toMatchObject({ type: 'text' })
  })

  it('filters by class and text', async () => {
    const { tool } = await setup(() => ({ targets }))
    const byClass = await tool.execute({ class: 'button' }, exec as never)
    expect(byClass.text).toContain('2 of 3 Controls match')
    const byText = await tool.execute({ text: 'HELLO' }, exec as never)
    expect(byText.text).toContain('1 of 3 Controls match')
    expect(byText.text).toContain('Main/HUD/Title [Label]')
  })

  it('requires every provided filter to match', async () => {
    const { tool } = await setup(() => ({ targets }))
    const combined = await tool.execute({ name: 'Button', class: 'Label' }, exec as never)
    expect(combined.text).toContain('no Control matched name="Button", class="Label" (3 targets in the current scene)')
    const both = await tool.execute({ class: 'Button', text: 'quit' }, exec as never)
    expect(both.text).toContain('1 of 3 Controls match')
  })

  it('lists every target when no filter is given', async () => {
    const { tool } = await setup(() => ({ targets }))
    const value = await tool.execute({}, exec as never)
    expect(value.text).toContain('3 of 3 Controls match')
  })

  it('reports an empty target list without filter details', async () => {
    const { tool } = await setup(() => ({ targets: [] }))
    await expect(tool.execute({}, exec as never)).resolves.toEqual({
      text: 'no Control matched (0 targets in the current scene)',
    })
    await expect(tool.execute({ text: 'gone' }, exec as never)).resolves.toEqual({
      text: 'no Control matched text="gone" (0 targets in the current scene)',
    })
  })

  it('flags a truncated result set', async () => {
    const many = Array.from({ length: 61 }, (_, index) => ({
      path: `Main/R${index}`,
      class: 'Button',
      rect: [0, 0, 10, 10],
      text: '',
    }))
    const { tool } = await setup(() => ({ targets: many }))
    const value = await tool.execute({ class: 'Button' }, exec as never)
    expect(value.text).toContain('61 of 61 Controls match')
    expect(value.text).toContain('1 more matched (narrow the filters)')
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
    await expect(findTool(registry).execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(findTool(new GameSessionRegistry(async () => ({
      sessionId: 's2',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    }))).execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
