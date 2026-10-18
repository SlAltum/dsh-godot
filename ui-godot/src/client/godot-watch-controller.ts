/** The Godot sandbox watch panel's poller and click forwarder. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Locale namespace owned by the watch panel. */
export const WATCH_NS = 'godot.watch'

/** Host endpoints served by `tool-godot-ego` when the plugin is mounted. */
const SESSIONS_PATH = '/api/godot/sessions'
const VIEW_PATH = '/api/godot/view'
const INPUT_PATH = '/api/godot/input'

/** One session as the host reports it. */
export interface WatchSession {
  readonly sessionId: string
  readonly state: string
  readonly pid: number | null
  readonly window: readonly [number, number] | null
  readonly lostReason: string | null
}

/** What the watch panel renders. */
export interface GodotWatchState {
  sessions: readonly WatchSession[]
  selected: string | undefined
  open: boolean
  error: boolean
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

/** Parse one session payload, dropping malformed entries. */
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
 * @param sessionId - the session to stream.
 * @returns the encoded viewer URL.
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
    this.store = createSnapshotStore<GodotWatchState>({ sessions: [], selected: undefined, open: false, error: false })
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
    } catch {
      this.store.update((draft) => { draft.error = true })
    } finally {
      this.refreshing = false
    }
  }

  /** Replace the session list, keeping or repairing the selection. */
  private applySessions(sessions: readonly WatchSession[]): void {
    this.store.update((draft) => {
      draft.sessions = sessions
      draft.error = false
      if (draft.selected !== undefined && !sessions.some(session => session.sessionId === draft.selected)) {
        draft.selected = undefined
      }
      if (draft.selected === undefined) draft.selected = sessions[0]?.sessionId
    })
  }

  /** Open or close the panel. */
  toggle(): void {
    this.store.update((draft) => { draft.open = !draft.open })
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
    this.store.update((draft) => { draft.selected = sessionId })
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
   * Build the face the slot registration injects.
   * @returns the panel snapshot and its actions.
   */
  inject(): GodotWatchFace {
    return {
      hooks: { watch: this.store },
      toggle: () => { this.toggle() },
      close: () => { this.close() },
      select: (sessionId) => { this.select(sessionId) },
      click: (x, y) => { this.click(x, y) },
    }
  }
}
