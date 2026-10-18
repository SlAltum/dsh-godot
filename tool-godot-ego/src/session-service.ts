/**
 * The `godot.egoSessions` service: a workspace-keyed registry of running game
 * sessions. It is the provider half of the plan's composability contract —
 * every session it creates is an effect whose inverse (kill the process,
 * remove the temp scripts, close the listener) runs when the registry is
 * disposed, in reverse creation order, continuing past failures.
 *
 * The registry takes a {@link EgoSessionFactory} rather than building sessions
 * itself, so the lifetime rules are testable without a game process and the
 * process/DAP details stay in the session module.
 * @module @deepseek-ai/dsh-tool-godot-ego/session-service
 */

import { EgoGodotError } from './errors.ts'
import type { BridgeOk } from './protocol.ts'
import type { SessionSnapshot } from './session.ts'

/** One running session as the registry sees it (the process side lives behind `dispose`). */
export interface EgoSessionHandle {
  readonly sessionId: string
  readonly workspace: string
  readonly pid: number | null
  /** Whether a one-time import pass ran before the launch. */
  readonly imported?: boolean
  /** The resolved project root. */
  readonly projectRoot?: string
  /** Stop the session and release every resource it owns (idempotent). */
  dispose(): Promise<void>
  /** Send one bridge command and resolve its reply. */
  request(cmd: string, params?: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<BridgeOk>
  /** Graceful stop: quit, wait for the process, then dispose; reports its exit. */
  stop?(): Promise<{ exitCode: number | null; signal: string | null }>
  /** Immutable lifecycle view (state, pid, window, loss reason). */
  snapshot?(): SessionSnapshot
  /** Incremental captured output (stdout/stderr) since one shared byte offset. */
  logs?(since?: number, maxBytes?: number): { stdout: string; stderr: string; nextOffset: number }
}

/** The outcome of {@link GameSessionRegistry.stop}. */
export type EgoStopResult =
  | { readonly stopped: false }
  | {
    readonly stopped: true
    readonly sessionId: string
    readonly exitCode: number | null
    readonly signal: string | null
  }

/** Options for one `ensure` call. */
export interface EgoPlayOptions {
  /** Replace an existing session for the workspace instead of reusing it. */
  restart?: boolean
  /** Project root override; defaults to the workspace. */
  path?: string
  /** Scene to start instead of the project's main scene. */
  scene?: string
  /** Start the window off-screen. */
  offscreen?: boolean
  /** Frame-rate cap override. */
  maxFps?: number
  /** Deterministic pacing override. */
  fixedFps?: number
  /** Extra arguments forwarded to the game (after `--`). */
  args?: string[]
}

/** Creates one session; injected so lifetime rules are testable with a fake. */
export type EgoSessionFactory = (workspace: string, options: EgoPlayOptions) => Promise<EgoSessionHandle>

/** One `ensure` outcome; `created: false` means an existing session was reused. */
export interface EgoEnsureResult {
  readonly sessionId: string
  readonly pid: number | null
  readonly created: boolean
}

/** One disposal failure, collected instead of aborting the reverse-order sweep. */
export interface EgoDisposeFailure {
  readonly workspace: string
  readonly error: unknown
}

/**
 * Workspace-keyed session registry.
 *
 * Lifetime rules (plan §3.1/§3.4):
 * - one session per workspace (spatial unit), created once even under
 *   concurrent `ensure` calls;
 * - a failed creation leaves no registry entry;
 * - `disposeAll` runs the inverse of every session in reverse creation order,
 *   isolates failures, and is idempotent;
 * - after disposal, `ensure` rejects with `GODOT_EGO_REJECTED` and `get`
 *   returns `undefined`.
 */
export class GameSessionRegistry {
  private readonly sessions = new Map<string, EgoSessionHandle>()
  private readonly pending = new Map<string, Promise<EgoSessionHandle>>()
  private readonly failures: EgoDisposeFailure[] = []
  private closed = false

  /**
   * @param factory - creates a session for one workspace (the process side).
   */
  constructor(private readonly factory: EgoSessionFactory) {}

  /** Whether the registry has been disposed (the plugin fiber is gone). */
  get disposed(): boolean {
    return this.closed
  }

  /** Disposal failures collected so far, in sweep order. */
  get disposeFailures(): readonly EgoDisposeFailure[] {
    return this.failures
  }

  /**
   * The active session for a workspace, or `undefined`.
   * @param workspace - the workspace key.
   * @returns the session, or `undefined` when none is running.
   */
  get(workspace: string): EgoSessionHandle | undefined {
    return this.sessions.get(workspace)
  }

  /**
   * The active sessions in creation order.
   * @returns the live sessions.
   */
  list(): readonly EgoSessionHandle[] {
    return [...this.sessions.values()]
  }

  /**
   * Reuse or create the workspace's session.
   * @param workspace - the workspace key.
   * @param options - reuse/restart and start options.
   * @returns the session id and whether this call created it.
   * @throws EgoGodotError `GODOT_EGO_REJECTED` once the registry is disposed;
   *   factory failures propagate unchanged and leave no entry.
   */
  async ensure(workspace: string, options: EgoPlayOptions = {}): Promise<EgoEnsureResult> {
    this.assertOpen()
    const existing = this.sessions.get(workspace)
    if (existing !== undefined && options.restart !== true) return describeSession(existing, false)
    // `restart` always sweeps first: no stale entry may survive the replacement.
    if (options.restart === true) await this.disposeOne(workspace)
    const inFlight = this.pending.get(workspace)
    if (inFlight !== undefined) return describeSession(await inFlight, false)
    const creation = this.factory(workspace, options)
    this.pending.set(workspace, creation)
    try {
      const session = await creation
      // A dispose that raced the creation still wins: the session's inverse
      // must run, then the caller learns the service is gone.
      if (this.closed) {
        await this.disposeSession(workspace, session)
        this.assertOpen()
      }
      this.sessions.set(workspace, session)
      return describeSession(session, true)
    } finally {
      this.pending.delete(workspace)
    }
  }

  /**
   * Stop one workspace's session (graceful when the handle supports it).
   * @param workspace - the workspace key.
   * @returns `stopped: false` when no session was running; otherwise the id
   *   and the process exit facts.
   * @throws EgoGodotError `GODOT_EGO_REJECTED` once the registry is disposed.
   */
  async stop(workspace: string): Promise<EgoStopResult> {
    this.assertOpen()
    const session = this.sessions.get(workspace)
    if (session === undefined) return { stopped: false }
    this.sessions.delete(workspace)
    if (session.stop !== undefined) {
      const outcome = await session.stop()
      return { stopped: true, sessionId: session.sessionId, ...outcome }
    }
    await this.disposeSession(workspace, session)
    return { stopped: true, sessionId: session.sessionId, exitCode: null, signal: null }
  }

  /**
   * Dispose every session in reverse creation order. Idempotent; each failure
   * is collected in {@link disposeFailures} and the sweep continues.
   */
  async disposeAll(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const entries = [...this.sessions.entries()].reverse()
    this.sessions.clear()
    for (const [workspace, session] of entries) {
      await this.disposeSession(workspace, session)
    }
  }

  /** Dispose one workspace's session; `false` when none existed. */
  private async disposeOne(workspace: string): Promise<boolean> {
    const session = this.sessions.get(workspace)
    if (session === undefined) return false
    this.sessions.delete(workspace)
    await this.disposeSession(workspace, session)
    return true
  }

  /** Run one session's inverse, recording (not rethrowing) a failure. */
  private async disposeSession(workspace: string, session: EgoSessionHandle): Promise<void> {
    try {
      await session.dispose()
    } catch (error: unknown) {
      this.failures.push({ workspace, error })
    }
  }

  /** Reject use after disposal with a stable code. */
  private assertOpen(): void {
    if (this.closed) {
      throw new EgoGodotError(
        'the ego-godot session service is disposed; mount the plugin again before starting a session',
        'GODOT_EGO_REJECTED',
      )
    }
  }
}

/** Project one session to the ensure result shape. */
function describeSession(session: EgoSessionHandle, created: boolean): EgoEnsureResult {
  return { sessionId: session.sessionId, pid: session.pid, created }
}
