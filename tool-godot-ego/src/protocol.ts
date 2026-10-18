/**
 * Newline-delimited JSON framing for the ego bridge (plan §5.2). Pure
 * functions only — no sockets, no Node imports — so both the session and the
 * tests can own the same encoding rules.
 *
 * One request is one line: `{"id":<int>,"cmd":"<name>",...params}`. One reply
 * is one line: `{"id":<int>,"ok":true,...}` or
 * `{"id":<int>,"ok":false,"code":"...","message":"..."}`. Events (the
 * handshake) carry `{"event":"hello",...}` and no id.
 * @module @deepseek-ai/dsh-tool-godot-ego/protocol
 */

/** The only bridge protocol version this host speaks. */
export const EGO_PROTOCOL_VERSION = 1

/** Default cap on one buffered line (a 4K WebP frame is far below this). */
export const DEFAULT_MAX_LINE_CHARS = 8_000_000

/** A decoded bridge event (currently only `hello`). */
export interface BridgeEvent {
  readonly kind: 'event'
  readonly event: string
  readonly payload: Readonly<Record<string, unknown>>
}

/** A successful reply. */
export interface BridgeOk {
  readonly kind: 'ok'
  readonly id: number
  readonly payload: Readonly<Record<string, unknown>>
}

/** A rejected reply (`ok: false`). */
export interface BridgeError {
  readonly kind: 'error'
  readonly id: number
  readonly code: string
  readonly message: string
}

/** Every shape a decoded line can take. */
export type BridgeReply = BridgeEvent | BridgeOk | BridgeError

/**
 * Encode one command line.
 * @param id - the request id (positive integer; replies are matched by it).
 * @param cmd - the command name.
 * @param params - command parameters (spread after `id`/`cmd`).
 * @returns the line, including the trailing newline.
 * @throws Error when the id or command name is invalid.
 */
export function encodeCommand(id: number, cmd: string, params: Readonly<Record<string, unknown>> = {}): string {
  if (!Number.isInteger(id) || id < 1) throw new Error('ego protocol: command id must be a positive integer')
  if (cmd.length === 0) throw new Error('ego protocol: command name must be non-empty')
  return `${JSON.stringify({ ...params, id, cmd })}\n`
}

/**
 * Narrow one decoded JSON value to a {@link BridgeReply}.
 * @param raw - the parsed JSON value (any shape).
 * @returns the reply, or `undefined` for anything that is not a bridge line.
 */
export function parseReply(raw: unknown): BridgeReply | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.event === 'string' && record.event.length > 0) {
    return { kind: 'event', event: record.event, payload: record }
  }
  if (!isPositiveInteger(record.id) || typeof record.ok !== 'boolean') return undefined
  if (record.ok) return { kind: 'ok', id: record.id, payload: record }
  if (typeof record.code !== 'string' || typeof record.message !== 'string') return undefined
  return { kind: 'error', id: record.id, code: record.code, message: record.message }
}

/**
 * Incremental line splitter for the bridge stream.
 *
 * Complete lines are returned in arrival order; `\r\n` is normalized and blank
 * lines are dropped. A line longer than the cap (or a buffer that exceeds it
 * without a newline) flags {@link overflow} and discards the buffer: the
 * session treats that as a protocol failure instead of growing without bound.
 */
export class LineDecoder {
  private buffer = ''
  private overflowed = false

  /**
   * @param maxLineChars - per-line and buffered-tail cap in characters.
   */
  constructor(private readonly maxLineChars: number = DEFAULT_MAX_LINE_CHARS) {}

  /** Whether a cap was exceeded since the last {@link reset}. */
  get overflow(): boolean {
    return this.overflowed
  }

  /**
   * Append one chunk and return every complete line it revealed.
   * @param chunk - decoded text from the socket.
   * @returns the complete non-empty lines.
   */
  push(chunk: string): string[] {
    if (this.overflowed) return []
    this.buffer += chunk
    const lines: string[] = []
    let at = this.buffer.indexOf('\n')
    while (at >= 0) {
      const line = this.buffer.slice(0, at).replace(/\r$/, '')
      this.buffer = this.buffer.slice(at + 1)
      if (line.length > this.maxLineChars) {
        this.fail()
        return lines
      }
      if (line.length > 0) lines.push(line)
      at = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > this.maxLineChars) {
      this.fail()
      return lines
    }
    return lines
  }

  /** Drop buffered text and clear the overflow flag (a new connection). */
  reset(): void {
    this.buffer = ''
    this.overflowed = false
  }

  /** Flag the cap and drop the buffered tail. */
  private fail(): void {
    this.overflowed = true
    this.buffer = ''
  }
}

/** Whether a value is a non-negative integer (Node's `Number.isInteger` semantics). */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
