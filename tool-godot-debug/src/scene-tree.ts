/**
 * The bounded scene-tree snapshot: parses the `scene:scene_tree` response's
 * flat recursive array into a node tree and renders it into model-facing
 * lines. Protocol facts pinned in `.context/t7/facts.md`: params are
 * `[childCount, name, className, id, sceneFilePath, viewFlags, ...children
 * recursive]`; ids are non-negative INT64 bigints in the SAME id space as
 * `scene:inspect_object` (tree node ids can be inspected); className is the
 * engine class for engine nodes and the script path (`res://main.gd`) for
 * script nodes; viewFlags (0/14) carry no display meaning and are dropped; a
 * `break` pause reports a root-only tree (`childCount 0`) — that is normal.
 * @module @deepseek-ai/dsh-tool-godot-debug/scene-tree
 */

/** One parsed scene node (bounded, leaf fields only). */
export interface SceneTreeNode {
  name: string
  className: string
  /** The node's object id (same space as scene:inspect_object). */
  id: bigint
  /** The scene file the node came from; '' for runtime-created nodes. */
  sceneFilePath: string
  children: SceneTreeNode[]
}

/** The parse result: the tree root and whether any bound was hit. */
export interface SceneTreeParse {
  root: SceneTreeNode | null
  /** True when the node budget was exhausted or the params were malformed. */
  truncated: boolean
}

/** The render bounds for one tree. */
export interface SceneTreeRenderOptions {
  /** Max nodes rendered (0 = none); deeper/extra nodes are dropped and flagged. */
  maxNodes: number
  /** Max characters of one node line; longer values get an ellipsis. */
  maxLineLength: number
}

/**
 * Parse the flat recursive `scene:scene_tree` params into a node tree.
 * Layout per T7.0 fact 1: each node is `[childCount, name, className, id,
 * sceneFilePath, viewFlags, ...children]` with the children interleaved
 * depth-first. Defensive: a non-array/malformed node stops the parse and
 * flags truncation (the engine is trusted on the happy path — real payloads
 * are well-formed, T7.0 facts 1/10).
 * @param params - the response's params array.
 * @param maxNodes - the node budget (0 = no nodes parsed).
 * @returns the parsed root (null when params are not an array) and the flags.
 */
export function parseSceneTree(params: unknown, maxNodes: number): SceneTreeParse {
  if (!Array.isArray(params) || maxNodes <= 0) {
    return { root: null, truncated: !Array.isArray(params) && maxNodes > 0 }
  }
  const parsed = parseNode(params, 0, maxNodes)
  return { root: parsed.node, truncated: parsed.truncated }

  /** Parse one node starting at `offset`; returns the node, the next offset,
   *  and the remaining node budget (threaded through the recursion). */
  function parseNode(
    arr: unknown[],
    offset: number,
    budget: number,
  ): { node: SceneTreeNode | null; next: number; truncated: boolean; budget: number } {
    if (budget <= 0) return { node: null, next: offset, truncated: true, budget }
    const countRaw = arr[offset]
    const childCount = typeof countRaw === 'number' ? countRaw : 0
    const nameRaw = arr[offset + 1]
    const name = typeof nameRaw === 'string' ? nameRaw : ''
    const classRaw = arr[offset + 2]
    const className = typeof classRaw === 'string' ? classRaw : ''
    const idRaw = arr[offset + 3]
    const id = typeof idRaw === 'bigint' ? idRaw : typeof idRaw === 'number' ? BigInt(idRaw) : 0n
    const fileRaw = arr[offset + 4]
    const sceneFilePath = typeof fileRaw === 'string' ? fileRaw : ''
    // arr[offset + 5] = viewFlags (dropped, T7.0 fact 1)
    let next = offset + 6
    let remaining = budget - 1
    let truncated = false
    const children: SceneTreeNode[] = []
    for (let i = 0; i < childCount; i++) {
      const child = parseNode(arr, next, remaining)
      remaining = child.budget
      if (child.node !== null) children.push(child.node)
      if (child.truncated) truncated = true
      next = child.next
      if (remaining <= 0) break
    }
    return { node: { name, className, id, sceneFilePath, children }, next, truncated, budget: remaining }
  }
}

/**
 * Render one parsed tree into indented model-facing lines. The root node is
 * rendered like any other (it is the engine's `Window` root — its id is
 * usable for future inspect linkage, T7.0 fact 8); a root-only tree (break
 * pause, T7.0 fact 6) renders a single line. `maxNodes` bounds the lines; the
 * first dropped node flags the result.
 * @param root - the parsed tree root (null → empty render).
 * @param options - the render bounds.
 * @returns the lines and whether anything was dropped.
 */
export function renderSceneTree(root: SceneTreeNode | null, options: SceneTreeRenderOptions): { lines: string[]; truncated: boolean } {
  if (root === null || options.maxNodes <= 0) return { lines: [], truncated: root !== null }
  const lines: string[] = []
  let remaining = options.maxNodes
  let truncated = false
  renderNode(root, 0)
  return { lines, truncated }

  function renderNode(node: SceneTreeNode, depth: number): void {
    if (remaining <= 0) {
      truncated = true
      return
    }
    remaining--
    const file = node.sceneFilePath !== '' ? ` ${node.sceneFilePath}` : ''
    let line = `${'  '.repeat(depth)}${node.name} [${node.className}] (${node.id})${file}`
    if (line.length > options.maxLineLength) line = `${line.slice(0, options.maxLineLength)}…`
    lines.push(line)
    for (const child of node.children) {
      if (remaining <= 0) {
        truncated = true
        break
      }
      renderNode(child, depth + 1)
    }
  }
}
