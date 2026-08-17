/**
 * A fake Godot game for controller tests: a TCP client that connects to the
 * controller's listening port and replays the recorded byte stream. On
 * connect it sends the `connect`-triggered frames; after each decoded command
 * it sends the frames whose manifest trigger matches that command (e.g.
 * `get_stack_dump` → the stack_dump frame). `scene:inspect_object` responses
 * are dispatched by the REQUESTED object id (manifest trigger `inspect:<id>`)
 * so several serial expansions replay correctly (Phase 5, plan M5). The
 * replayed bytes are the real-Godot recording, so the controller's decoding
 * is validated against ground truth, not against its own encoder.
 */

import { connect, createServer, type Socket } from 'node:net'
import { VariantDecoder } from '../../src/variant-decoder.ts'

export interface FixtureFrame {
  cmd: string
  trigger: string
  offset: number
  len: number
}

export class FakeGame {
  private socket: Socket | undefined
  private decoder = new VariantDecoder()
  private replayed = new Set<string>()

  constructor(
    private bin: Buffer,
    private manifest: FixtureFrame[],
  ) {}

  /** Pre-select a free port the tool will bind (bind-probe, like pickFreePort). */
  async connectPort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    const address = server.address()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    if (address === null || typeof address === 'string') throw new Error('fake game: no port')
    return address.port
  }

  /** Connect to the controller's port and start replaying. Retries while the
   *  tool's listener comes up (the port is pre-picked but not yet bound when
   *  the caller fires the connection). */
  async connect(port: number): Promise<void> {
    const deadline = Date.now() + 10_000
    for (;;) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = connect(port, '127.0.0.1')
          socket.once('connect', () => {
            resolve()
          })
          socket.once('error', reject)
          this.socket = socket
        })
        break
      } catch {
        if (Date.now() > deadline) throw new Error(`fake game: could not connect to ${port}`)
        await new Promise((resolve) => {
          setTimeout(resolve, 100)
        })
      }
    }
    this.replay('connect')
    const socket = this.socket as Socket
    let stash = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      stash = Buffer.concat([stash, chunk])
      for (;;) {
        if (stash.length < 4) break
        const len = stash.readUInt32LE(0)
        if (stash.length < 4 + len) break
        const payload = stash.subarray(4, 4 + len)
        stash = stash.subarray(4 + len)
        const { command, inspectId } = this.commandInfo(payload)
        this.replay(inspectId !== null ? `inspect:${inspectId}` : command)
      }
    })
    socket.on('error', () => {})
  }

  async dispose(): Promise<void> {
    this.socket?.destroy()
  }

  private commandInfo(payload: Buffer): { command: string; inspectId: string | null } {
    const msg = this.decoder.decodeMessage(payload)
    if (typeof msg[0] !== 'string') throw new Error(`fake game: non-string command of type ${typeof msg[0]}`)
    let inspectId: string | null = null
    if (msg[0] === 'scene:inspect_object' && Array.isArray(msg[2]) && typeof msg[2][0] === 'bigint') {
      inspectId = msg[2][0].toString()
    }
    return { command: msg[0], inspectId }
  }

  private replay(trigger: string): void {
    if (this.socket === undefined) return
    // Stop-producing triggers (connect, continue) replay once — the recording
    // has a finite number of stops and a repeated `continue` must not
    // fabricate more. Request responses replay on every command, because the
    // pipeline re-requests dump/vars at each stop.
    if ((trigger === 'connect' || trigger === 'continue') && this.replayed.has(trigger)) return
    this.replayed.add(trigger)
    for (const frame of this.manifest) {
      if (frame.trigger !== trigger) continue
      this.socket.write(this.bin.subarray(frame.offset, frame.offset + frame.len))
    }
  }
}
