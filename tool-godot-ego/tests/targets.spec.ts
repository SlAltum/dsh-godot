/**
 * State/targets rendering: defensive parsing, budgets, and the model-facing
 * snapshot text.
 */

import { describe, expect, it } from 'vitest'
import { parseTargets, parseTree, renderChanged, renderState, renderTargets, renderTree } from '../src/targets.ts'

describe('parseTargets', () => {
  it('keeps well-formed entries and drops malformed ones', () => {
    const targets = parseTargets([
      { path: 'Main/Btn', class: 'Button', rect: [1, 2, 3, 4], text: 'Go', disabled: true },
      { path: 'Main/Label', class: 'Label', rect: [0, 0, 10, 10], text: '' },
      { path: 42 },
      null,
      'text',
      { path: 'Bad/Rect', class: 'Label', rect: [1, 2] },
    ])
    expect(targets).toHaveLength(3)
    expect(targets[0]).toMatchObject({ path: 'Main/Btn', disabled: true })
    expect(targets[2]?.rect).toEqual([0, 0, 0, 0])
    expect(parseTargets('nope')).toEqual([])
  })
})

describe('parseTree', () => {
  it('parses nested nodes and fills defaults', () => {
    const tree = parseTree({
      name: 'Main',
      class: 'Node2D',
      id: '7',
      scene: 'res://main.tscn',
      children: [{ name: 'Btn', class: 'Button', id: 9 }],
    })
    expect(tree).toMatchObject({ name: 'Main', className: 'Node2D', id: '7', scene: 'res://main.tscn' })
    expect(tree?.children[0]).toMatchObject({ name: 'Btn', className: 'Button', id: '9', scene: '', children: [] })
    expect(parseTree({ class: 'x' })).toBeNull()
    expect(parseTree('nope')).toBeNull()
  })

  it('fills defaults for a minimal node and drops invalid children', () => {
    const tree = parseTree({ name: 'Bare', children: [null, { name: 'Child' }] })
    expect(tree).toMatchObject({ name: 'Bare', className: '', id: '', scene: '' })
    expect(tree?.children).toHaveLength(1)
  })
})

describe('renderTree', () => {
  const tree = parseTree({
    name: 'Main',
    class: 'Node2D',
    id: '1',
    children: [
      { name: 'A', class: 'Button', id: '2' },
      { name: 'B', class: 'Label', id: '3', children: [{ name: 'C', class: 'Label', id: '4' }] },
    ],
  })

  it('renders indented lines with class, id, and scene', () => {
    const { lines, truncated } = renderTree(tree, 10)
    expect(lines[0]).toContain('Main [Node2D] (1)')
    expect(lines[1]).toBe('  A [Button] (2)')
    expect(lines[3]).toBe('    C [Label] (4)')
    expect(truncated).toBe(false)
  })

  it('stops at the budget and flags truncation', () => {
    const { lines, truncated } = renderTree(tree, 2)
    expect(lines).toHaveLength(2)
    expect(truncated).toBe(true)
  })

  it('renders nothing for a null tree or zero budget', () => {
    expect(renderTree(null, 10)).toEqual({ lines: [], truncated: false })
    expect(renderTree(tree, 0)).toEqual({ lines: [], truncated: true })
  })

  it('names the scene file when the node has one', () => {
    const withScene = parseTree({ name: 'Main', class: 'Node2D', id: '1', scene: 'res://main.tscn' })
    expect(renderTree(withScene, 5).lines[0]).toBe('Main [Node2D] (1) res://main.tscn')
  })
})

describe('renderTargets', () => {
  const targets = parseTargets([
    { path: 'Main/Btn', class: 'Button', rect: [1, 2, 3, 4], text: 'Go', disabled: true },
    { path: 'Main/Label', class: 'Label', rect: [0, 0, 1, 1], text: 'Hi' },
  ])

  it('formats rect, text, and disabled', () => {
    const { lines } = renderTargets(targets, 10)
    expect(lines[0]).toBe('  Main/Btn [Button] rect=(1,2,3,4) text="Go" disabled')
    expect(lines[1]).not.toContain('disabled')
  })

  it('flags truncation', () => {
    expect(renderTargets(targets, 1)).toMatchObject({ truncated: true })
    expect(renderTargets(targets, 0)).toEqual({ lines: [], truncated: true })
  })
})

describe('renderChanged', () => {
  it('marks appeared, changed, and disappeared', () => {
    const lines = renderChanged({
      appeared: [{ path: 'Main/A', class: 'Button', rect: [0, 0, 1, 1], text: '' }],
      changed: [{ path: 'Main/B', class: 'Button', rect: [0, 0, 1, 1], text: '' }],
      disappeared: [{ path: 'Main/C', class: 'Button', rect: [0, 0, 1, 1], text: '' }],
    })
    expect(lines).toEqual(['+ Main/A', '~ Main/B', '- Main/C'])
    expect(renderChanged(undefined)).toEqual([])
  })
})

describe('renderState', () => {
  it('renders the header and every present section', () => {
    const text = renderState({
      scene: 'res://main.tscn',
      fps: 60,
      frames: 128,
      nodeCount: 8,
      paused: true,
      tree: { name: 'Main', class: 'Node2D', id: '1' },
      targets: [{ path: 'Main/Btn', class: 'Button', rect: [0, 0, 1, 1], text: 'Go' }],
      changed: { appeared: [{ path: 'Main/Btn', class: 'Button', rect: [0, 0, 1, 1], text: 'Go' }] },
    }, { maxNodes: 5, maxTargets: 5 })
    expect(text).toContain('scene res://main.tscn · 60 fps · frame 128 · 8 nodes · paused')
    expect(text).toContain('tree (1/5)')
    expect(text).toContain('targets 1 (showing 1-1)')
    expect(text).toContain('changed: + Main/Btn')
  })

  it('states the canvas/window geometry so coordinates are never guessed', () => {
    const text = renderState({
      geometry: { canvas: [1440, 900], window: [1280, 720], screen: [0.8, 0.8, 64, 0] },
    })
    expect(text).toContain('geometry canvas 1440 × 900 · window 1280 × 720 · screen 0.800 +64,0')
    expect(text).toContain('points and rects are canvas space')
    // A missing or malformed geometry block renders no line instead of guessing.
    expect(renderState({})).not.toContain('geometry')
    expect(renderState({ geometry: { canvas: [1, 2] } })).not.toContain('geometry')
  })

  it('falls back to the empty header and omits absent sections', () => {
    const text = renderState({})
    expect(text).toBe('scene (no scene) · 0 fps · frame 0 · 0 nodes')
  })

  it('reports an empty change set', () => {
    expect(renderState({ changed: { appeared: [], changed: [], disappeared: [] } })).toContain('changed: none')
  })

  it('applies default budgets and reports target truncation', () => {
    const defaults = renderState({ tree: { name: 'Main' }, targets: [] })
    expect(defaults).toContain('tree (1/200)')
    expect(defaults).toContain('targets 0 (showing none)')
    const many = Array.from({ length: 3 }, (_, index) => ({
      path: `Main/T${index}`,
      class: 'Button',
      rect: [0, 0, 1, 1],
      text: '',
    }))
    const truncated = renderState({ targets: many }, { maxTargets: 1 })
    expect(truncated).toContain('targets 3 (showing 1-1); filter by name/class/text or pass offset')
    const treeTruncated = renderState({
      tree: { name: 'Main', children: [{ name: 'Child' }] },
    }, { maxNodes: 1 })
    expect(treeTruncated).toContain('tree (1+/1)')
  })
})
