/**
 * The `godot_state` card view: the live tree as JSON, its own node budget, and
 * the byte budget that spends the tree last.
 */

import { describe, expect, it } from 'vitest'
import { buildStateView, STATE_VIEW_MAX_BYTES } from '../src/state-view.ts'
import { stateTool } from '../src/state.ts'

/** One nested bridge node (`class`, not `className`, on the wire). */
function node(name: string, id: string, children: unknown[] = []): Record<string, unknown> {
  return { name, class: 'Control', id, scene: '', unique: false, script: '', children }
}

/** A `state` payload with `count` nodes chained under one root. */
function payloadWith(count: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  let tree = node('leaf', String(count))
  for (let i = count - 1; i >= 0; i -= 1) tree = node(`n${i}`, String(i), [tree])
  return {
    scene: 'res://main.tscn',
    fps: 60,
    frames: 1234,
    nodeCount: count + 1,
    paused: false,
    tree,
    ...extra,
  }
}

describe('buildStateView', () => {
  it('projects the read facts and the live tree', () => {
    const view = buildStateView(payloadWith(2), 200)
    expect(view).toMatchObject({
      version: 1,
      scene: 'res://main.tscn',
      fps: 60,
      frame: 1234,
      nodeCount: 3,
      paused: false,
    })
    expect(view.nodes?.[0]?.name).toBe('n0')
    expect(view.nodes?.[0]?.children[0]?.children[0]?.name).toBe('leaf')
    expect(view.treeTruncated).toBe(false)
    expect(view.viewTruncated).toBeUndefined()
  })

  it('flags the tree when the read hit its node budget', () => {
    const view = buildStateView(payloadWith(4), 3)
    expect(view.treeTruncated).toBe(true)
  })

  it('carries no tree when the read asked for none', () => {
    const view = buildStateView({ scene: 'res://main.tscn', fps: 60, frames: 1, nodeCount: 9 }, 200)
    expect(view.nodes).toBeUndefined()
    expect(view.treeTruncated).toBe(false)
    expect(view.scene).toBe('res://main.tscn')
  })

  it('drops the tree rather than overflow the byte budget, and names that cut', () => {
    // Wide names make the tree outgrow the budget while the facts stay tiny.
    const many = Array.from({ length: 6000 }, (_, i) => node('N'.repeat(40) + String(i), String(i)))
    const view = buildStateView({ scene: 'res://main.tscn', fps: 60, frames: 1, nodeCount: 6001, tree: node('root', '0', many) }, 8000)
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(STATE_VIEW_MAX_BYTES)
    expect(view.nodes).toBeUndefined()
    expect(view.viewCut).toBe('nodes')
    expect(view.viewTruncated).toBe(true)
    expect(view.treeTruncated).toBe(true)
  })

  it('carries the diff as paths', () => {
    const entry = (path) => ({ path, class: 'Button', rect: [0, 0, 1, 1], text: '' })
    const view = buildStateView(payloadWith(2, { changed: { appeared: [entry('Main/A')], changed: [entry('Main/B')], disappeared: [entry('Main/C')] } }), 200)
    expect(view.changed).toEqual({ appeared: ['Main/A'], changed: ['Main/B'], disappeared: ['Main/C'] })
  })

  it('round-trips through JSON losslessly', () => {
    const view = buildStateView(payloadWith(2), 200)
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })
})

describe('stateTool presentationMeta', () => {
  it('hands the card the view the read built', () => {
    const tool = stateTool({} as never, {} as never) as {
      output?: { presentationMeta?: (args: unknown, value: unknown) => unknown }
    }
    const view = buildStateView(payloadWith(2), 200)
    const meta = tool.output?.presentationMeta?.({}, { snapshot: 'text', view })
    expect(meta).toEqual({ view })
  })
})
