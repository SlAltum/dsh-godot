/**
 * A scripted fake Godot game for the interactive session tests (T21): a TCP
 * client that connects INTO the controller's port and answers each command
 * with test-controlled frames, encoded/decoded by the REAL codecs (so the
 * session's wire handling is exercised). Unlike FakeGame (recorded byte
 * streams, one-shot replay), the scripted game supports arbitrary interactive
 * sequences: the test drives `debugEnter` explicitly and inspects the
 * received command log.
 */

import { connect, type Socket } from 'node:net'
import { VariantEncoder } from '../../src/variant-encoder.ts'
import { VariantDecoder } from '../../src/variant-decoder.ts'
import type { DecodedVariant } from '../../src/variant-decoder.ts'

/** The commands the game received, in order (decoded params). */
export type ReceivedCommand = { cmd: string; params: DecodedVariant[] }

export class ScriptedGame {
  private socket: Socket | undefined
  private readonly encoder = new VariantEncoder()
  private readonly decoder = new VariantDecoder()
  private readonly receivedLog: ReceivedCommand[] = []
  private stash = Buffer.alloc(0)
  private dataEvents = 0

  /** Handler invoked per received command (may send responses). */
  constructor(
    private readonly onCommand?: (cmd: string, params: DecodedVariant[], game: ScriptedGame) => void,
  ) {}

  /** The commands received so far. */
  received(): ReceivedCommand[] {
    return this.receivedLog
  }

  /** How many raw data events arrived (diagnostics). */
  dataEventCount(): number {
    return this.dataEvents
  }

  /** The peer port this game's socket connected to (diagnostics). */
  remotePort(): number | undefined {
    return this.socket?.remotePort
  }

  /** Connect into the controller's port (retries while the listener comes up). */
  async connectTo(port: number): Promise<void> {
    const deadline = Date.now() + 10_000
    for (;;) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = connect(port, '127.0.0.1')
          socket.once('connect', () => { resolve() })
          socket.once('error', reject)
          this.socket = socket
        })
        break
      } catch {
        if (Date.now() > deadline) throw new Error(`scripted game: could not connect to ${port}`)
        await new Promise((resolve) => { setTimeout(resolve, 50) })
      }
    }
    const socket = this.socket as Socket
    socket.on('data', (chunk) => { this.onData(chunk) })
    socket.on('error', () => {})
  }

  /** Send one protocol message to the controller. */
  send(cmd: string, params: unknown[] = [], threadId = 1): void {
    this.socket?.write(this.encoder.encodeMessage([cmd, threadId, params]))
  }

  /** The game announced itself (T3: `set_pid` carries the thread id). */
  setPid(threadId = 1): void {
    this.send('set_pid', [], threadId)
  }

  /** One `debug_enter` pause (T3.0: msg[1] = paused thread id; params =
   *  [isUserBreakpoint, reason, true, 1]). */
  debugEnter(isUserBreakpoint: boolean, reason: string, threadId = 1): void {
    this.send('debug_enter', [isUserBreakpoint, reason, true, 1], threadId)
  }

  /** The `stack_dump` params: `[N, file, line, func, ...]` (1-based line). */
  stackDump(frames: { file: string; line: number; func: string }[]): void {
    const params: unknown[] = [frames.length]
    for (const f of frames) params.push(f.file, f.line, f.func)
    this.send('stack_dump', params)
  }

  /** The `stack_frame_vars` count announcement. */
  stackFrameVars(count: number): void {
    this.send('stack_frame_vars', [count])
  }

  /** One `stack_frame_var`: `[name, scope(0|1|2), typeCode, value, className?]`. */
  stackFrameVar(name: string, scope: number, value: unknown, className?: string): void {
    this.send('stack_frame_var', className === undefined ? [name, scope, 0, value] : [name, scope, 0, value, className])
  }

  /** One `scene:inspect_object` response: `[id, className, props]` where each
   *  prop is `[name, typeCode, hint, hintString, usage, value]` (T5.0). */
  inspectObject(id: bigint | number, className: string, props: unknown[][]): void {
    this.send('scene:inspect_object', [id, className, props])
  }

  /** Drop the connection (game exit / disconnect). */
  close(): void {
    this.socket?.destroy()
  }

  private onData(chunk: Buffer): void {
    this.dataEvents++
    this.stash = Buffer.concat([this.stash, chunk])
    for (;;) {
      if (this.stash.length < 4) break
      const len = this.stash.readUInt32LE(0)
      if (this.stash.length < 4 + len) break
      const payload = this.stash.subarray(4, 4 + len)
      this.stash = this.stash.subarray(4 + len)
      // decodeMessage expects the payload AFTER the [u32 LE len] header.
      const msg = this.decoder.decodeMessage(payload)
      if (typeof msg[0] !== 'string') return
      const params = Array.isArray(msg[2]) ? msg[2] : []
      this.receivedLog.push({ cmd: msg[0], params })
      this.onCommand?.(msg[0], params, this)
    }
  }
}
