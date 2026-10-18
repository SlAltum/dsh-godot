/**
 * In-process stand-in for the game-side bridge: connects to the host listener,
 * says hello, and answers commands with the configured replies. Used by the
 * session tests instead of spawning a real Godot process.
 */

import { connect } from 'node:net'
import type { Socket } from 'node:net'

/** One fake bridge configuration. */
export interface FakeBridgeOptions {
  /** Token echoed in `hello`. */
  readonly token: string
  /** Protocol version echoed in `hello` (default 1). */
  readonly protocol?: number
  /** Reported window size (default `[640, 400]`); any value exercises validation. */
  readonly window?: unknown
  /** Reported pid, or `undefined` to omit the field. */
  readonly pid?: number
  /** Send `hello` on connect (default true). */
  readonly sendHello?: boolean
  /** Return the reply body for one command, or `undefined` to stay silent. */
  readonly reply?: (command: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> | undefined
}

/** A live fake bridge. */
export interface FakeBridge {
  readonly socket: Socket
  /** Resolves when the host dropped the connection. */
  readonly closed: Promise<void>
  close(): void
}

/**
 * Connect to the host and start answering.
 * @param port - the host listener port.
 * @param options - handshake values and the reply function.
 * @returns the live fake.
 */
export function attachFakeBridge(port: number, options: FakeBridgeOptions): FakeBridge {
  const socket = connect({ host: '127.0.0.1', port })
  const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
  let buffer = ''
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let at = buffer.indexOf('\n')
    while (at >= 0) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      if (line.trim() === '') continue
      let command: Record<string, unknown>
      try {
        command = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      const reply = options.reply?.(command)
      if (reply !== undefined) socket.write(`${JSON.stringify({ ...reply, id: command.id })}\n`)
    }
  })
  socket.on('error', () => { /* the host-side close is what the tests assert */ })
  socket.on('connect', () => {
    if (options.sendHello === false) return
    const hello: Record<string, unknown> = {
      event: 'hello',
      token: options.token,
      protocol: options.protocol ?? 1,
    }
    if (options.window !== undefined) hello.window = options.window
    if (options.pid !== undefined) hello.pid = options.pid
    socket.write(`${JSON.stringify(hello)}\n`)
  })
  return { socket, closed, close: () => { socket.destroy() } }
}
