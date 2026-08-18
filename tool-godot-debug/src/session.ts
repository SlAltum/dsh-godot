/**
 * The interactive debug session (T21): one long-lived attach session over a
 * `DebugController` with a command queue and a pollable versioned snapshot.
 * The session lives in the STATIC package and is exposed to the dynamic
 * plugin's host half through `ctx.provide('godot.debugSession', ...)` —
 * `harness.handle` RPC belongs to dynamic plugins only (adversarial review
 * H1), so the session itself never touches RPC.
 *
 * Design facts (plan v2, adversarial review absorbed):
 * - One session per host process (a game dials exactly one debugger, T11.0);
 *   the manager keeps a single active session.
 * - State machine: `connecting → ready(running|paused) → detached`; a game
 *   disconnect (socket close rejects all waiters) moves to `detached` with
 *   reason `disconnect`.
 * - The pause loop waits for `debug_enter` (`waitForStop`), builds the pause
 *   snapshot ONCE (rendered through `structuredDebugView`, versioned so the
 *   client never recomputes), then waits for the next stop — never
 *   auto-continues.
 * - Commands: send-only (break/continue/step/next/breakpoint — no reply,
 *   T6.0) complete immediately; snapshot building occupies the session
 *   (`busy`), so a command issued mid-snapshot is rejected with
 *   `session-busy` instead of interleaving with the protocol waiters
 *   (MEDIUM-2). Edits reuse `applyEdits` on the last paused vars.
 * - Idle = commands only (polls never count); the idle timer detaches with
 *   reason `timeout` after clearing nothing (the queue is empty by
 *   construction — commands run synchronously) and running the T4 teardown.
 * - Teardown (T4.0): best-effort breakpoint removal + continue + dispose,
 *   then abort the pause loop; detached state is idempotent.
 *
 * Single-step protocol facts (source plugin): `continue`, `next` (step
 * over), `step` (step into); step-out is `next` plus a client-side flag in
 * the source plugin — v1 exposes continue/step/next only.
 *
 * @module @deepseek-ai/dsh-tool-godot-debug/session
 */

import { DebugController, type StopInfo } from './controller.ts'
import { structuredDebugView, type DebugView, type StructuredDebugInput } from './debug-view.ts'
import { applyEdits, type EditRequest, type EditResult } from './edit.ts'
import { renderSnapshot } from './snapshot.ts'
import { parseSceneTree, renderSceneTree } from './scene-tree.ts'
import { GodotError } from './error.ts'
import { RENDER_OPTIONS, toResPath, type DebugBreakpoint, type DebugStop } from './tool.ts'
import type { DecodedVariant } from './variant-decoder.ts'

/** One stop's variable data kept for the edits command (T6 reuse). */
type PausedVars = DecodedVariant[][]

/** The session's externally visible state. */
export type SessionState = 'connecting' | 'running' | 'paused' | 'detached'

/** Why a session detached. */
export type DetachReason = 'stop' | 'timeout' | 'disconnect' | 'error'

/** The controller/retention caps the session is created with. */
export interface SessionBounds {
  maxMessageBytes: number
  maxOutputBytes: number
  maxTreeNodes: number
}

/** The pause snapshot budget (parity with the T20 card view). */
const SNAPSHOT_TIMEOUT_MS = 10_000

/** One scene-tree request budget while paused. */
const TREE_TIMEOUT_MS = 10_000

/** Idle check cadence (overridable in tests). */
const IDLE_CHECK_MS = 30_000

/** One stop-wait budget: the pause loop waits until the game pauses, the
 *  session detaches, or the idle timer fires — never times out on its own.
 *  Must stay below 2^31-1 ms (setTimeout's 32-bit limit — a larger value
 *  silently becomes a 1 ms timer and misreads as a disconnect). */
const WAIT_STOP_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** Output/error tails kept in one poll (parity with the text report). */
const OUTPUT_TAIL_MAX = 20
const ERRORS_MAX = 5

/** The pollable snapshot: version-bumped on every state change, so the
 *  client re-renders only when the version moves (no since-cursor — multiple
 *  consumers cannot eat each other's events, review H4). */
export interface SessionSnapshot {
  sessionId: string
  version: number
  state: SessionState
  port: number
  /** Present once detached: why. */
  reason?: DetachReason
  /** Surface detail for infrastructure failures (e.g. EADDRINUSE). */
  errorDetail?: string
  /** Present while paused: the stop's structured card view (T20). */
  pause?: DebugView
  breakpoints: DebugBreakpoint[]
  outputTail: string[]
  errors: string[]
  outputTruncated: boolean
}

/** One session command. */
export type SessionCommandRequest =
  | { kind: 'pause' }
  | { kind: 'continue' }
  | { kind: 'step' }
  | { kind: 'next' }
  | { kind: 'breakpoint'; file: string; line: number; enabled: boolean }
  | { kind: 'edits'; edits: EditRequest[] }

/** One command's outcome. */
export type SessionCommandResult =
  | { ok: true; edits?: { results: EditResult[]; truncated: boolean } }
  | { ok: false; error: 'session-detached' | 'session-busy' | 'not-paused' | 'parse' | 'unavailable'; detail?: string }

/** One interactive session. */
export class DebugSession {
  private readonly controller: DebugController
  private readonly abort = new AbortController()
  private stateValue: SessionState = 'connecting'
  private versionValue = 1
  private reasonValue: DetachReason | undefined
  private errorDetailValue: string | undefined
  private busyValue = false
  private pauseViewValue: DebugView | undefined
  private breakpointsValue: DebugBreakpoint[] = []
  private lastPausedVars: PausedVars | undefined
  private idleTimer: NodeJS.Timeout | undefined
  private detachedValue = false
  private connectStarted = false
  private lastCommandAt = Date.now()

  /**
   * @param sessionId - the caller-assigned id (the service owns the id space).
   * @param port - the attach port (1-65535; validated by the service).
   * @param projectRoot - the project root for `res://` breakpoint conversion.
   * @param bounds - controller/retention caps from the resolved config.
   * @param idleTimeoutMs - inactivity (commands only) before a timeout detach.
   * @param connectWaitMs - the session-level connection window.
   * @param idleCheckIntervalMs - idle-timer cadence (tests use a short one).
   */
  constructor(
    readonly sessionId: string,
    readonly port: number,
    private readonly projectRoot: string,
    bounds: SessionBounds,
    private readonly idleTimeoutMs: number,
    private readonly connectWaitMs: number,
    idleCheckIntervalMs = IDLE_CHECK_MS,
  ) {
    this.controller = new DebugController({
      maxMessageBytes: bounds.maxMessageBytes,
      maxOutputBytes: bounds.maxOutputBytes,
    })
    this.maxTreeNodesValue = bounds.maxTreeNodes
    this.idleTimer = setInterval(() => { this.checkIdle() }, idleCheckIntervalMs)
  }

  get state(): SessionState {
    return this.stateValue
  }

  get detached(): boolean {
    return this.detachedValue
  }

  /** Bind and wait for the game (background). The connection window is
   *  session-level (review H6): the tool call returns immediately, the idle
   *  timer is the ultimate bound. */
  async connect(): Promise<void> {
    if (this.connectStarted) return
    this.connectStarted = true
    try {
      await this.controller.listen(this.port)
      await this.controller.waitForSetPid(this.connectWaitMs, this.abort.signal)
      if (this.detachedValue) return
      this.stateValue = 'running'
      this.versionValue++
      void this.loop()
    } catch (error) {
      if (error instanceof GodotError && error.code === 'GODOT_ABORTED') return // detached by caller
      this.errorDetailValue = error instanceof Error ? error.message : String(error)
      this.detach('error')
    }
  }

  /** The pause loop: wait for a stop, snapshot it, wait again. Never
   *  auto-continues — the next command decides. */
  private async loop(): Promise<void> {
    for (;;) {
      let stop: StopInfo
      try {
        stop = await this.controller.waitForStop(WAIT_STOP_TIMEOUT_MS, this.abort.signal)
      } catch (error) {
        if (error instanceof GodotError && error.code === 'GODOT_ABORTED') {
          this.detach(this.reasonValue ?? 'stop')
        } else {
          this.detach('disconnect')
        }
        return
      }
      await this.buildPause(stop)
      if (this.detachedValue) return
    }
  }

  /** Snapshot one pause: stack + vars + (optional) scene tree, rendered
   *  through the T20 view (expansion/edits carriers stay empty — object
   *  inspection and edits are v1 model commands). */
  private async buildPause(stop: StopInfo): Promise<void> {
    this.busyValue = true
    try {
      this.controller.send('get_stack_dump')
      this.controller.send('get_stack_frame_vars', [0])
      const collected = await this.controller.waitForSnapshot(SNAPSHOT_TIMEOUT_MS, this.abort.signal)
      this.lastPausedVars = collected.vars
      const snapshot = renderSnapshot(collected.dump, collected.vars, RENDER_OPTIONS)
      const debugStop: DebugStop = { ...stop, snapshot }
      const input: StructuredDebugInput = {
        stops: [debugStop],
        output: [...this.controller.output],
        errors: [...this.controller.errors],
        detached: false,
        expandedObjects: 0,
        expansionTruncated: false,
        editsApplied: 0,
        editsTruncated: false,
        sceneTreeCount: 0,
        sceneTreeTruncated: false,
        outputTruncated: this.controller.outputTruncated,
        varsTruncated: false,
      }
      if (snapshot.frames.length > 0) {
        try {
          this.controller.send('scene:request_scene_tree')
          const resp = await this.controller.waitForMessage(
            m => m[0] === 'scene:scene_tree',
            TREE_TIMEOUT_MS,
            this.abort.signal,
            'scene:scene_tree',
          )
          const parsed = parseSceneTree(Array.isArray(resp[2]) ? resp[2] : undefined, this.boundsMaxTreeNodes())
          if (parsed.root !== null) {
            const { lines, truncated } = renderSceneTree(parsed.root, { maxNodes: this.boundsMaxTreeNodes(), maxLineLength: 200 })
            input.sceneTrees = [{ stopIndex: 0, lines }]
            input.sceneTreeCount = 1
            if (truncated || parsed.truncated) input.sceneTreeTruncated = true
          } else if (parsed.truncated) {
            input.sceneTreeTruncated = true
          }
        } catch (error) {
          if (error instanceof GodotError && error.code === 'GODOT_ABORTED') throw error
          input.sceneTreeTruncated = true // tree failure never blocks the pause
        }
      }
      this.pauseViewValue = structuredDebugView(input, 1)
      this.stateValue = 'paused'
      this.versionValue++
    } catch (error) {
      if (error instanceof GodotError && error.code === 'GODOT_ABORTED') throw error
      if (error instanceof GodotError && error.code === 'GODOT_UNAVAILABLE') {
        this.detach('disconnect')
        return
      }
      // Snapshot timeout / malformed data: still pause, with an empty
      // snapshot marked truncated (parity with the one-shot run).
      this.pauseViewValue = structuredDebugView({
        stops: [{ ...stop, snapshot: renderSnapshot([0], [], RENDER_OPTIONS) }],
        output: [...this.controller.output],
        errors: [...this.controller.errors],
        detached: false,
        expandedObjects: 0,
        expansionTruncated: false,
        editsApplied: 0,
        editsTruncated: false,
        sceneTreeCount: 0,
        sceneTreeTruncated: false,
        outputTruncated: this.controller.outputTruncated,
        varsTruncated: true,
      }, 1)
      this.stateValue = 'paused'
      this.versionValue++
    } finally {
      this.busyValue = false
    }
  }

  /** The maxTreeNodes bound captured at construction. */
  private readonly maxTreeNodesValue: number

  private boundsMaxTreeNodes(): number {
    return this.maxTreeNodesValue
  }

  /** Run one command. `edits` is async (set + re-inspect verification); all
   *  other commands are synchronous send-only. */
  async command(request: SessionCommandRequest): Promise<SessionCommandResult> {
    if (this.detachedValue) return { ok: false, error: 'session-detached' }
    if (this.busyValue) return { ok: false, error: 'session-busy' }
    try {
      switch (request.kind) {
        case 'pause':
          this.controller.send('break')
          break
        case 'continue':
          this.controller.send('continue')
          this.toRunning()
          break
        case 'step':
          this.controller.send('step')
          this.toRunning()
          break
        case 'next':
          this.controller.send('next')
          this.toRunning()
          break
        case 'breakpoint': {
          const bp = { file: request.file, line: request.line }
          this.breakpointsValue = request.enabled
            ? this.breakpointsValue.some(b => b.file === bp.file && b.line === bp.line)
              ? this.breakpointsValue
              : [...this.breakpointsValue, bp]
            : this.breakpointsValue.filter(b => !(b.file === bp.file && b.line === bp.line))
          this.controller.send('breakpoint', [toResPath(request.file, this.projectRoot), request.line, request.enabled])
          this.versionValue++ // breakpoint list changed → poll consumers re-render
          break
        }
        case 'edits': {
          if (this.stateValue !== 'paused' || this.lastPausedVars === undefined) {
            return { ok: false, error: 'not-paused' }
          }
          const result = await applyEdits(request.edits, this.lastPausedVars, this.controller, {
            maxEdits: request.edits.length,
            idleTimeoutMs: SNAPSHOT_TIMEOUT_MS,
            budgetMs: 30_000,
            signal: this.abort.signal,
          })
          return { ok: true, edits: { results: result.results, truncated: result.truncated } }
        }
      }
      this.lastCommandAt = Date.now()
      return { ok: true }
    } catch (error) {
      if (error instanceof GodotError && error.code === 'GODOT_ABORTED') {
        return { ok: false, error: 'session-detached' }
      }
      return {
        ok: false,
        error: error instanceof GodotError && error.code === 'GODOT_PARSE_ERROR' ? 'parse' : 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** The pollable snapshot. */
  poll(): SessionSnapshot {
    return {
      sessionId: this.sessionId,
      version: this.versionValue,
      state: this.stateValue,
      port: this.port,
      ...(this.reasonValue !== undefined ? { reason: this.reasonValue } : {}),
      ...(this.errorDetailValue !== undefined ? { errorDetail: this.errorDetailValue } : {}),
      ...(this.stateValue === 'paused' && this.pauseViewValue !== undefined ? { pause: this.pauseViewValue } : {}),
      breakpoints: [...this.breakpointsValue],
      outputTail: [...this.controller.output].slice(-OUTPUT_TAIL_MAX),
      errors: [...this.controller.errors].slice(-ERRORS_MAX)
        .map(err => `${err.file}:${err.line} ${err.warning ? 'warning' : 'error'}: ${err.error}`),
      outputTruncated: this.controller.outputTruncated,
    }
  }

  /** Detach: idempotent T4 teardown (best-effort breakpoint removal +
   *  continue), then abort the pause loop and dispose the controller. */
  detach(reason: DetachReason): void {
    if (this.detachedValue) return
    this.detachedValue = true
    this.reasonValue = reason
    if (this.idleTimer !== undefined) {
      clearInterval(this.idleTimer)
      this.idleTimer = undefined
    }
    for (const bp of this.breakpointsValue) {
      try {
        this.controller.send('breakpoint', [toResPath(bp.file, this.projectRoot), bp.line, false])
      } catch {
        // best-effort
      }
    }
    try {
      this.controller.send('continue')
    } catch {
      // best-effort
    }
    this.abort.abort()
    void this.controller.dispose()
    this.stateValue = 'detached'
    this.versionValue++
  }

  private toRunning(): void {
    if (this.stateValue === 'running') return
    this.stateValue = 'running'
    this.versionValue++
  }

  private checkIdle(): void {
    if (this.detachedValue) return
    if (Date.now() - this.lastCommandAt > this.idleTimeoutMs) {
      this.detach('timeout')
    }
  }
}
