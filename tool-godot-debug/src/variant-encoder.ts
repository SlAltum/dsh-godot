/**
 * The Godot variant encoder, trimmed to what the debug tool sends: the
 * command messages are arrays of primitives (`breakpoint [path, line, bool]`,
 * `get_stack_dump []`), so only numbers, bigints, booleans, strings, arrays,
 * dictionaries and null are encodable. Two source-plugin bugs are fixed here
 * (plan D12): strings use byte-accurate lengths (`Buffer.byteLength`, the
 * plugin's UTF-16 `str.length` truncated non-ASCII payloads and desynced the
 * frame), and `undefined` throws instead of emitting a zero-byte variant that
 * disagrees with its size precomputation.
 * @module @deepseek-ai/dsh-tool-godot-debug/variant-encoder
 */

import { GDScriptTypes, ENCODE_FLAG_64, StringName } from './variants.ts'

/** A value the encoder can serialize. */
export type Encodable = number | bigint | boolean | string | null | Encodable[] | Map<unknown, unknown> | StringName

/** Encodes command values into variant frames (primitives and arrays only). */


export class VariantEncoder {
  /**
   * Encode one variant as a self-contained buffer (no length prefix).
   * @param value - the value to encode.
   * @returns the variant bytes.
   * @throws Error on `undefined` (a size-mismatched frame) or an unsupported type.
   */
  encodeVariant(value: unknown): Buffer {
    const size = this.sizeVariant(value)
    const buffer = Buffer.alloc(size)
    this.encode(value, buffer, 0)
    return buffer
  }

  /**
   * Encode a full command message as a single ARRAY variant with a `[u32 LE
   * len][payload]` frame header. The message MUST be one array (the game's
   * `_read_in` rejects flat frames — T3.0 pinned).
   * @param message - the command array `[cmd, threadId?, params]`.
   * @returns the frame bytes (length prefix + payload).
   * @throws Error on `undefined` members or an unsupported member type.
   */
  encodeMessage(message: unknown[]): Buffer {
    const size = 4 + this.sizeVariant(message)
    const buffer = Buffer.alloc(size)
    buffer.writeUInt32LE(size - 4, 0)
    this.encode(message, buffer, 4)
    return buffer
  }

  private encode(value: unknown, buffer: Buffer, offset: number): number {
    let off = offset
    if (typeof value === 'number') {
      if (Number.isInteger(value) && (value > 2147483647 || value < -2147483648)) {
        // Out of int32 range: promote to a 64-bit int variant.
        off = this.writeUInt32(off, GDScriptTypes.INT | ENCODE_FLAG_64, buffer)
        buffer.writeBigInt64LE(BigInt(value), off)
        return off + 8
      }
      if (Number.isInteger(value)) {
        off = this.writeUInt32(off, GDScriptTypes.INT, buffer)
        buffer.writeInt32LE(value, off)
        return off + 4
      }
      off = this.writeUInt32(off, GDScriptTypes.FLOAT, buffer)
      buffer.writeFloatLE(value, off)
      return off + 4
    }
    if (typeof value === 'bigint') {
      off = this.writeUInt32(off, GDScriptTypes.INT | ENCODE_FLAG_64, buffer)
      buffer.writeBigInt64LE(value, off)
      return off + 8
    }
    if (typeof value === 'boolean') {
      off = this.writeUInt32(off, GDScriptTypes.BOOL, buffer)
      buffer.writeUInt32LE(value ? 1 : 0, off)
      return off + 4
    }
    if (typeof value === 'string') {
      off = this.writeUInt32(off, GDScriptTypes.STRING, buffer)
      return this.encodeString(value, buffer, off)
    }
    if (value === null) {
      return this.writeUInt32(off, GDScriptTypes.NIL, buffer)
    }
    if (Array.isArray(value)) {
      off = this.writeUInt32(off, GDScriptTypes.ARRAY, buffer)
      buffer.writeUInt32LE(value.length, off)
      off += 4
      for (const element of value) off = this.encode(element, buffer, off)
      return off
    }
    if (value instanceof Map) {
      off = this.writeUInt32(off, GDScriptTypes.DICTIONARY, buffer)
      buffer.writeUInt32LE(value.size, off)
      off += 4
      for (const [key, val] of value.entries()) {
        off = this.encode(key, buffer, off)
        off = this.encode(val, buffer, off)
      }
      return off
    }
    if (value instanceof StringName) {
      off = this.writeUInt32(off, GDScriptTypes.STRING_NAME, buffer)
      return this.encodeString(value.value, buffer, off)
    }
    if (value === undefined) {
      throw new Error('variant-encoder: cannot encode undefined (would emit a size-mismatched frame)')
    }
    throw new Error(`variant-encoder: unsupported value type ${typeof value}`)
  }

  private encodeString(s: string, buffer: Buffer, offset: number): number {
    const bytes = Buffer.byteLength(s, 'utf8')
    buffer.writeUInt32LE(bytes, offset)
    let off = offset + 4
    buffer.write(s, off, 'utf8')
    off += bytes
    // Padding is measured from the length-prefix start, like sizeString.
    let total = 4 + bytes
    while (total % 4) {
      total++
      buffer.writeUInt8(0, off)
      off++
    }
    return off
  }

  private sizeVariant(value: unknown): number {
    if (typeof value === 'number') {
      if (Number.isInteger(value) && (value > 2147483647 || value < -2147483648)) return 12 // 64-bit promotion
      return 8
    }
    if (typeof value === 'bigint' || typeof value === 'boolean') return 8
    if (typeof value === 'string') return 4 + this.sizeString(value)
    if (value === null) return 4
    if (Array.isArray(value)) {
      let size = 8
      for (const element of value) size += this.sizeVariant(element)
      return size
    }
    if (value instanceof Map) {
      let size = 8
      for (const [key, val] of value.entries()) {
        size += this.sizeVariant(key)
        size += this.sizeVariant(val)
      }
      return size
    }
    if (value instanceof StringName) return 4 + this.sizeString(value.value)
    if (value === undefined) {
      throw new Error('variant-encoder: cannot encode undefined (would emit a size-mismatched frame)')
    }
    throw new Error(`variant-encoder: unsupported value type ${typeof value}`)
  }

  private sizeString(s: string): number {
    let size = 4 + Buffer.byteLength(s, 'utf8')
    while (size % 4) size++
    return size
  }

  private writeUInt32(offset: number, value: number, buffer: Buffer): number {
    buffer.writeUInt32LE(value, offset)
    return offset + 4
  }
}
