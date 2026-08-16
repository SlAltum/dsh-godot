/**
 * The Godot debugger protocol controller: the DSH side is the TCP server the
 * game connects INTO (`--remote-debug tcp://127.0.0.1:<port>`). Owns frame
 * assembly, variant decoding, message routing, command sending (threadId from
 * `set_pid`), bounded output/error collection, and the abortable waiters the
 * run pipeline (tool layer) is built on. Protocol facts pinned in
 * `.context/t3/facts.md`.
 * @module @deepseek-ai/dsh-tool-godot-debug/controller
 */

import { createServer, type Server, type Socket } from 'node:net'
import { FrameAssembler } from './frames.ts'
import { VariantDecoder, type DecodedVariant } from './variant-decoder.ts'
import { VariantEncoder } from './variant-encoder.ts'
import { GodotError } from './error.ts'

/** One structured engine error message (`error` command payload). */
export interface GodotRuntimeError {
  hr: number
  min: number
  sec: number
  msec: number
  file: string
  func: string
  line: number
  error: string
  desc: string
  warning: boolean
  stack: { file: string; func: string; line: number }[]
}

/** A paused state (`debug_enter`): user breakpoint vs script error. */
export interface StopInfo {
  isUserBreakpoint: boolean
  reason: string
}

/** The stack dump plus one frame's variable groups. */
export interface StackSnapshot {
  dump: DecodedVariant[]
  vars: DecodedVariant[][]
}

/** A protocol wait that elapsed without the expected message; the run
 *  pipeline treats stop/snapshot timeouts as "no more stops" rather than
 *  infrastructure failures. */
export class WaitTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`controller: ${label} timed out after ${timeoutMs}ms`)
    this.name = 'WaitTimeoutError'
  }
}

interface WaitEntry {
  pred: (msg: DecodedVariant[]) => boolean
  resolve: (msg: DecodedVariant[]) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  signalListener: () => void
}

/** The `params` element of a protocol message (the array at index 2). */
function paramsOf(msg: DecodedVariant[]): DecodedVariant[] | undefined {
  const params = msg[2]
  return Array.isArray(params) ? params : undefined
}

/** The protocol/retention bounds one controller enforces. */
export interface DebugControllerOptions {
  /** Largest single framed message accepted from the game. */
  maxMessageBytes: number
  /** Max bytes of output/error content retained in one run. */
  maxOutputBytes: number
}

/**
 * The Godot debugger protocol controller: the DSH side is the TCP server the
 * game connects INTO (`--remote-debug tcp://127.0.0.1:<port>`). Owns frame
 * assembly, variant decoding, message routing, command sending (threadId from
 * `set_pid`), bounded output/error collection, and the abortable waiters the
 * run pipeline (tool layer) is built on. Protocol facts pinned in
 * `.context/t3/facts.md`.
 */
export class DebugController {
  private server: Server | undefined
  private socket: Socket | undefined
  private assembler = new FrameAssembler()
  private decoder = new VariantDecoder()
  private encoder = new VariantEncoder()
  private pending: WaitEntry[] = []
  private received: DecodedVariant[][] = []
  private closeWaiters: (() => void)[] = []
  private disposed = false
  private socketClosed = false
  private protocolError: Error | undefined

  private threadIdValue: number | undefined
  private outputLines: string[] = []
  private errorMessages: GodotRuntimeError[] = []
  private outputBytesValue = 0
  private outputTruncatedValue = false
  private outputOverflow = false

  constructor(private options: DebugControllerOptions) {}

  /** The bound port the game connects to (valid after {@link listen}). */
  get port(): number {
    const address = this.server?.address()
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('controller: no bound port')
    }
    return address.port
  }

  /** The game's thread id, captured from `set_pid` (needed for commands on Godot 4.2+). */
  get threadId(): number | undefined {
    return this.threadIdValue
  }

  /** Collected game output lines (split per line, trailing NUL stripped). */
  get output(): readonly string[] {
    return this.outputLines
  }

  /** Collected structured engine error messages. */
  get errors(): readonly GodotRuntimeError[] {
    return this.errorMessages
  }

  /** Bytes of output/error content collected (before the cap). */
  get outputBytes(): number {
    return this.outputBytesValue
  }

  /** True once retained output/error content hit `maxOutputBytes`. */
  get outputTruncated(): boolean {
    return this.outputTruncatedValue
  }

  /**
   * Bind the listening socket on loopback. The game connects to this port.
   * @param port - the port to bind; 0 (default) picks an ephemeral port.
   */
  async listen(port = 0): Promise<void> {
    if (this.server !== undefined) return
    const server = createServer((socket) => {
      this.accept(socket)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    this.server = server
  }

  /**
   * Wait for `set_pid` and return the game's thread id. Also resolves
   * immediately when the controller already captured it.
   * @param timeoutMs - budget before the wait fails.
   * @param signal - caller cancellation; aborts the wait.
   * @returns the thread id (also exposed via {@link threadId}).
   */
  async waitForSetPid(timeoutMs: number, signal?: AbortSignal): Promise<number> {
    await this.waitFor(msg => msg[0] === 'set_pid', timeoutMs, signal, 'set_pid')
    const threadId = this.threadIdValue
    if (threadId === undefined) throw new GodotError('controller: set_pid carried no thread id', 'GODOT_UNAVAILABLE')
    return threadId
  }

  /**
   * Wait for the game to pause (`debug_enter`) and report why.
   * @param timeoutMs - budget before the wait fails.
   * @param signal - caller cancellation.
   * @returns whether this was a user breakpoint and the reason string.
   */
  async waitForStop(timeoutMs: number, signal?: AbortSignal): Promise<StopInfo> {
    const msg = await this.waitFor(m => m[0] === 'debug_enter', timeoutMs, signal, 'debug_enter')
    const params = paramsOf(msg)
    return {
      isUserBreakpoint: params?.[0] === true,
      reason: typeof params?.[1] === 'string' ? params[1] : '',
    }
  }

  /**
   * Send one command to the game (Godot 4.2+ frames carry the thread id).
   * @param cmd - the protocol command name.
   * @param params - the command's parameter array.
   * @throws GodotError when the thread id is not known yet (set_pid must
   * precede commands — T3.0 pinned the ordering).
   */
  send(cmd: string, params: unknown[] = []): void {
    const threadId = this.threadIdValue
    if (this.socket === undefined || this.socket.destroyed) {
      throw new GodotError(`controller: cannot send ${cmd}, game not connected`, 'GODOT_UNAVAILABLE')
    }
    if (threadId === undefined) {
      throw new GodotError(`controller: cannot send ${cmd} before set_pid`, 'GODOT_UNAVAILABLE')
    }
    this.socket.write(this.encoder.encodeMessage([cmd, threadId, params]))
  }

  /**
   * Wait for one complete stop snapshot: the stack dump and every
   * `stack_frame_var` the game announces via `stack_frame_vars`. Returns the
   * messages' `params` arrays (the dump's `[N, file, line, func, ...]` shape
   * is pinned by T3.0).
   * @param timeoutMs - budget for the whole snapshot.
   * @param signal - caller cancellation.
   * @returns the dump params and one params array per variable.
   */
  async waitForSnapshot(timeoutMs: number, signal?: AbortSignal): Promise<StackSnapshot> {
    const dumpMsg = await this.waitFor(m => m[0] === 'stack_dump', timeoutMs, signal, 'stack_dump')
    const dump = paramsOf(dumpMsg)
    if (dump === undefined) throw new GodotError('controller: stack_dump carried no params', 'GODOT_PARSE_ERROR')
    const varsMsg = await this.waitFor(m => m[0] === 'stack_frame_vars', timeoutMs, signal, 'stack_frame_vars')
    const varsHead = paramsOf(varsMsg)
    const remaining = typeof varsHead?.[0] === 'number' ? varsHead[0] : 0
    const vars: DecodedVariant[][] = []
    for (let i = 0; i < remaining; i++) {
      const varMsg = await this.waitFor(m => m[0] === 'stack_frame_var', timeoutMs, signal, `stack_frame_var #${i}`)
      const params = paramsOf(varMsg)
      if (params === undefined) throw new GodotError('controller: stack_frame_var carried no params', 'GODOT_PARSE_ERROR')
      vars.push(params)
    }
    return { dump, vars }
  }

  /**
   * Wait for `debug_exit` (the game left the paused state after a continue).
   * @param timeoutMs - budget before the wait fails.
   * @param signal - caller cancellation.
   */
  async waitForDebugExit(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    await this.waitFor(m => m[0] === 'debug_exit', timeoutMs, signal, 'debug_exit')
  }

  /**
   * Wait for the game's TCP connection to close (game exit or disconnect).
   * @param timeoutMs - budget before the wait fails.
   * @param signal - caller cancellation.
   */
  async waitForSocketClose(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (this.socketClosed) return
    if (this.disposed) {
      throw new GodotError('controller: socket close after dispose', 'GODOT_ABORTED')
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.closeWaiters.splice(this.closeWaiters.indexOf(done), 1)
        signal?.removeEventListener('abort', onAbort)
        reject(new WaitTimeoutError('socket close', timeoutMs))
      }, timeoutMs)
      const done = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = (): void => {
        clearTimeout(timer)
        this.closeWaiters.splice(this.closeWaiters.indexOf(done), 1)
        reject(new GodotError('controller: socket close aborted', 'GODOT_ABORTED'))
      }
      if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
      this.closeWaiters.push(done)
    })
  }

  /**
   * The protocol-level failure that ended the connection, if any (malformed
   * or oversized frame); the run pipeline surfaces it as `GODOT_PARSE_ERROR`.
   */
  get protocolFailure(): Error | undefined {
    return this.protocolError
  }

  /**
   * Tear the controller down: reject in-flight waiters, destroy the socket
   * and close the server. Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.socket?.destroy()
    this.socket = undefined
    for (const done of this.closeWaiters.splice(0)) {
      done()
    }
    this.rejectAll(new GodotError('controller: disposed', 'GODOT_ABORTED'))
    const server = this.server
    this.server = undefined
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    }
  }

  private accept(socket: Socket): void {
    if (this.socket !== undefined && !this.socket.destroyed) {
      socket.destroy() // one game per run
      return
    }
    this.socket = socket
    socket.on('data', (chunk) => {
      this.onData(chunk)
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      this.socketClosed = true
      this.socket = undefined
      for (const done of this.closeWaiters.splice(0)) done()
      this.rejectAll(new GodotError('controller: game disconnected', 'GODOT_UNAVAILABLE'))
    })
  }

  private onData(chunk: Buffer): void {
    if (this.disposed) return
    let frames: Buffer[]
    try {
      frames = this.assembler.push(chunk)
    } catch (error) {
      this.failProtocol(error)
      return
    }
    for (const payload of frames) {
      if (payload.length > this.options.maxMessageBytes) {
        this.failProtocol(new Error(`frame of ${payload.length} bytes exceeds maxMessageBytes ${this.options.maxMessageBytes}`))
        return
      }
      let msg: DecodedVariant[]
      try {
        msg = this.decoder.decodeMessage(payload)
      } catch (error) {
        this.failProtocol(error)
        return
      }
      this.route(msg)
    }
  }

  private failProtocol(error: unknown): void {
    this.protocolError = error instanceof Error ? error : new Error(String(error))
    this.socket?.destroy()
  }

  private route(msg: DecodedVariant[]): void {
    const cmd = msg[0]
    if (cmd === 'set_pid' && this.threadIdValue === undefined && typeof msg[1] === 'number') {
      this.threadIdValue = msg[1]
    } else if (cmd === 'output') {
      this.collectOutput(paramsOf(msg))
    } else if (cmd === 'error') {
      this.collectError(paramsOf(msg))
    }
    this.received.push(msg)
    for (const entry of this.pending) {
      if (entry.pred(msg)) {
        clearTimeout(entry.timer)
        entry.signalListener()
        this.pending.splice(this.pending.indexOf(entry), 1)
        this.received.splice(this.received.indexOf(msg), 1)
        entry.resolve(msg)
        return
      }
    }
  }

  private collectOutput(params: DecodedVariant[] | undefined): void {
    if (this.outputOverflow) return
    const lines = params?.[0]
    if (!Array.isArray(lines)) return
    for (const entry of lines) {
      if (typeof entry !== 'string') continue
      this.accumulate(entry)
      for (const line of entry.split('\n')) {
        const clean = line.replace(/\u0000+$/, '')
        if (clean.length > 0) this.outputLines.push(clean)
      }
    }
  }

  private collectError(params: DecodedVariant[] | undefined): void {
    if (this.outputOverflow) return
    if (!Array.isArray(params) || typeof params[4] !== 'string') return
    const stackCount = typeof params[10] === 'number' ? params[10] : 0
    const stack: { file: string; func: string; line: number }[] = []
    for (let i = 0; i < stackCount; i++) {
      stack.push({
        file: typeof params[11 + i * 3] === 'string' ? (params[11 + i * 3] as string) : '',
        func: typeof params[12 + i * 3] === 'string' ? (params[12 + i * 3] as string) : '',
        line: typeof params[13 + i * 3] === 'number' ? (params[13 + i * 3] as number) : 0,
      })
    }
    const err: GodotRuntimeError = {
      hr: typeof params[0] === 'number' ? params[0] : 0,
      min: typeof params[1] === 'number' ? params[1] : 0,
      sec: typeof params[2] === 'number' ? params[2] : 0,
      msec: typeof params[3] === 'number' ? params[3] : 0,
      file: typeof params[4] === 'string' ? params[4] : '',
      func: typeof params[5] === 'string' ? params[5] : '',
      line: typeof params[6] === 'number' ? params[6] : 0,
      error: typeof params[7] === 'string' ? params[7] : '',
      desc: typeof params[8] === 'string' ? params[8] : '',
      warning: params[9] === true,
      stack,
    }
    this.accumulate(`${err.file}:${err.line} ${err.error} ${err.desc}`)
    this.errorMessages.push(err)
  }

  private accumulate(text: string): void {
    if (this.outputOverflow) return
    this.outputBytesValue += Buffer.byteLength(text, 'utf8')
    if (this.outputBytesValue > this.options.maxOutputBytes) {
      this.outputOverflow = true
      this.outputTruncatedValue = true
    }
  }

  private waitFor(
    pred: (msg: DecodedVariant[]) => boolean,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    label: string,
  ): Promise<DecodedVariant[]> {
    if (this.disposed) {
      return Promise.reject(new GodotError(`controller: ${label} after dispose`, 'GODOT_ABORTED'))
    }
    // Consume history first: messages that arrived before this waiter was
    // registered still satisfy the predicate.
    const idx = this.received.findIndex(pred)
    if (idx !== -1) {
      const msg = this.received[idx]
      this.received.splice(idx, 1)
      return Promise.resolve(msg as DecodedVariant[])
    }
    return new Promise<DecodedVariant[]>((resolve, reject) => {
      const entry: WaitEntry = {
        pred,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending.splice(this.pending.indexOf(entry), 1)
          entry.signalListener()
          reject(new WaitTimeoutError(label, timeoutMs))
        }, timeoutMs),
        signalListener: () => {},
      }
      if (signal !== undefined) {
        entry.signalListener = () => {
          signal.removeEventListener('abort', onAbort)
        }
        const onAbort = (): void => {
          clearTimeout(entry.timer)
          this.pending.splice(this.pending.indexOf(entry), 1)
          reject(new GodotError(`controller: ${label} aborted`, 'GODOT_ABORTED'))
        }
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.pending.push(entry)
    })
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.splice(0)) {
      clearTimeout(entry.timer)
      entry.signalListener()
      entry.reject(error)
    }
  }
}
