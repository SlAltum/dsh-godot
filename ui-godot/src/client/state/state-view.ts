/**
 * The structured view `godot_state` carries, mirrored from the tool package that
 * produces it (`tool-godot-ego/src/state-view.ts`).
 *
 * Mirrored rather than imported: this half is a browser bundle whose externals
 * are the client module table, and the sandbox is a host package. Every field is
 * JSON on the wire; a missing or malformed view renders as "no view", and the
 * card falls back to the tool's text report.
 */

/** One node of the live tree. */
export interface StateViewNode {
  readonly name: string
  readonly className: string
  readonly id: string
  readonly scene: string
  readonly unique: boolean
  readonly script: string
  readonly children: readonly StateViewNode[]
}

/** The card's projection of one read. */
export interface StateView {
  readonly version: number
  readonly scene: string
  readonly fps: number
  readonly frame: number
  readonly nodeCount: number
  readonly paused: boolean
  readonly nodes?: readonly StateViewNode[]
  /** Control paths this read changed against the previous one; absent unless asked. */
  readonly changed?: {
    readonly appeared: readonly string[]
    readonly changed: readonly string[]
    readonly disappeared: readonly string[]
  }
  /** The read hit the node budget, so the hierarchy is a slice of the scene. */
  readonly treeTruncated?: boolean
  readonly viewTruncated?: boolean
  readonly viewCut?: 'changed' | 'nodes'
}

/** One diff list as paths (malformed entries dropped). */
function asPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((path): path is string => typeof path === 'string')
}

/** One node, or undefined when the wire shape is not a node. */
function asNode(value: unknown): StateViewNode | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const node = value as Record<string, unknown>
  if (typeof node.name !== 'string') return undefined
  return {
    name: node.name,
    className: typeof node.className === 'string' ? node.className : '',
    id: typeof node.id === 'string' ? node.id : '',
    scene: typeof node.scene === 'string' ? node.scene : '',
    unique: node.unique === true,
    script: typeof node.script === 'string' ? node.script : '',
    children: (Array.isArray(node.children) ? node.children : [])
      .flatMap(child => asNode(child) ?? []),
  }
}

/**
 * Whether a value can be treated as a state view.
 *
 * The view crosses the tool-result boundary as plain JSON, so the node list is
 * checked once here: a malformed node is dropped rather than thrown at render.
 * @param value - the persisted meta view.
 * @returns the view, or undefined when it is not one.
 */
export function asStateView(value: unknown): StateView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const view = value as Record<string, unknown>
  const nodes = Array.isArray(view.nodes) ? view.nodes.flatMap(node => asNode(node) ?? []) : undefined
  return {
    version: typeof view.version === 'number' ? view.version : 0,
    scene: typeof view.scene === 'string' ? view.scene : '',
    fps: typeof view.fps === 'number' ? view.fps : 0,
    frame: typeof view.frame === 'number' ? view.frame : 0,
    nodeCount: typeof view.nodeCount === 'number' ? view.nodeCount : 0,
    paused: view.paused === true,
    ...(nodes === undefined ? {} : { nodes }),
    ...(view.treeTruncated === true ? { treeTruncated: true } : {}),
    ...(view.viewTruncated === true ? { viewTruncated: true } : {}),
    ...(typeof view.changed === 'object' && view.changed !== null
      ? {
        changed: {
          appeared: asPaths((view.changed as Record<string, unknown>).appeared),
          changed: asPaths((view.changed as Record<string, unknown>).changed),
          disappeared: asPaths((view.changed as Record<string, unknown>).disappeared),
        },
      }
      : {}),
    ...(view.viewCut === 'nodes' || view.viewCut === 'changed' ? { viewCut: view.viewCut } : {}),
  }
}
