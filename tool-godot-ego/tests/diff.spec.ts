/**
 * `godot_diff`: the shotdiff request (defaults and overrides), the metric
 * projection, and the bridge rejection when no previous frame exists.
 */

import { describe, expect, it, vi } from 'vitest'
import { diffTool } from '../src/diff.ts'
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
  return { tool: diffTool(registry), calls }
}

function textOf(blocks: Array<{ type: string; text?: string }>): string {
  const block = blocks[0]
  if (block?.type !== 'text' || block.text === undefined) throw new Error('expected a text block')
  return block.text
}

describe('godot_diff', () => {
  it('requests luma metrics by default and renders them', async () => {
    const { tool, calls } = await setup(() => ({
      frame: 42,
      metrics: { max: 1, mean: 0.5, mean_squared: 0.25, root_mean_squared: 0.5, peak_snr: 32.5 },
    }))
    const value = await tool.execute({}, exec as never)
    expect(value).toEqual({ mean: 0.5, mean_squared: 0.25, peak_snr: 32.5, frame: 42 })
    expect(calls[0]).toEqual({ cmd: 'shotdiff', params: { useLuma: true } })
    expect(textOf(tool.output.render({}, value))).toBe('mean 0.5 · mse 0.25 · psnr 32.5 dB · frame 42')
  })

  it('honors useLuma false', async () => {
    const { tool, calls } = await setup(() => ({ frame: 1, metrics: { mean: 0 } }))
    await tool.execute({ useLuma: false }, exec as never)
    expect(calls[0]?.params).toEqual({ useLuma: false })
  })

  it('defaults missing metrics and frame to zero', async () => {
    const { tool } = await setup(() => ({ metrics: { mean: 'x' } }))
    await expect(tool.execute({}, exec as never)).resolves.toEqual({ mean: 0, mean_squared: 0, peak_snr: 0, frame: 0 })
    const noMetrics = await setup(() => ({}))
    await expect(noMetrics.tool.execute({}, exec as never)).resolves.toEqual({ mean: 0, mean_squared: 0, peak_snr: 0, frame: 0 })
    const nullMetrics = await setup(() => ({ metrics: null, frame: 3 }))
    await expect(nullMetrics.tool.execute({}, exec as never)).resolves.toEqual({ mean: 0, mean_squared: 0, peak_snr: 0, frame: 3 })
  })

  it('surfaces the no-previous-frame rejection and requires a session', async () => {
    const registry = new GameSessionRegistry(async () => ({
      sessionId: 's1',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => { throw new EgoGodotError('bridge rejected the command (REJECTED): no previous frame', 'GODOT_EGO_REJECTED') },
    }))
    await registry.ensure('/ws', {})
    await expect(diffTool(registry).execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(diffTool(new GameSessionRegistry(async () => ({
      sessionId: 's2',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    }))).execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
