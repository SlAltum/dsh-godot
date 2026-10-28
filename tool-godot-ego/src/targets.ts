/**
 * Rendering of the bridge's `state` payload: the bounded scene tree, the
 * clickable-Control list, and the changed-targets summary. Pure functions, so
 * the model-facing shape is testable without a game.
 *
 * Bridge shapes (see `bridge-source.ts`):
 * - tree node `{ name, class, id, scene, children? }`
 * - target `{ path, class, rect:[x,y,w,h], text, disabled?, filter? }`
 * - changed `{ appeared: Target[], disappeared: Target[], changed: Target[] }`
 * @module @deepseek-ai/dsh-tool-godot-ego/targets
 */

/** One clickable Control from the live scene. */
export interface TargetEntry {
  readonly path: string
  readonly className: string
  readonly rect: readonly [number, number, number, number]
  readonly text: string
  readonly disabled?: boolean
}

/** One node in the bounded scene tree. */
export interface SceneTreeNode {
  readonly name: string
  readonly className: string
  readonly id: string
  readonly scene: string
  readonly children: readonly SceneTreeNode[]
}

/** Node/target budgets for {@link renderState}. */
export interface StateRenderOptions {
  readonly maxNodes?: number
  readonly maxTargets?: number
  /** Targets to skip before rendering the page (for a listing that outgrew one reply). */
  readonly offset?: number
  /** Case-insensitive substrings a target must all contain. */
  readonly filter?: TargetFilter
}

/** Substring filters over the three fields a caller can recognize a Control by. */
export interface TargetFilter {
  /** Substring of the Control path. */
  readonly name?: string
  /** Substring of the Control class. */
  readonly className?: string
  /** Substring of the visible text. */
  readonly text?: string
}

/**
 * Keep the targets matching every given substring (case-insensitive; an empty
 * or absent filter keeps everything).
 * @param targets - parsed targets.
 * @param filter - the substrings to match.
 * @returns the matching targets, in input order.
 */
export function filterTargets(targets: readonly TargetEntry[], filter: TargetFilter): TargetEntry[] {
  const contains = (value: string, needle: string | undefined): boolean =>
    needle === undefined || needle === '' || value.toLowerCase().includes(needle.toLowerCase())
  return targets.filter(target =>
    contains(target.path, filter.name)
    && contains(target.className, filter.className)
    && contains(target.text, filter.text))
}

/**
 * Parse the bridge's target list, dropping malformed entries.
 * @param raw - the `targets` payload.
 * @returns the well-formed targets in bridge order.
 */
export function parseTargets(raw: unknown): TargetEntry[] {
  if (!Array.isArray(raw)) return []
  const out: TargetEntry[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || typeof record.class !== 'string') continue
    const rect: readonly [number, number, number, number] =
      Array.isArray(record.rect) && record.rect.length === 4 && record.rect.every(value => typeof value === 'number')
        ? record.rect as [number, number, number, number]
        : [0, 0, 0, 0]
    out.push({
      path: record.path,
      className: record.class,
      rect,
      text: typeof record.text === 'string' ? record.text : '',
      ...(typeof record.disabled === 'boolean' ? { disabled: record.disabled } : {}),
    })
  }
  return out
}

/**
 * Parse the bridge's tree payload.
 * @param raw - the `tree` payload.
 * @returns the tree, or `null` when the payload is not a node.
 */
export function parseTree(raw: unknown): SceneTreeNode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.name !== 'string') return null
  const children: SceneTreeNode[] = []
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      const parsed = parseTree(child)
      if (parsed !== null) children.push(parsed)
    }
  }
  return {
    name: record.name,
    className: typeof record.class === 'string' ? record.class : '',
    id: typeof record.id === 'string' ? record.id : typeof record.id === 'number' ? String(record.id) : '',
    scene: typeof record.scene === 'string' ? record.scene : '',
    children,
  }
}

/**
 * Render the tree as indented lines.
 * @param tree - the parsed tree (null renders nothing).
 * @param maxNodes - node budget; the first dropped node flags truncation.
 * @returns the lines and the truncation flag.
 */
export function renderTree(tree: SceneTreeNode | null, maxNodes = 200): { lines: string[]; truncated: boolean } {
  if (tree === null || maxNodes <= 0) return { lines: [], truncated: tree !== null }
  const lines: string[] = []
  let remaining = maxNodes
  let truncated = false

  const walk = (node: SceneTreeNode, depth: number): void => {
    remaining -= 1
    const file = node.scene === '' ? '' : ` ${node.scene}`
    lines.push(`${'  '.repeat(depth)}${node.name} [${node.className}] (${node.id})${file}`)
    for (const child of node.children) {
      if (remaining <= 0) {
        truncated = true
        break
      }
      walk(child, depth + 1)
    }
  }

  walk(tree, 0)
  return { lines, truncated }
}

/**
 * Render targets as one line each.
 * @param targets - parsed targets.
 * @param maxTargets - line budget.
 * @param offset - lines to skip, for paging a listing that outgrew one reply.
 * @returns the lines and the truncation flag.
 */
export function renderTargets(
  targets: readonly TargetEntry[],
  maxTargets = 60,
  offset = 0,
): { lines: string[]; truncated: boolean } {
  const start = Math.min(Math.max(offset, 0), targets.length)
  const kept = targets.slice(start, start + Math.max(maxTargets, 0))
  const lines = kept.map((target) => {
    const [x, y, width, height] = target.rect
    const disabled = target.disabled === true ? ' disabled' : ''
    return `  ${target.path} [${target.className}] rect=(${x},${y},${width},${height}) text="${target.text}"${disabled}`
  })
  return { lines, truncated: targets.length > start + kept.length }
}

/**
 * Render the changed-target summary (`+` appeared, `~` changed, `-` disappeared).
 * @param raw - the `changed` payload.
 * @returns one line per changed target.
 */
export function renderChanged(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  const record = raw as Record<string, unknown>
  const lines: string[] = []
  const push = (key: string, marker: string): void => {
    const entries = parseTargets(record[key])
    for (const entry of entries) lines.push(`${marker} ${entry.path}`)
  }
  push('appeared', '+')
  push('changed', '~')
  push('disappeared', '-')
  return lines
}

/**
/**
 * Render the bridge's `geometry` block as one line.
 * @param raw - the `geometry` payload (`canvas`, `window`, `screen`).
 * @returns the line, or `undefined` when the payload is absent or malformed.
 */
export function renderGeometry(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const pair = (value: unknown): [number, number] | undefined =>
    Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number')
      ? value as [number, number]
      : undefined
  const canvas = pair(record.canvas)
  const window = pair(record.window)
  const screen = Array.isArray(record.screen) && record.screen.length === 4 && record.screen.every(item => typeof item === 'number')
    ? record.screen as [number, number, number, number]
    : undefined
  if (canvas === undefined || window === undefined || screen === undefined) return undefined
  const [scaleX, scaleY, offsetX, offsetY] = screen
  const scale = scaleX === scaleY ? scaleX.toFixed(3) : `${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`
  // Stated on the header the model reads first: the points it passes are canvas
  // points, and the window may not share that size.
  return `geometry canvas ${String(canvas[0])} × ${String(canvas[1])}`
    + ` · window ${String(window[0])} × ${String(window[1])}`
    + ` · screen ${scale} ${offsetX >= 0 ? '+' : ''}${String(offsetX)},${String(offsetY)}`
    + ' (points and rects are canvas space)'
}

/**
 * Render the whole `state` reply into model-facing text.
 * @param state - the bridge reply payload.
 * @param options - node/target budgets.
 * @returns the rendered snapshot (header plus whichever sections exist).
 */
export function renderState(state: Readonly<Record<string, unknown>>, options: StateRenderOptions = {}): string {
  const scene = typeof state.scene === 'string' && state.scene !== '' ? state.scene : '(no scene)'
  const fps = typeof state.fps === 'number' ? state.fps : 0
  const frames = typeof state.frames === 'number' ? state.frames : 0
  const nodeCount = typeof state.nodeCount === 'number' ? state.nodeCount : 0
  const paused = state.paused === true ? ' · paused' : ''
  const lines = [`scene ${scene} · ${fps} fps · frame ${frames} · ${nodeCount} nodes${paused}`]
  const geometry = renderGeometry(state.geometry)
  if (geometry !== undefined) lines.push(geometry)

  if (state.tree !== undefined) {
    const tree = parseTree(state.tree)
    const rendered = renderTree(tree, options.maxNodes ?? 200)
    lines.push(`tree (${rendered.lines.length}${rendered.truncated ? '+' : ''}/${options.maxNodes ?? 200})`)
    lines.push(...rendered.lines)
  }
  if (state.targets !== undefined) {
    const all = parseTargets(state.targets)
    const matched = filterTargets(all, options.filter ?? {})
    const offset = options.offset ?? 0
    const rendered = renderTargets(matched, options.maxTargets ?? 60, offset)
    const total = matched.length === all.length
      ? String(matched.length)
      : `${String(matched.length)} of ${String(all.length)}`
    const page = rendered.lines.length === 0
      ? 'showing none'
      : `showing ${String(offset + 1)}-${String(offset + rendered.lines.length)}`
    // A truncated listing must say how to reach the rest: a scene with 122
    // Controls is ordinary, and paging by hand is the only way to find one.
    const hint = rendered.truncated ? '; filter by name/class/text or pass offset to reach the rest' : ''
    lines.push(`targets ${total} (${page})${hint}`)
    lines.push(...rendered.lines)
  }
  if (state.changed !== undefined) {
    const changed = renderChanged(state.changed)
    lines.push(changed.length === 0 ? 'changed: none' : `changed: ${changed.join(', ')}`)
  }
  return lines.join('\n')
}
