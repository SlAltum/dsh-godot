/**
 * TCP JSON-RPC endpoint for Godot's LSP: framing over `node:net` with request
 * id pairing, server→client notification routing, a partial-frame idle
 * timeout (a Godot server that stalls mid-frame must not hang a query until
 * the tool deadline), and structured failure codes the provider maps to the
 * seam's `LspError`. Framing reuses `MessageDecoder`/`encodeMessage` from
 * `@deepseek-ai/dsh-lsp-stdio`; every other behavior is owned here.
 * @module @deepseek-ai/dsh-lsp-godot/endpoint
 */

import { Socket } from 'node:net'
import { encodeMessage, MessageDecoder } from '@deepseek-ai/dsh-lsp-stdio'

/** Structured endpoint failure codes. */
export type GodotEndpointErrorCode =
  | 'CONNECT_FAILED'
  | 'CONNECT_TIMEOUT'
  | 'CONNECTION_CLOSED'
  | 'IDLE_TIMEOUT'
  | 'MALFORMED_MESSAGE'
  | 'SERVER_ERROR'
  | 'CANCELED'

/** An endpoint-level failure with a stable code the provider maps to `LspError`. */
export class GodotEndpointError extends Error {
  /** The stable failure class the provider routes on. */
  readonly code: GodotEndpointErrorCode
  constructor(code: GodotEndpointErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'GodotEndpointError'
  }
}

/** Endpoint construction options. */
export interface GodotLspEndpointOptions {
  /** LSP server host (Godot binds loopback by default). */
  host: string
  /** LSP server port. */
  port: number
  /** TCP connect budget before `CONNECT_TIMEOUT`. */
  connectTimeoutMs: number
  /** Partial-frame stall budget before `IDLE_TIMEOUT`. */
  idleTimeoutMs: number
  /** Largest single framed message accepted (framing guard). */
  maxMessageBytes: number
  /** Receives every server→client notification (method + params). */
  onNotification: (method: string, params: unknown) => void
}

/** One pending request. */
interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: unknown) => void
  /** Abort listener disposer; undefined when no signal was attached. */
  abortDisposer?: () => void
}

/**
 * One TCP JSON-RPC connection to a Godot LSP server. `connect()` must succeed
 * before `request`/`notify`; after any teardown the endpoint is permanently
 * dead and the provider must construct a new one (Godot does not recognize a
 * reconnected client, T0 fact 4).
 */
export class GodotLspEndpoint {
  private socket: Socket | undefined
  private readonly decoder: MessageDecoder
  private readonly pending = new Map<number, PendingRequest>()
  private sequence = 0
  private teardownCode: GodotEndpointErrorCode | undefined
  private idleTimer: NodeJS.Timeout | undefined
  /** True while the decoder holds an incomplete frame (idle-timeout arming). */
  private partial = false

  constructor(private readonly options: GodotLspEndpointOptions) {
    this.decoder = new MessageDecoder(options.maxMessageBytes)
  }

  /** Whether the socket is connected and no teardown has run. */
  get connected(): boolean {
    return this.teardownCode === undefined && this.socket !== undefined
  }

  /**
   * Establish the TCP connection. Rejects with `CONNECT_FAILED` on a socket
   * error (e.g. connection refused) or `CONNECT_TIMEOUT` when the connect
   * budget elapses first.
   */
  connect(): Promise<void> {
    if (this.teardownCode !== undefined) {
      return Promise.reject(new GodotEndpointError('CONNECTION_CLOSED', 'LSP endpoint is not connectable'))
    }
    if (this.socket !== undefined) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      this.socket = socket
      let settled = false
      /* v8 ignore start -- CONNECT_TIMEOUT needs a silently-dropping peer; refuse/success settles first on CI and local sandboxes. */
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        socket.destroy()
        this.teardown('CONNECT_TIMEOUT', 'LSP connect timed out')
        reject(new GodotEndpointError('CONNECT_TIMEOUT', 'LSP connect timed out'))
      }, this.options.connectTimeoutMs)
      /* v8 ignore stop */

      socket.once('connect', () => {
        /* v8 ignore next -- once() fires once; a settled connect/error race cannot re-enter this handler. */
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.on('data', (chunk: Buffer) => { this.onData(chunk) })
        resolve()
      })
      socket.once('error', (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.teardown('CONNECT_FAILED', `LSP connect failed: ${error.message}`)
        reject(new GodotEndpointError('CONNECT_FAILED', `LSP connect failed: ${error.message}`))
      })
      socket.once('close', () => {
        clearTimeout(timer)
        this.teardown('CONNECTION_CLOSED', 'LSP connection closed')
      })
      socket.connect(this.options.port, this.options.host)
    })
  }

  /**
   * Send one JSON-RPC request and resolve its result. Aborting `signal` sends
   * `$/cancelRequest` and rejects with `CANCELED`; Godot ignores the cancel
   * (T0 fact 4), so the late response is discarded.
   * @param method - the request method.
   * @param params - the request params.
   * @param signal - optional cancellation.
   * @returns the JSON-RPC result; rejects with `SERVER_ERROR` on an error
   * response and with a teardown code when the connection dies first.
   */
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const socket = this.socket
    if (this.teardownCode !== undefined || socket === undefined) {
      return Promise.reject(new GodotEndpointError('CONNECTION_CLOSED', 'LSP endpoint is not connected'))
    }
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject }
      if (signal !== undefined) {
        const onAbort = () => {
          this.pending.delete(id)
          pending.abortDisposer?.()
          // The socket was captured non-undefined above; teardown removes the
          // abort listener before nulling the connection, so onAbort never
          // runs against a dead socket.
          socket.write(encodeMessage({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } }))
          reject(new GodotEndpointError('CANCELED', 'LSP request canceled'))
        }
        pending.abortDisposer = () => { signal.removeEventListener('abort', onAbort) }
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.pending.set(id, pending)
      socket.write(encodeMessage({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /**
   * Send one JSON-RPC notification (fire-and-forget).
   * @param method - the notification method.
   * @param params - the notification params.
   */
  notify(method: string, params: unknown): void {
    if (this.teardownCode !== undefined || this.socket === undefined) return
    this.socket.write(encodeMessage({ jsonrpc: '2.0', method, params }))
  }

  /** Permanently close the endpoint and reject every pending request. */
  close(): void {
    this.teardown('CONNECTION_CLOSED', 'LSP endpoint closed')
  }

  private onData(chunk: Buffer): void {
    this.armIdleTimer()
    let messages: unknown[]
    try {
      messages = this.decoder.push(chunk)
    } catch (error) {
      /* v8 ignore next -- MessageDecoder only throws Error instances. */
      this.teardown('MALFORMED_MESSAGE', `LSP message decoding failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.partial = messages.length === 0
    for (const message of messages) this.dispatch(message)
  }

  private dispatch(message: unknown): void {
    type Wire = { id?: number; method?: string; result?: unknown; error?: { code?: number; message?: string }; params?: unknown }
    const record = message as Wire
    if (record.id !== undefined && (record.result !== undefined || record.error !== undefined)) {
      const pending = this.pending.get(record.id)
      if (pending === undefined) return
      this.pending.delete(record.id)
      pending.abortDisposer?.()
      if (record.error !== undefined) {
        pending.reject(new GodotEndpointError('SERVER_ERROR', record.error.message ?? 'LSP server error'))
      } else {
        pending.resolve(record.result)
      }
      return
    }
    if (typeof record.method === 'string') {
      this.options.onNotification(record.method, record.params)
    }
  }

  private armIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      if (this.partial && this.teardownCode === undefined) {
        this.teardown('IDLE_TIMEOUT', 'LSP message stalled mid-frame')
      }
    }, this.options.idleTimeoutMs)
  }

  private teardown(code: GodotEndpointErrorCode, message: string): void {
    if (this.teardownCode !== undefined) return
    this.teardownCode = code
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    const socket = this.socket
    this.socket = undefined
    if (socket !== undefined) socket.destroy()
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.abortDisposer?.()
      pending.reject(new GodotEndpointError(code, message))
    }
  }
}
