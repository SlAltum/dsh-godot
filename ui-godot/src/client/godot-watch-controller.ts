/** The Godot sandbox watch panel's poller and click forwarder. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Locale namespace owned by the watch panel. */
export const WATCH_NS = 'godot.watch'

/** Host endpoints served by `tool-godot-ego` when the plugin is mounted. */
const SESSIONS_PATH = '/api/godot/sessions'
const VIEW_PATH = '/api/godot/view'
const INPUT_PATH = '/api/godot/input'
const TREE_PATH = '/api/godot/tree'
const NODE_PATH = '/api/godot/node'

/** One session as the host reports it. */
export interface WatchSession {
  readonly sessionId: string
  readonly state: string
  readonly pid: number | null
  readonly window: readonly [number, number] | null
  readonly lostReason: string | null
}

/** One node of the running game's tree (the host's bounded projection). */
export interface WatchTreeNode {
  readonly name: string
  readonly className: string
  readonly id: string
  readonly scene: string
  /** `unique_name_in_owner`, drawn as the editor's `%`. */
  readonly unique: boolean
  /** The node's script path, drawn as the script glyph on the row. */
  readonly script: string
  readonly children: readonly WatchTreeNode[]
}

/** What the watch panel renders. */
export interface GodotWatchState {
  sessions: readonly WatchSession[]
  selected: string | undefined
  open: boolean
  error: boolean
  /** The selected session's node tree; null while there is nothing to show. */
  tree: readonly WatchTreeNode[] | null
  /** Why the tree is missing, when the host reported a reason. */
  treeError: string | null
  /** The row the user picked, as a node address. */
  selectedNode: string | undefined
  /** That node's properties; null while nothing is selected or it failed. */
  nodeDetail: WatchNodeDetail | null
}

/** One node's properties, as the detail pane shows them. */
export interface WatchNodeDetail {
  readonly path: string
  readonly className: string
  readonly scene: string
  readonly props: readonly { readonly name: string; readonly value: string; readonly type?: string }[]
  readonly total: number
  readonly error: string | null
}

/** What the watch panel's slot entry injects. */
export interface GodotWatchFace {
  hooks: {
    /** Panel snapshot bound by the renderer as useWatch. */
    watch: SnapshotStore<GodotWatchState>
  }
  /** Open or close the panel. */
  toggle(): void
  /** Close the panel. */
  close(): void
  /** Select the session shown in the panel. */
  select(sessionId: string): void
  /** Read one node's properties into the detail pane. */
  selectNode(path: string | undefined): void

  /** Forward a click in game coordinates. */
  click(x: number, y: number): void
}

/** The function-only interval seam (never a string handler). */
export type WatchInterval = (handler: () => void, timeout: number) => ReturnType<typeof setInterval>

/** The matching clear seam. */
export type WatchClearInterval = (timer: ReturnType<typeof setInterval>) => void

/** Controller options (tests pin the fetch and timer). */
export interface GodotWatchOptions {
  fetch?: typeof globalThis.fetch
  pollMs?: number
  setInterval?: WatchInterval
  clearInterval?: WatchClearInterval
}

/** Parse one node of the host's tree projection; a malformed node is dropped. */
function parseTreeNode(raw: unknown): WatchTreeNode | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.name !== 'string') return undefined
  return {
    unique: record.unique === true,
    script: typeof record.script === 'string' ? record.script : '',
    name: record.name,
    className: typeof record.className === 'string' ? record.className : '',
    id: typeof record.id === 'string' ? record.id : '',
    scene: typeof record.scene === 'string' ? record.scene : '',
    children: (Array.isArray(record.children) ? record.children : []).flatMap((child) => {
      const parsed = parseTreeNode(child)
      return parsed === undefined ? [] : [parsed]
    }),
  }
}

/** Read one session entry, or undefined when the projection is malformed. */
function parseSession(raw: unknown): WatchSession | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.sessionId !== 'string') return undefined
  const window = Array.isArray(record.window) && record.window.length === 2
    && typeof record.window[0] === 'number' && typeof record.window[1] === 'number'
    ? [record.window[0], record.window[1]] as const
    : null
  return {
    sessionId: record.sessionId,
    state: typeof record.state === 'string' ? record.state : 'unknown',
    pid: typeof record.pid === 'number' ? record.pid : null,
    window,
    lostReason: typeof record.lostReason === 'string' ? record.lostReason : null,
  }
}

/**
 * The MJPEG preview URL for one session.
 */
export function watchStreamUrl(sessionId: string): string {
  return `${VIEW_PATH}?session=${encodeURIComponent(sessionId)}`
}

/** Polls the session list and forwards panel clicks to the game. */
export class GodotWatchController {
  private readonly store: SnapshotStore<GodotWatchState>
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly pollMs: number
  private readonly setIntervalImpl: WatchInterval
  private readonly clearIntervalImpl: WatchClearInterval
  private timer: ReturnType<typeof setInterval> | undefined
  private refreshing = false

  /**
   * @param options - fetch and timer seams (production uses the browser's).
   */
  constructor(options: GodotWatchOptions = {}) {
    this.store = createSnapshotStore<GodotWatchState>({
      sessions: [], selected: undefined, open: false, error: false,
      tree: null, treeError: null, selectedNode: undefined, nodeDetail: null,
    })
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.pollMs = options.pollMs ?? 1500
    this.setIntervalImpl = options.setInterval ?? ((handler, timeout) => globalThis.setInterval(handler, timeout))
    this.clearIntervalImpl = options.clearInterval ?? ((timer) => { globalThis.clearInterval(timer) })
  }

  /**
   * Start polling; calling it twice keeps one timer.
   */
  start(): void {
    if (this.timer !== undefined) return
    void this.refresh()
    this.timer = this.setIntervalImpl(() => { void this.refresh() }, this.pollMs)
  }

  /** Stop polling and release the timer. */
  dispose(): void {
    if (this.timer === undefined) return
    this.clearIntervalImpl(this.timer)
    this.timer = undefined
  }

  /**
   * Read the session list and update the panel.
   * @returns nothing; failures set the panel's error flag.
   */
  async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const response = await this.fetchImpl(SESSIONS_PATH, { headers: { accept: 'application/json' } })
      // A 404 means this deployment did not mount tool-godot-ego: the ball stays
      // idle rather than reporting a broken endpoint.
      if (response.status === 404) {
        this.applySessions([])
        return
      }
      if (!response.ok) throw new Error(`sessions ${response.status}`)
      const body = await response.json() as { sessions?: unknown }
      const sessions = (Array.isArray(body.sessions) ? body.sessions : [])
        .flatMap((raw) => {
          const session = parseSession(raw)
          return session === undefined ? [] : [session]
        })
      this.applySessions(sessions)
      await this.refreshTree()
    } catch {
      this.store.update((draft) => { draft.error = true })
    } finally {
      this.refreshing = false
    }
  }

  /**
   * Read the selected session's node tree.
   *
   * Polled with the session list so the panel shows the live hierarchy; a lost
   * session or a host without the route leaves the tree empty rather than
   * reporting an error the user cannot act on.
   */
  private async refreshTree(): Promise<void> {
    const state = this.store.getSnapshot()
    // A closed panel shows no tree, so it asks for none.
    if (!state.open) {
      this.store.update((draft) => { draft.tree = null; draft.treeError = null })
      return
    }
    const session = state.sessions.find(item => item.sessionId === state.selected)
    if (session === undefined || session.state === 'lost') {
      this.store.update((draft) => { draft.tree = null; draft.treeError = null })
      return
    }
    try {
      const response = await this.fetchImpl(`${TREE_PATH}?session=${encodeURIComponent(session.sessionId)}`, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`tree ${response.status}`)
      const body = await response.json() as { ok?: unknown; nodes?: unknown; nodeCount?: unknown; error?: unknown }
      if (body.ok !== true) {
        const reason = typeof body.error === 'string' ? body.error : 'no-tree'
        this.store.update((draft) => { draft.tree = null; draft.treeError = reason })
        return
      }
      const nodes = (Array.isArray(body.nodes) ? body.nodes : []).flatMap((raw) => {
        const node = parseTreeNode(raw)
        return node === undefined ? [] : [node]
      })
      this.store.update((draft) => { draft.tree = nodes; draft.treeError = null })
    } catch {
      this.store.update((draft) => { draft.tree = null; draft.treeError = 'tree-unavailable' })
    }
  }

  /** Ask the game for one node's properties. */
  private async fetchNode(sessionId: string, path: string): Promise<void> {
    try {
      const response = await this.fetchImpl(
        `${NODE_PATH}?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
        { headers: { accept: 'application/json' } },
      )
      if (!response.ok) throw new Error(`node ${response.status}`)
      const body = await response.json() as {
        ok?: unknown
        className?: unknown
        scene?: unknown
        total?: unknown
        props?: unknown
        error?: unknown
      }
      if (body.ok !== true) {
        this.store.update((draft) => {
          draft.nodeDetail = {
            path,
            className: '',
            scene: '',
            props: [],
            total: 0,
            error: typeof body.error === 'string' ? body.error : 'node-unavailable',
          }
        })
        return
      }
      const props = (Array.isArray(body.props) ? body.props : []).flatMap((raw) => {
        if (typeof raw !== 'object' || raw === null) return []
        const record = raw as Record<string, unknown>
        if (typeof record.name !== 'string' || typeof record.value !== 'string') return []
        return [{
          name: record.name,
          value: record.value,
          ...(typeof record.type === 'string' ? { type: record.type } : {}),
        }]
      })
      this.store.update((draft) => {
        // A slow answer for a node the user already left must not win.
        if (draft.selectedNode !== path) return
        draft.nodeDetail = {
          path,
          className: typeof body.className === 'string' ? body.className : '',
          scene: typeof body.scene === 'string' ? body.scene : '',
          props,
          total: typeof body.total === 'number' ? body.total : props.length,
          error: null,
        }
      })
    } catch {
      this.store.update((draft) => {
        if (draft.selectedNode !== path) return
        draft.nodeDetail = { path, className: '', scene: '', props: [], total: 0, error: 'node-unavailable' }
      })
    }
  }

  /** Replace the session list, keeping or repairing the selection. */
  private applySessions(sessions: readonly WatchSession[]): void {
    this.store.update((draft) => {
      const previous = draft.selected
      draft.sessions = sessions
      draft.error = false
      if (draft.selected !== undefined && !sessions.some(session => session.sessionId === draft.selected)) {
        draft.selected = undefined
      }
      if (draft.selected === undefined) draft.selected = sessions[0]?.sessionId
      // A node selection belongs to the session it came from.
      if (draft.selected !== previous) {
        draft.selectedNode = undefined
        draft.nodeDetail = null
      }
    })
  }

  /** Open or close the panel. */
  toggle(): void {
    this.store.update((draft) => { draft.open = !draft.open })
    // Opening shows the tree immediately instead of waiting for the next tick.
    if (this.store.getSnapshot().open) void this.refresh()
  }

  /** Close the panel. */
  close(): void {
    this.store.update((draft) => { draft.open = false })
  }

  /**
   * Select one session.
   * @param sessionId - the session id to show.
   */
  select(sessionId: string): void {
    this.store.update((draft) => {
      if (draft.selected !== sessionId) {
        // A picked node belongs to the session it came from.
        draft.selectedNode = undefined
        draft.nodeDetail = null
      }
      draft.selected = sessionId
    })
    // The new session's tree should not wait for the next tick.
    void this.refreshTree()
  }

  /**
   * Forward one click in game coordinates.
   * @param x - viewport x in game pixels.
   * @param y - viewport y in game pixels.
   */
  click(x: number, y: number): void {
    const sessionId = this.store.getSnapshot().selected
    if (sessionId === undefined) return
    void (async () => {
      try {
        const response = await this.fetchImpl(INPUT_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sessionId, x, y }),
        })
        if (!response.ok) throw new Error(`input ${response.status}`)
      } catch {
        this.store.update((draft) => { draft.error = true })
      }
    })()
  }

  /**
   * Read one node's properties into the detail pane.
   * @param path - the node's address, as the tree shows it.
   */
  selectNode(path: string | undefined): void {
    const sessionId = this.store.getSnapshot().selected
    this.store.update((draft) => {
      draft.selectedNode = path
      if (path === undefined) draft.nodeDetail = null
    })
    if (path === undefined || sessionId === undefined) return
    void this.fetchNode(sessionId, path)
  }

  /**
   * Build the face the slot registration injects.
   * @returns the panel snapshot and its actions.
   */
  inject(): GodotWatchFace {
    return {
      hooks: { watch: this.store },
      toggle: () => { this.toggle() },
      close: () => { this.close() },
      select: (sessionId) => { this.select(sessionId) },
      selectNode: (path) => { this.selectNode(path) },
      click: (x, y) => { this.click(x, y) },
    }
  }
}
