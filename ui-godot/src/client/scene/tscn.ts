/**
 * A `.tscn` file, parsed into the node tree a reader wants to see.
 *
 * The format is a line-oriented text format: bracketed section headers
 * (`[gd_scene]`, `[ext_resource]`, `[sub_resource]`, `[node]`, `[connection]`)
 * followed by the section's own `key = value` lines. Godot writes a node's
 * parent as a path **relative to the root**, where `parent="."` means the root
 * itself; the first `[node]` without a `parent=` is the root.
 *
 * Parsing here is deliberately independent of the engine and of the host's
 * `godot_inspect`: a preview renders the file it was handed, and a malformed
 * file still opens (it renders what could be read).
 */

export interface SceneNode {
  /** Node name as the file declares it. */
  readonly name: string
  /** Engine class, or the inherited scene's class when the node is an instance. */
  readonly type: string
  /** Full node path from the root (`Main/BoardHits`). */
  readonly path: string
  /** Parent node path, or `null` for the root. */
  readonly parent: string | null
  /** 1-based line of the node's header. */
  readonly line: number
  /** The node's own property lines, starting with the header line. */
  readonly body: string
  /** `script = ExtResource(…)` resolved to its path, when the node has one. */
  readonly script?: string
  /** `instance = ExtResource(…)` resolved to the inherited scene's path. */
  readonly instance?: string
  /** Whether the node is unique in the scene (`unique_name_in_owner`). */
  readonly unique: boolean
  /** Child nodes, in file order. */
  readonly children: readonly SceneNode[]
}

export interface ExternalResource {
  readonly id: string
  readonly type: string
  readonly path: string
}

export interface ParsedScene {
  /** Root node name, or `''` for a file with no nodes. */
  readonly rootName: string
  /** Root node, or `undefined` for a file with no nodes. */
  readonly root: SceneNode | undefined
  /** Every node, depth-first from the root (round-trippable to source order). */
  readonly nodes: readonly SceneNode[]
  /** External resources, in file order. */
  readonly resources: readonly ExternalResource[]
}

const HEADER = /^\[(\w+)([^\]]*)\]/

/** `key="value"` / `key=123` / `key=ExtResource("x")` attributes of a header. */
function headerAttrs(rest: string): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const match of rest.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) {
    const value = (match[2] ?? match[3] ?? '').trim()
    attrs.set(match[1] as string, value)
  }
  return attrs
}

/** `ExtResource("script_1")` → `script_1`. */
function extResourceId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return /ExtResource\(\s*"([^"]+)"\s*\)/.exec(value)?.[1]
}

/** The node path a header's `parent=` names, given the root name. */
function parentPathOf(parent: string | undefined, root: string): string | null {
  if (parent === undefined || parent === '') return null
  if (parent === '.') return root
  // Every other value is already relative to the root.
  return `${root}/${parent}`
}

/**
 * Parse one `.tscn` file.
 */
export function parseTscn(text: string): ParsedScene {
  const lines = text.split(/\r?\n/)
  const resources: ExternalResource[] = []
  const byId = new Map<string, ExternalResource>()

  // Pass 1: resources, so a node header can resolve `instance=` and `script=`.
  for (const line of lines) {
    const header = HEADER.exec(line)
    if (header?.[1] !== 'ext_resource') continue
    const attrs = headerAttrs(header[2] ?? '')
    const resource: ExternalResource = {
      id: attrs.get('id') ?? '',
      type: attrs.get('type') ?? '',
      path: attrs.get('path') ?? '',
    }
    resources.push(resource)
    byId.set(resource.id, resource)
  }

  // Pass 2: node sections, each running to the next bracketed header.
  interface Draft {
    name: string
    type: string
    parentPath: string | null
    line: number
    body: string[]
    script?: string
    instance?: string
    unique: boolean
  }
  const drafts: Draft[] = []
  let current: Draft | undefined
  let rootName: string | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string
    const header = HEADER.exec(line)
    if (header !== null) {
      if (current !== undefined) drafts.push(current)
      current = undefined
      if (header[1] === 'node') {
        const attrs = headerAttrs(header[2] ?? '')
        const name = attrs.get('name') ?? ''
        const parent = attrs.get('parent')
        if (parent === undefined && rootName === undefined) rootName = name
        const instanceId = extResourceId(attrs.get('instance'))
        const scriptId = extResourceId(attrs.get('script'))
        current = {
          name,
          type: attrs.get('type') ?? '',
          parentPath: parentPathOf(parent, rootName ?? name),
          line: index + 1,
          body: [line],
          unique: false,
          ...(instanceId !== undefined && byId.get(instanceId) !== undefined
            ? { instance: (byId.get(instanceId) as ExternalResource).path }
            : {}),
          ...(scriptId !== undefined && byId.get(scriptId) !== undefined
            ? { script: (byId.get(scriptId) as ExternalResource).path }
            : {}),
        }
      }
      continue
    }
    if (current !== undefined) {
      current.body.push(line)
      if (/^\s*unique_name_in_owner\s*=\s*true/.test(line)) current.unique = true
      // A node's script is a property line, not a header attribute.
      const scriptLine = /^\s*script\s*=\s*ExtResource\(\s*"([^"]+)"\s*\)/.exec(line)
      if (scriptLine !== null) {
        const resource = byId.get(scriptLine[1] as string)
        if (resource !== undefined) current.script = resource.path
      }
    }
  }
  if (current !== undefined) drafts.push(current)

  const root = rootName === undefined ? '' : rootName
  if (root === '' && drafts.length === 0) return { rootName: '', root: undefined, nodes: [], resources }

  // Build the tree; a node whose parent is missing is kept under the root so a
  // hand-edited file still shows something.
  const nodes = new Map<string, { node: SceneNode, children: SceneNode[] }>()
  for (const draft of drafts) {
    const path = draft.parentPath === null ? draft.name : `${draft.parentPath}/${draft.name}`
    const children: SceneNode[] = []
    const node: SceneNode = {
      name: draft.name,
      type: draft.type,
      path,
      parent: draft.parentPath,
      line: draft.line,
      body: draft.body.join('\n').replace(/\n+$/, ''),
      unique: draft.unique,
      children,
      ...(draft.script !== undefined ? { script: draft.script } : {}),
      ...(draft.instance !== undefined ? { instance: draft.instance } : {}),
    }
    nodes.set(path, { node, children })
  }

  const rootEntry = nodes.get(root)
  // Attach every node to its parent; a node whose parent is missing (a
  // hand-edited file) hangs under the root, and orphans of a file with no root
  // stay at the top so nothing is dropped.
  const orphans: SceneNode[] = []
  for (const entry of nodes.values()) {
    if (entry === rootEntry) continue
    const parentEntry = entry.node.parent === null ? undefined : nodes.get(entry.node.parent)
    if (parentEntry !== undefined && parentEntry !== entry) parentEntry.children.push(entry.node)
    else if (rootEntry !== undefined) (rootEntry.children as SceneNode[]).push(entry.node)
    else orphans.push(entry.node)
  }

  const ordered: SceneNode[] = []
  const visit = (node: SceneNode): void => {
    ordered.push(node)
    for (const child of node.children) visit(child)
  }
  if (rootEntry !== undefined) visit(rootEntry.node)
  for (const orphan of orphans) visit(orphan)

  return { rootName: root, root: rootEntry?.node, nodes: ordered, resources }
}
