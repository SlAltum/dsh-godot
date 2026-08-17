/**
 * Phase 7 scene-tree tests: the pure parse/render functions, plus the
 * integration through the full runDebug pipeline against the T7.0 recording
 * (expansion + edits still run on the same stops — the fixture's request
 * order mirrors the product pipeline: snapshot → scene tree → inspect
 * responses).
 */

import { describe, expect, it } from 'vitest'
import { parseSceneTree, renderSceneTree, type SceneTreeNode } from '../src/scene-tree.ts'

/** The t7 main-scene tree params: root(Window) > Main > {Branch > Leaf中文
 *  > Sprite, Other > Child, Player}. */
function treeParams(): unknown[] {
  return [
    1, 'root', 'Window', 26323453389n, '', 0,
    3, 'Main', 'res://main.gd', 26994542042n, 'res://main.tscn', 0,
    1, 'Branch', 'Node', 27011319261n, '', 0,
    1, 'Leaf中文', 'Node2D', 27028096478n, '', 14,
    0, 'Sprite', 'Sprite2D', 27044873689n, '', 14,
    1, 'Other', 'Node', 27061650907n, '', 0,
    0, 'Child', 'Node', 27078428127n, '', 0,
    0, 'Player', 'Node', 27095205344n, '', 0,
  ]
}

/** The root-only tree reported at a break pause (T7.0 fact 6). */
function rootOnlyParams(): unknown[] {
  return [0, 'root', 'Window', 26323453389n, '', 0]
}

describe('parseSceneTree', () => {
  it('parses the flat recursive layout into a node tree', () => {
    const { root, truncated } = parseSceneTree(treeParams(), 200)
    expect(truncated).toBe(false)
    expect(root).not.toBeNull()
    const r = root!
    expect(r.name).toBe('root')
    expect(r.className).toBe('Window')
    expect(r.id).toBe(26323453389n)
    expect(r.sceneFilePath).toBe('')
    expect(r.children).toHaveLength(1)
    const main = r.children[0]!
    expect(main.name).toBe('Main')
    expect(main.className).toBe('res://main.gd') // script path, T7.0 fact 1
    expect(main.sceneFilePath).toBe('res://main.tscn')
    expect(main.children.map(c => c.name)).toEqual(['Branch', 'Other', 'Player'])
    const leaf = main.children[0]!.children[0]!
    expect(leaf.name).toBe('Leaf中文') // non-ASCII decodes intact (fact 10)
    expect(leaf.className).toBe('Node2D')
    expect(leaf.children[0]!.name).toBe('Sprite')
    expect(main.children[1]!.children[0]!.name).toBe('Child')
  })

  it('returns a root-only tree for a break pause payload', () => {
    const { root, truncated } = parseSceneTree(rootOnlyParams(), 200)
    expect(truncated).toBe(false)
    expect(root).not.toBeNull()
    expect(root!.children).toHaveLength(0)
  })

  it('handles non-array params and a zero budget defensively', () => {
    expect(parseSceneTree(undefined, 200)).toEqual({ root: null, truncated: true })
    expect(parseSceneTree('garbage', 200)).toEqual({ root: null, truncated: true })
    expect(parseSceneTree(treeParams(), 0)).toEqual({ root: null, truncated: false })
  })

  it('caps nodes at the budget and flags truncation', () => {
    const { root, truncated } = parseSceneTree(treeParams(), 3)
    expect(truncated).toBe(true)
    expect(root).not.toBeNull()
    // 3 nodes parsed: root, Main, Branch (Leaf 中文/Sprite/... dropped).
    const count = (n: SceneTreeNode | null): number => n === null ? 0 : 1 + n.children.reduce((acc, c) => acc + count(c), 0)
    expect(count(root)).toBe(3)
  })
})

describe('renderSceneTree', () => {
  const options = { maxNodes: 200, maxLineLength: 200 }

  it('renders indented node lines with class, id and scene file', () => {
    const { root } = parseSceneTree(treeParams(), 200)
    const { lines, truncated } = renderSceneTree(root, options)
    expect(truncated).toBe(false)
    expect(lines[0]).toBe('root [Window] (26323453389)')
    expect(lines[1]).toBe('  Main [res://main.gd] (26994542042) res://main.tscn')
    expect(lines[2]).toBe('    Branch [Node] (27011319261)')
    expect(lines[3]).toBe('      Leaf中文 [Node2D] (27028096478)')
    expect(lines[4]).toBe('        Sprite [Sprite2D] (27044873689)')
    expect(lines[5]).toBe('    Other [Node] (27061650907)')
    expect(lines[6]).toBe('      Child [Node] (27078428127)')
    expect(lines[7]).toBe('    Player [Node] (27095205344)')
  })

  it('renders a root-only tree as a single line', () => {
    const { root } = parseSceneTree(rootOnlyParams(), 200)
    const { lines, truncated } = renderSceneTree(root, options)
    expect(truncated).toBe(false)
    expect(lines).toEqual(['root [Window] (26323453389)'])
  })

  it('caps lines at maxNodes and flags truncation', () => {
    const { root } = parseSceneTree(treeParams(), 200)
    const { lines, truncated } = renderSceneTree(root, { ...options, maxNodes: 3 })
    expect(truncated).toBe(true)
    expect(lines).toHaveLength(3)
  })

  it('returns empty for a null root', () => {
    expect(renderSceneTree(null, options)).toEqual({ lines: [], truncated: false })
  })
})
