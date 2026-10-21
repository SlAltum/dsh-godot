/**
 * One running game session: the host side of the ego bridge.
 *
 * Lifecycle (plan §3.1/§3.4):
 * - `start()` binds `127.0.0.1:0`, spawns the game through the injected
 *   factory, and waits for the bridge's `hello` (token + protocol checked).
 *   Any failure disposes the whole session before rethrowing — no half-started
 *   session survives.
 * - `request()` writes one command line and resolves the matching reply;
 *   timeouts and aborts settle only that request.
 * - `dispose()` is idempotent and runs the inverse in order: reject pending
 *   requests, close the socket, close the listener, terminate the process and
 *   wait for its exit within the grace period.
 * - a process exit, a dropped socket, a malformed line, or a token/protocol
 *   mismatch moves the session to `lost`, rejects everything in flight, and
 *   notifies `onLost` listeners.
 * @module @deepseek-ai/dsh-tool-godot-ego/session
 */

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { EgoGodotError } from './errors.ts'
import { EGO_PROTOCOL_VERSION, LineDecoder, encodeCommand, parseReply } from './protocol.ts'
import type { BridgeOk, BridgeReply } from './protocol.ts'

/** Session states (a terminal state is `disposed`). */
export type SessionState = 'starting' | 'ready' | 'lost' | 'disposed'

/** An immutable view of the session for status reporting. */
export interface SessionSnapshot {
  readonly sessionId: string
  readonly workspace: string
  readonly state: SessionState
  readonly port: number | null
  readonly pid: number | null
  readonly window: readonly [number, number] | null
  readonly lostReason: string | null
}

/** Everything one session needs; the process side arrives through `spawnGame`. */
export interface GameSessionOptions {
  readonly sessionId: string
  readonly workspace: string
  /** Budget for the bridge to connect and say hello. */
  readonly handshakeTimeoutMs: number
  /** Budget for one command round-trip. */
  readonly requestTimeoutMs: number
  /** Terminate-escalation grace for the spawned game. */
  readonly graceMs: number
  /** Per-line cap for the reply stream. */
  readonly maxLineChars?: number
  /** Token source (tests pin it; production uses 32 random bytes). */
  readonly randomToken?: () => string
  /** Spawns the game and returns its handle; called once, after the listener binds. */
  readonly spawnGame: (endpoint: { readonly port: number; readonly token: string }) => SubprocessHandle
}

/** One in-flight request; the settle helpers own timer/abort cleanup. */
interface PendingRequest {
  readonly resolve: (reply: BridgeOk) => void
  readonly reject: (error: EgoGodotError) => void
}

/** One running session. */
export class GameSession {
  private state: SessionState = 'starting'
  private server: Server | undefined
  private socket: Socket | undefined
  private handle: SubprocessHandle | undefined
  private port: number | null = null
  private pid: number | null = null
  private window: readonly [number, number] | null = null
  private lostReason: string | null = null
  private exit: SubprocessOutcome | null = null
  private token = ''
  private readonly decoder: LineDecoder
  private readonly pending = new Map<number, PendingRequest>()
  private readonly lostListeners = new Set<(reason: string) => void>()
  private nextId = 1
  private hello = createDeferred<void>()

  /**
   * @param options - identity, budgets, and the spawn factory.
   */
  constructor(private readonly options: GameSessionOptions) {
    this.decoder = new LineDecoder(options.maxLineChars)
    // `start()` replaces this deferred before anyone awaits it; the initial
    // promise only exists so `hello` is never optional. Swallow its rejection
    // so a disposed-before-start session cannot surface as unhandled.
    void this.hello.promise.catch(() => { /* replaced by start() */ })
  }

  /** The session id (stable for the whole lifetime). */
  get sessionId(): string {
    return this.options.sessionId
  }

  /**
   * A JSON-safe view of the current state.
   * @returns the session snapshot.
   */
  snapshot(): SessionSnapshot {
    return {
      sessionId: this.options.sessionId,
      workspace: this.options.workspace,
      state: this.state,
      port: this.port,
      pid: this.pid,
      window: this.window,
      lostReason: this.lostReason,
    }
  }

  /**
   * Bind, spawn, and wait for the handshake.
   * @returns the ready snapshot.
   * @throws EgoGodotError `GODOT_EGO_TIMEOUT` when the bridge stays silent,
   *   `GODOT_EGO_REJECTED` on a token/protocol mismatch, `GODOT_EGO_LOST`
   *   when the process exits or disconnects first.
   */
  async start(): Promise<SessionSnapshot> {
    if (this.server !== undefined || this.state !== 'starting') {
      throw new EgoGodotError('game session has already been started', 'GODOT_EGO_REJECTED')
    }
    this.token = (this.options.randomToken ?? defaultToken)()
    const hello = createDeferred<void>()
    this.hello = hello
    try {
      this.port = await this.listen()
      this.handle = this.options.spawnGame({ port: this.port, token: this.token })
      this.watchProcess(this.handle)
      await this.awaitHandshake(hello)
      this.state = 'ready'
      return this.snapshot()
    } catch (error: unknown) {
      // The handshake may not have been awaited yet (a synchronous spawn
      // failure); keep dispose's rejection from becoming unhandled.
      void hello.promise.catch(() => {})
      await this.dispose()
      throw error
    }
  }

  /**
   * Send one command and resolve its reply.
   * @param cmd - the bridge command name.
   * @param params - command parameters.
   * @param signal - optional caller cancellation.
   * @returns the successful reply.
   * @throws EgoGodotError `GODOT_EGO_NO_SESSION` before ready, `_TIMEOUT` when
   *   the bridge does not answer in time, `_ABORTED` on cancellation,
   *   `_REJECTED` when the bridge answers `ok: false`, `_LOST` when the
   *   session has ended.
   */
  request(cmd: string, params: Readonly<Record<string, unknown>> = {}, signal?: AbortSignal): Promise<BridgeOk> {
    const socket = this.socket
    if (this.state !== 'ready' || socket === undefined) {
      return Promise.reject(new EgoGodotError(`no running game session (state: ${this.state})`, 'GODOT_EGO_NO_SESSION'))
    }
    if (signal?.aborted === true) {
      return Promise.reject(new EgoGodotError('request aborted before sending', 'GODOT_EGO_ABORTED'))
    }
    const id = this.nextId++
    return new Promise<BridgeOk>((resolve, reject) => {
      // Exactly one of timer/abort/reply/rejection wins: settling removes the
      // other paths (timer cleared, abort listener removed, pending deleted).
      const settle = (action: () => void): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.pending.delete(id)
        action()
      }
      const timer = setTimeout(() => {
        settle(() => { reject(new EgoGodotError(`bridge request "${cmd}" timed out after ${this.options.requestTimeoutMs} ms`, 'GODOT_EGO_TIMEOUT')) })
      }, this.options.requestTimeoutMs)
      const onAbort = (): void => {
        settle(() => { reject(new EgoGodotError(`bridge request "${cmd}" was aborted`, 'GODOT_EGO_ABORTED')) })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (reply) => { settle(() => { resolve(reply) }) },
        reject: (error) => { settle(() => { reject(error) }) },
      })
      try {
        socket.write(encodeCommand(id, cmd, params))
      } catch (error: unknown) {
        /* v8 ignore start -- socket.write after a close surfaces as the close
           event (which loses the session); only an encode failure throws here. */
        settle(() => {
          reject(new EgoGodotError(`bridge request "${cmd}" could not be sent`, 'GODOT_EGO_LOST', { cause: error }))
        })
        /* v8 ignore stop */
      }
    })
  }

  /**
   * Observe session loss (process exit, disconnect, protocol failure).
   * @param listener - called once per session with the human-readable reason.
   * @returns the unsubscribe function.
   */
  onLost(listener: (reason: string) => void): () => void {
    this.lostListeners.add(listener)
    return () => { this.lostListeners.delete(listener) }
  }

  /**
   * Stop the session and release everything it owns. Idempotent: the second
   * call is a no-op. In-flight requests reject with `GODOT_EGO_ABORTED`.
   */
  async dispose(): Promise<void> {
    if (this.state === 'disposed') return
    this.state = 'disposed'
    this.rejectPending(new EgoGodotError('game session disposed', 'GODOT_EGO_ABORTED'))
    this.hello.reject(new EgoGodotError('game session disposed before ready', 'GODOT_EGO_ABORTED'))
    this.socket?.destroy()
    this.socket = undefined
    const server = this.server
    this.server = undefined
    if (server !== undefined) await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    const handle = this.handle
    this.handle = undefined
    if (handle !== undefined) {
      handle.terminate()
      try {
        await handle.waitForExit(AbortSignal.timeout(this.options.graceMs))
      } catch {
        // A grace expiry is reported by the caller's stop path; disposal continues.
      }
    }
  }

  /**
   * Ask the game to quit, wait for its exit within the grace period, and
   * dispose. Idempotent and safe on a lost session: the process is still
   * reaped and its exit facts reported.
   * @returns the process exit facts (`exitCode`/`signal`, both null when the
   *   process outcome was never observed).
   */
  async stop(): Promise<{ exitCode: number | null; signal: string | null }> {
    const handle = this.handle
    if (this.state === 'ready') {
      try {
        await this.request('quit', {}, AbortSignal.timeout(this.options.graceMs))
      } catch {
        // The bridge usually closes the socket as it quits; the exit wait below is authoritative.
      }
    }
    if (handle !== undefined) {
      try {
        await handle.waitForExit(AbortSignal.timeout(this.options.graceMs))
      } catch {
        // Escalate once, then stop waiting: disposal still terminates below.
      }
    }
    await this.dispose()
    return { exitCode: this.exit?.exitCode ?? null, signal: this.exit?.signal ?? null }
  }

  /** Bind the loopback listener and return its port. */
  private listen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = createServer((socket) => { this.accept(socket) })
      this.server = server
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        /* v8 ignore next -- a listener error after bind cannot be produced deterministically; loss handling is shared with socket close */
        server.on('error', (error: Error) => { this.lose(`bridge listener failed: ${error.message}`) })
        resolve((server.address() as AddressInfo).port)
      })
    })
  }

  /** Accept the bridge connection (exactly one; extras are dropped). */
  private accept(socket: Socket): void {
    if (this.socket !== undefined || this.state !== 'starting' && this.state !== 'ready') {
      socket.destroy()
      return
    }
    this.socket = socket
    this.decoder.reset()
    socket.setNoDelay(true)
    socket.on('data', (chunk: Buffer) => { this.onData(chunk) })
    /* v8 ignore next -- a forced ECONNRESET would only retest Node; close carries the loss */
    socket.on('error', () => { /* close follows; loss is handled there */ })
    socket.on('close', () => {
      this.socket = undefined
      this.lose('bridge connection closed')
    })
  }

  /** Feed one chunk through the line decoder and dispatch each reply. */
  private onData(chunk: Buffer): void {
    const lines = this.decoder.push(chunk.toString('utf8'))
    if (this.decoder.overflow) {
      this.lose('bridge reply exceeded the line cap')
      return
    }
    for (const line of lines) {
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch {
        this.lose('bridge sent a malformed reply')
        return
      }
      const reply = parseReply(raw)
      if (reply === undefined) {
        this.lose('bridge sent an unrecognized reply')
        return
      }
      this.dispatch(reply)
    }
  }

  /** Route one decoded reply: handshake event, success, or rejection. */
  private dispatch(reply: BridgeReply): void {
    if (reply.kind === 'event') {
      this.onHello(reply.payload)
      return
    }
    const pending = this.pending.get(reply.id)
    if (pending === undefined) return
    if (reply.kind === 'ok') {
      pending.resolve(reply)
      return
    }
    pending.reject(new EgoGodotError(`bridge rejected the command (${reply.code}): ${reply.message}`, 'GODOT_EGO_REJECTED'))
  }

  /** Validate the handshake payload and resolve the ready gate. */
  private onHello(payload: Readonly<Record<string, unknown>>): void {
    if (payload.token !== this.token) {
      this.socket?.destroy()
      this.hello.reject(new EgoGodotError('bridge handshake token mismatch', 'GODOT_EGO_REJECTED'))
      this.lose('bridge handshake token mismatch')
      return
    }
    if (payload.protocol !== EGO_PROTOCOL_VERSION) {
      this.socket?.destroy()
      this.hello.reject(new EgoGodotError(`bridge protocol ${String(payload.protocol)} is not supported (expected ${EGO_PROTOCOL_VERSION})`, 'GODOT_EGO_REJECTED'))
      this.lose('bridge protocol mismatch')
      return
    }
    if (typeof payload.pid === 'number') this.pid = payload.pid
    const window = payload.window
    if (Array.isArray(window) && window.length === 2 && typeof window[0] === 'number' && typeof window[1] === 'number') {
      this.window = [window[0], window[1]]
    }
    this.hello.resolve()
  }

  /** Await the handshake with the configured budget. */
  private async awaitHandshake(hello: { readonly promise: Promise<void> }): Promise<void> {
    let timer!: ReturnType<typeof setTimeout>
    try {
      await Promise.race([
        hello.promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new EgoGodotError(`bridge did not say hello within ${this.options.handshakeTimeoutMs} ms`, 'GODOT_EGO_TIMEOUT'))
          }, this.options.handshakeTimeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Watch the spawned process and lose the session when it ends. */
  private watchProcess(handle: SubprocessHandle): void {
    handle.done.then(
      (outcome: SubprocessOutcome) => {
        this.exit = outcome
        this.lose(exitReason(outcome))
      },
      (error: unknown) => { this.lose(`game process failure: ${describeError(error)}`) },
    )
  }

  /** Move to `lost`, reject everything in flight, and notify listeners once. */
  private lose(reason: string): void {
    if (this.state === 'lost' || this.state === 'disposed') return
    this.state = 'lost'
    this.lostReason = reason
    this.rejectPending(new EgoGodotError(`game session lost: ${reason}`, 'GODOT_EGO_LOST'))
    this.hello.reject(new EgoGodotError(`game session lost before ready: ${reason}`, 'GODOT_EGO_LOST'))
    this.socket?.destroy()
    this.socket = undefined
    for (const listener of this.lostListeners) {
      try {
        listener(reason)
      } catch {
        // One listener must not stop the others from learning about the loss.
      }
    }
  }

  /** Reject every pending request and clear the table. */
  private rejectPending(error: EgoGodotError): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const request of pending) request.reject(error)
  }
}

/** Build a deferred with exposed settle functions. */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 32 random bytes, base64url — the per-session handshake secret. */
function defaultToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Model-facing description of a process exit. */
function exitReason(outcome: SubprocessOutcome): string {
  return outcome.signal !== null
    ? `game terminated by ${outcome.signal}`
    : `game exited with code ${String(outcome.exitCode)}`
}

/** Best-effort message for a rejected `done` promise. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
