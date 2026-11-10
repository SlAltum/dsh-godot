/**
 * The structured card view a `godot_debug` result carries, mirrored from the
 * tool package that produces it (`tool-godot-debug/src/debug-view.ts`).
 *
 * Mirrored rather than imported: this half is a browser bundle whose externals
 * are the client module table, and the debugger is a host package. Every field
 * below is JSON on the wire; the renderer treats a missing or malformed view as
 * "no view" and falls back to the tool's text report.
 */

export interface DebugViewFrame {
  readonly file: string
  readonly line: number
  readonly func: string
}

export interface DebugSceneNode {
  readonly name: string
  readonly className: string
  readonly id: string
  readonly sceneFilePath: string
  readonly children: readonly DebugSceneNode[]
}

export interface DebugViewStop {
  readonly index: number
  readonly reason: string
  readonly isUserBreakpoint: boolean
  readonly threadId: number
  readonly frames: readonly DebugViewFrame[]
  /** Rendered locals/members/globals lines; present on the first stop only. */
  readonly varsLines?: readonly string[]
  readonly scopeTruncated?: { readonly locals: boolean; readonly members: boolean; readonly globals: boolean }
  /** The scene tree of this stop, as the tool persisted it. */
  readonly sceneTree?: { readonly nodes: readonly DebugSceneNode[]; readonly truncated?: boolean }
}

export interface DebugViewEntry {
  readonly name: string
  readonly id: string
  readonly className: string
  readonly repr?: string
  readonly rows: readonly { readonly name: string; readonly value: string }[]
  readonly children?: readonly DebugViewEntry[]
}

export interface DebugViewEdit {
  readonly target: string
  readonly property: string
  readonly requested: number | string | boolean
  readonly type: string
  readonly ok: boolean
  readonly detail?: string
}

export interface DebugView {
  readonly version: number
  readonly stopCount: number
  readonly maxStops: number
  readonly detached: boolean
  readonly stops: readonly DebugViewStop[]
  readonly expansion?: {
    readonly stopIndex: number
    readonly expandedObjects: number
    readonly truncated: boolean
    readonly entries: readonly DebugViewEntry[]
  }
  readonly edits?: {
    readonly stopIndex: number
    readonly truncated: boolean
    readonly results: readonly DebugViewEdit[]
  }
  readonly exit?: { readonly exitCode?: number; readonly signal?: string }
  readonly outputTail: readonly string[]
  readonly errors: readonly string[]
  readonly expandedObjects: number
  readonly expansionTruncated: boolean
  readonly editsApplied: number
  readonly editsTruncated: boolean
  readonly sceneTreeCount: number
  readonly sceneTreeTruncated: boolean
  readonly outputTruncated: boolean
  readonly varsTruncated: boolean
  readonly viewTruncated?: boolean
  /** The last byte-budget cut that landed; absent when the view fit as captured. */
  readonly viewCut?: 'expansionChildren' | 'expansion' | 'vars' | 'sceneTree'
}

/**
 * Whether a value can be treated as a card view.
 *
 * The view crosses the tool-result boundary as plain JSON, so every array the
 * renderer iterates is checked here once: a malformed entry is dropped rather
 * than allowed to throw during render (a crashing toolview entry is abdicated
 * for the rest of the session by the slot registry).
 */
export function asDebugView(value: unknown): DebugView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const view = value as Record<string, unknown>
  if (!Array.isArray(view.stops)) return undefined
  const stops = view.stops.filter((stop): stop is Record<string, unknown> =>
    typeof stop === 'object' && stop !== null && typeof (stop as { index?: unknown }).index === 'number')
    .map((stop) => {
      const { sceneTree, ...rest } = stop as Record<string, unknown>
      return {
        ...rest,
        frames: Array.isArray(rest.frames) ? rest.frames : [],
        varsLines: Array.isArray(rest.varsLines) ? rest.varsLines : undefined,
        ...(Array.isArray((sceneTree as { nodes?: unknown } | undefined)?.nodes) ? { sceneTree } : {}),
      }
    }) as unknown as DebugViewStop[]
  const expansion = isRecord(view.expansion) && Array.isArray((view.expansion as { entries?: unknown }).entries)
    ? view.expansion as NonNullable<DebugView['expansion']>
    : undefined
  const edits = isRecord(view.edits) && Array.isArray((view.edits as { results?: unknown }).results)
    ? view.edits as NonNullable<DebugView['edits']>
    : undefined
  // Drop the raw fields before spreading: a half-written one must not survive the
  // normalization just because the normalized copy is the shape we want.
  const { expansion: _rawExpansion, edits: _rawEdits, ...rest } = view
  return {
    ...rest as unknown as DebugView,
    stops,
    outputTail: Array.isArray(view.outputTail) ? view.outputTail as string[] : [],
    errors: Array.isArray(view.errors) ? view.errors as string[] : [],
    ...(expansion === undefined ? {} : { expansion }),
    ...(edits === undefined ? {} : { edits }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The rows of an expanded entry; an absent or malformed list is empty. */
export function entryRows(entry: DebugViewEntry): readonly { readonly name: string; readonly value: string }[] {
  return Array.isArray(entry.rows) ? entry.rows : []
}

/** The nested entries of an expanded object; an absent or malformed list is empty. */
export function entryChildren(entry: DebugViewEntry): readonly DebugViewEntry[] {
  return Array.isArray(entry.children) ? entry.children : []
}

/**
 * The fields of a settled tool call this card reads.
 *
 * Structural rather than the slot's owner type: the card needs the call's
 * arguments, its content blocks and its `meta`, and nothing else — a reader can
 * see the whole contract in one place.
 */
export interface DebugCallBlock {
  readonly kind?: string
  readonly isError?: boolean
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
  readonly meta?: unknown
  readonly call?: { readonly argsRaw?: string }
  readonly argsRaw?: string
}

/** Parse the call's arguments defensively; an unparsable argument bag is empty. */
export function callArgs(block: DebugCallBlock | undefined): Record<string, unknown> {
  const raw = block === undefined ? undefined : (block.call?.argsRaw ?? block.argsRaw)
  if (typeof raw !== 'string' || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/** The text a failed or view-less call rendered, joined. */
export function callText(block: DebugCallBlock | undefined): string {
  if (block === undefined) return ''
  // `content` crosses the wire as JSON: only an array of blocks is iterable.
  const blocks = Array.isArray(block.content) ? block.content : []
  const parts: string[] = []
  for (const item of blocks) {
    if (typeof item === 'object' && item !== null && item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
    }
  }
  return parts.join('\n')
}
