/**
 * FrameAssembler: turns TCP chunks into complete `[u32 LE len][payload]`
 * frames. A chunk shorter than the 4-byte length prefix is held, never read —
 * the source plugin's split_buffers read UInt32LE on a short tail and threw
 * ERR_OUT_OF_RANGE (plan M11).
 * @module @deepseek-ai/dsh-tool-godot-debug/frames
 */

export class FrameAssembler {
  private stash: Buffer = Buffer.alloc(0)

  /** Bytes currently buffered (the incomplete frame's remainder). */
  buffered = 0

  /**
   * Feed a TCP chunk and return every completed payload (after the length
   * header). A trailing partial frame stays buffered until the next call.
   * @param chunk - new bytes from the socket.
   * @returns the complete frame payloads, in arrival order.
   */
  push(chunk: Buffer): Buffer[] {
    this.stash = this.stash.length === 0 ? chunk : Buffer.concat([this.stash, chunk])
    const out: Buffer[] = []
    while (this.stash.length >= 4) {
      const len = this.stash.readUInt32LE(0)
      if (this.stash.length < 4 + len) break
      out.push(this.stash.subarray(4, 4 + len))
      this.stash = this.stash.subarray(4 + len)
    }
    this.buffered = this.stash.length
    return out
  }
}
