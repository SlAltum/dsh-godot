/**
 * The structured card view of one `godot_state` read.
 *
 * `godot_state` reads the game as it stands, so the view carries the live node
 * hierarchy and the read's facts: the card draws the tree, and per-node state
 * stays with `godot_node`. Mirrors `tool-godot-debug`'s view contract: JSON-safe,
 * byte-bounded, and a named cut.
 * @module @deepseek-ai/dsh-tool-godot-ego/state-view
 */

import { parseTargets, parseTree, type SceneTreeNode } from './targets.ts'

/** Byte budget of the serialized view. */
export const STATE_VIEW_MAX_BYTES = 256 * 1024

/** One node of the live tree, JSON-safe. */
/** A `type` (not an interface) so it satisfies JsonValue's index signature. */
export type StateViewNode = {
  name: string
  className: string
  id: string
  scene: string
  unique: boolean
  script: string
  children: StateViewNode[]
}

/** The card's projection of one read. */
/** A `type` for the same JsonValue assignability reason. */
export type StateView = {
  version: 1
  scene: string
  fps: number
  frame: number
  nodeCount: number
  paused: boolean
  nodes?: StateViewNode[]
  /** Control paths this read changed against the previous one; absent unless asked. */
  changed?: {
    appeared: string[]
    changed: string[]
    disappeared: string[]
  }
  /** The read hit the node budget, so the hierarchy is a slice of the scene. */
  treeTruncated: boolean
  viewTruncated?: boolean
  viewCut?: 'changed' | 'nodes'
}

/** Copy one parsed node into its JSON-safe view form. */
function toViewNode(node: SceneTreeNode): StateViewNode {
  return {
    name: node.name,
    className: node.className,
    id: node.id,
    scene: node.scene,
    unique: node.unique,
    script: node.script,
    children: node.children.map(toViewNode),
  }
}

/** One diff payload as path lists; undefined when the read carried none. */
function readChanged(raw: unknown): StateView["changed"] {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const paths = (key: string): string[] => parseTargets(record[key]).map(entry => entry.path)
  return { appeared: paths('appeared'), changed: paths('changed'), disappeared: paths('disappeared') }
}

/** Count one view subtree. */
function countNodes(node: StateViewNode): number {
  let total = 1
  for (const child of node.children) total += countNodes(child)
  return total
}

/**
 * Build the card view of one `state` reply.
 * @param state - the bridge's `state` payload.
 * @param maxNodes - the node budget the read asked for.
 * @returns the JSON-safe, byte-bounded view.
 */
export function buildStateView(state: Readonly<Record<string, unknown>>, maxNodes: number): StateView {
  const tree = parseTree(state.tree)
  const view: StateView = {
    version: 1,
    scene: typeof state.scene === 'string' ? state.scene : '',
    fps: typeof state.fps === 'number' ? state.fps : 0,
    frame: typeof state.frames === 'number' ? state.frames : 0,
    nodeCount: typeof state.nodeCount === 'number' ? state.nodeCount : 0,
    paused: state.paused === true,
    treeTruncated: false,
  }
  if (tree !== null) {
    const root = toViewNode(tree)
    view.nodes = [root]
    // The bridge enforces this same budget: a full list may have left nodes behind.
    view.treeTruncated = countNodes(root) >= maxNodes
  }
  const changed = readChanged(state.changed)
  if (changed !== undefined) view.changed = changed
  // The cut ladder: the diff is derived data, the tree is the read's slice, so the
  // diff pays first and the tree goes only when even it cannot fit.
  if (JSON.stringify(view).length > STATE_VIEW_MAX_BYTES) {
    delete view.changed
    view.viewCut = 'changed'
    view.viewTruncated = true
  }
  if (JSON.stringify(view).length > STATE_VIEW_MAX_BYTES) {
    delete view.nodes
    view.treeTruncated = true
    view.viewCut = 'nodes'
  }

  return view
}
