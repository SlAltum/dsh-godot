/**
 * Fake Godot LSP server for endpoint/provider tests: a real `node:net` TCP
 * server speaking the LSP base protocol (Content-Length framing) with a
 * scriptable test API. Mirrors the behavior T0 pinned from Godot 4.7
 * (`.context/t0/facts.md`): request/response with id pairing, server→client
 * notifications (`gdscript_client/changeWorkspace`, `gdscript/capabilities`,
 * `textDocument/publishDiagnostics`), and optional misbehavior injection
 * (half-frames, closes, oversized bodies).
 */

import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'

/** One decoded inbound message from the client. */
export interface FakeInbound {
  /** `request` for messages with an id, `notify` otherwise. */
  kind: 'request' | 'notify'
  /** JSON-RPC id (requests only). */
  id?: number
  method: string
  params: unknown
  raw: string
}

/** Behavior knobs a test may flip between interactions. */
export interface FakeOptions {
  /** Respond to every request with this server error instead of the scripted result. */
  forceError?: { code: number; message: string }
  /** Hold every response until the test calls `respond` (real-server latency). */
  hold?: boolean
}

export class FakeGodotLspServer {
  readonly server: Server
  port = 0
  /** Every decoded inbound message, in arrival order. */
  readonly inbound: FakeInbound[] = []
  /** Clients currently connected. */
  readonly clients = new Set<Socket>()
  /** Scripted responses for requests that arrive after `respond` was called. */
  private responses = new Map<number, unknown>()
  /** Per-method responses: a request whose method matches is answered immediately. */
  private methodResults = new Map<string, unknown>()
  /** Requests that arrived while holding, waiting for the test's `respond`. */
  private held = new Map<number, Socket>()
  private defaultResult: unknown = null
  private options: FakeOptions = {}

  constructor(options: FakeOptions = {}) {
    this.options = options
    this.server = createServer((socket) =>{  this.handleClient(socket) })
  }

  /** Start listening on an ephemeral port; resolves with the port. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server.address() as AddressInfo).port
        resolve(this.port)
      })
    })
  }

  /** Close the server and every client connection. */
  close(): Promise<void> {
    for (const client of this.clients) client.destroy()
    return new Promise(resolve => this.server.close(() =>{  resolve() }))
  }

  /**
   * Answer a request with `result`. Under `hold` the response goes out as soon
   * as the request arrives; otherwise it is scripted for the next request with
   * that id. A held socket that died meanwhile is dropped, never written.
   */
  respond(id: number, result: unknown): void {
    const socket = this.held.get(id)
    if (socket !== undefined) {
      this.held.delete(id)
      if (!socket.destroyed) socket.write(frame({ jsonrpc: '2.0', id, result }))
      return
    }
    this.responses.set(id, result)
  }

  /** Default result for any request without a scripted response. */
  setDefaultResult(result: unknown): void {
    this.defaultResult = result
  }

  /** Answer every request with the given method immediately with `result`. */
  setMethodResult(method: string, result: unknown): void {
    this.methodResults.set(method, result)
  }

  /** Send a server→client notification. */
  sendNotification(method: string, params: unknown): void {
    for (const client of this.clients) {
      client.write(frame({ jsonrpc: '2.0', method, params }))
    }
  }

  /**
   * Write raw bytes verbatim to every client — frame-injection probes for
   * partial frames, malformed headers, and oversized bodies. No framing is
   * applied; the bytes are the frame.
   */
  sendRawBody(bytes: string | Buffer): void {
    for (const client of this.clients) client.write(bytes)
  }

  /** Destroy every client connection abruptly (server stays up). */
  dropClients(): void {
    for (const client of this.clients) client.destroy()
    this.clients.clear()
    // Held requests die with their sockets; a later respond must not target them.
    this.held.clear()
  }

  /** The last inbound request id, or undefined. */
  get lastRequestId(): number | undefined {
    for (let i = this.inbound.length - 1; i >= 0; i--) {
      const entry = this.inbound[i]
      if (entry === undefined) continue
      if (entry.kind === 'request' && entry.id !== undefined) return entry.id
    }
    return undefined
  }

  /** All inbound methods, in arrival order. */
  methods(): string[] {
    return this.inbound.map(m => m.method)
  }

  private handleClient(socket: Socket): void {
    this.clients.add(socket)
    let buffer: Buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const parsed = takeFrame(buffer)
        if (!parsed) return
        buffer = parsed.rest
        this.inbound.push(parsed.message)
        const { message } = parsed
        if (message.kind !== 'request') continue
        const id = message.id as number
        if (this.options.forceError) {
          socket.write(frame({ jsonrpc: '2.0', id, error: { code: this.options.forceError.code, message: this.options.forceError.message } }))
          continue
        }
        const methodResult = this.methodResults.get(message.method)
        if (methodResult !== undefined) {
          socket.write(frame({ jsonrpc: '2.0', id, result: methodResult }))
          continue
        }
        if (this.options.hold) {
          // A scripted response wins regardless of arrival order; otherwise the
          // request waits for the test's `respond`.
          if (this.responses.has(id)) {
            const scripted = this.responses.get(id)
            this.responses.delete(id)
            socket.write(frame({ jsonrpc: '2.0', id, result: scripted }))
          } else {
            this.held.set(id, socket)
          }
          continue
        }
        const result = this.responses.has(id) ? this.responses.get(id) : this.defaultResult
        socket.write(frame({ jsonrpc: '2.0', id, result }))
      }
    })
    socket.on('close', () => this.clients.delete(socket))
    socket.on('error', () => {})
  }
}

/** Encode one JSON-RPC message as an LSP frame. */
export function frame(message: unknown): Buffer {
  return frameRaw(JSON.stringify(message))
}

/** Encode raw JSON text as an LSP frame. */
function frameRaw(jsonText: string): Buffer {
  const body = Buffer.from(jsonText, 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/** Try to decode the next frame from a buffer; undefined when incomplete. */
function takeFrame(buffer: Buffer): { message: FakeInbound; rest: Buffer } | undefined {
  const sep = buffer.indexOf('\r\n\r\n')
  if (sep < 0) return undefined
  const match = /Content-Length: (\d+)/i.exec(buffer.toString('ascii', 0, sep))
  if (!match) throw new Error('fake server: missing Content-Length')
  const length = Number(match[1])
  const start = sep + 4
  if (buffer.length < start + length) return undefined
  const body = buffer.toString('utf8', start, start + length)
  const json = JSON.parse(body) as { id?: number; method?: string; params?: unknown }
  return {
    message: {
      kind: json.id !== undefined ? 'request' : 'notify',
      // exactOptionalPropertyTypes: omit the id field entirely for notifications.
      ...(json.id !== undefined ? { id: json.id } : {}),
      method: json.method ?? '',
      params: json.params,
      raw: body,
    },
    rest: buffer.subarray(start + length),
  }
}
