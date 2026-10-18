/**
 * `godot_node`: request shape, value rendering, and truncation.
 */

import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { GameSessionRegistry } from '../src/session-service.ts'
import { formatValue, nodeTool } from '../src/node.ts'

const exec = {
  agent: { session: { header: { cwd: '/ws' } } },
  signal: new AbortController().signal,
}

async function setup(payload: Record<string, unknown>, config = resolveConfig({})) {
  const request = vi.fn(async () => ({ kind: 'ok' as const, id: 1, payload }))
  const registry = new GameSessionRegistry(async () => ({
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request,
  }))
  await registry.ensure('/ws', {})
  return { tool: nodeTool(registry, config), request }
}

describe('formatValue', () => {
  it('renders every JSON shape compactly', () => {
    expect(formatValue('text')).toBe('"text"')
    expect(formatValue(null)).toBe('null')
    expect(formatValue(3)).toBe('3')
    expect(formatValue(true)).toBe('true')
    expect(formatValue(BigInt(1))).toBe('<bigint>')
    expect(formatValue([1, 'a'])).toBe('[1, "a"]')
    expect(formatValue({ x: 1, y: [2] })).toBe('{x: 1, y: [2]}')
  })
})

describe('nodeTool', () => {
  it('renders the header, rows, and the truncation note', async () => {
    const { tool } = await setup({
      class: 'CharacterBody2D',
      scene: 'res://player.tscn',
      total: 5,
      props: [
        { name: 'position', type: 'Vector2', value: [10, 20] },
        { name: 'label', type: 'String', value: 'hero' },
        { name: 'alive', type: 'bool', value: true },
      ],
    })
    const value = await tool.execute({ path: 'Main/Player' }, exec as never)
    expect(value.text).toContain('Main/Player [CharacterBody2D] res://player.tscn')
    expect(value.text).toContain('position = [10, 20]  (Vector2)')
    expect(value.text).toContain('2 more properties')
    const block = tool.output.render({}, value)[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.text).toBe(value.text)
  })

  it('passes the whitelist and budgets through', async () => {
    const { tool, request } = await setup({ props: [] }, resolveConfig({ maxProps: 25 }))
    await tool.execute({ path: 'Main/Player', props: ['health', 'pos*'], maxProps: 4, depth: 1 }, exec as never)
    expect(request).toHaveBeenCalledWith('node', { path: 'Main/Player', maxProps: 4, depth: 1, props: ['health', 'pos*'] }, exec.signal)
    await tool.execute({ path: 'Main/Player' }, exec as never)
    expect(request).toHaveBeenLastCalledWith('node', { path: 'Main/Player', maxProps: 25, depth: 2 }, exec.signal)
  })

  it('fills defaults for a sparse payload', async () => {
    const { tool } = await setup({})
    const value = await tool.execute({ path: 'Main' }, exec as never)
    expect(value.text).toBe('Main []')
  })

  it('renders a row with missing name and type fields', async () => {
    const { tool } = await setup({ props: [{ name: 1, value: null }] })
    const value = await tool.execute({ path: 'Main' }, exec as never)
    expect(value.text).toContain('  = null')
  })

  it('rejects a missing node', async () => {
    const { tool } = await setup({ error: 'NOT_FOUND' })
    await expect(tool.execute({ path: 'Main/Nope' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
  })

  it('requires a running session', async () => {
    const tool = nodeTool(new GameSessionRegistry(async () => ({
      sessionId: 's',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })), resolveConfig({}))
    await expect(tool.execute({ path: 'Main' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
