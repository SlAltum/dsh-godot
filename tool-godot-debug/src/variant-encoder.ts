/**
 * The Godot variant encoder: primitives, containers and — since Phase 12 —
 * the math types the decoder produces, so decoded containers can be rebuilt
 * after an edit (the whole-container write needs a symmetric codec). The
 * command messages are arrays of primitives (`breakpoint [path, line, bool]`,
 * `get_stack_dump []`); the math-type branches exist for `set_object_property`
 * values (T14.2). Two source-plugin bugs are fixed here (plan D12): strings
 * use byte-accurate lengths (`Buffer.byteLength`, the plugin's UTF-16
 * `str.length` truncated non-ASCII payloads and desynced the frame), and
 * `undefined` throws instead of emitting a zero-byte variant that disagrees
 * with its size precomputation.
 * @module @deepseek-ai/dsh-tool-godot-debug/variant-encoder
 */

import {
  GDScriptTypes, ENCODE_FLAG_64, StringName, Vector2, Vector2i, Vector3, Vector3i,
  Vector4, Vector4i, Rect2, Rect2i, Basis, AABB, Transform3D, Transform2D, Plane,
  Quat, Projection, Color,
} from './variants.ts'

/** A value the encoder can serialize. */
export type Encodable =
  | number | bigint | boolean | string | null
  | StringName | Vector2 | Vector2i | Vector3 | Vector3i | Vector4 | Vector4i
  | Rect2 | Rect2i | Basis | AABB | Transform3D | Transform2D | Plane | Quat
  | Projection | Color
  | Encodable[] | Map<unknown, unknown>

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
    // Math types (Phase 12): encoded float32 (matching the decoder's default
    // width and the source plugin's writer), integers for the *i variants.
    if (value instanceof Vector2i) {
      off = this.writeUInt32(off, GDScriptTypes.VECTOR2I, buffer)
      return this.encodeInt2(value, buffer, off)
    }
    if (value instanceof Vector3i) {
      off = this.writeUInt32(off, GDScriptTypes.VECTOR3I, buffer)
      return this.encodeInt3(value, buffer, off)
    }
    if (value instanceof Vector4i) {
      off = this.writeUInt32(off, GDScriptTypes.VECTOR4I, buffer)
      return this.encodeInt4(value, buffer, off)
    }
    if (value instanceof Rect2i) {
      off = this.writeUInt32(off, GDScriptTypes.RECT2I, buffer)
      return this.encodeInt2(value.size, buffer, this.encodeInt2(value.position, buffer, off))
    }
    if (value instanceof Vector2) {
      off = this.writeUInt32(off, GDScriptTypes.VECTOR2, buffer)
      return this.encodeVec2(value, buffer, off)
    }
    if (value instanceof Vector3) {
      off = this.writeUInt32(off, GDScriptTypes.VECTOR3, buffer)
      return this.encodeVec3(value, buffer, off)
    }
    if (value instanceof Vector4) {
      off = this.writeUInt32(off, GDScriptTypes.VECTOR4, buffer)
      return this.encodeVec4(value, buffer, off)
    }
    if (value instanceof Rect2) {
      off = this.writeUInt32(off, GDScriptTypes.RECT2, buffer)
      return this.encodeVec2(value.size, buffer, this.encodeVec2(value.position, buffer, off))
    }
    if (value instanceof Basis) {
      off = this.writeUInt32(off, GDScriptTypes.BASIS, buffer)
      return this.encodeVec3(value.z, buffer, this.encodeVec3(value.y, buffer, this.encodeVec3(value.x, buffer, off)))
    }
    if (value instanceof AABB) {
      off = this.writeUInt32(off, GDScriptTypes.AABB, buffer)
      return this.encodeVec3(value.size, buffer, this.encodeVec3(value.position, buffer, off))
    }
    if (value instanceof Transform3D) {
      off = this.writeUInt32(off, GDScriptTypes.TRANSFORM3D, buffer)
      return this.encodeVec3(
        value.origin, buffer,
        this.encodeVec3(value.basis.z, buffer, this.encodeVec3(value.basis.y, buffer, this.encodeVec3(value.basis.x, buffer, off))),
      )
    }
    if (value instanceof Transform2D) {
      off = this.writeUInt32(off, GDScriptTypes.TRANSFORM2D, buffer)
      return this.encodeVec2(value.y, buffer, this.encodeVec2(value.x, buffer, this.encodeVec2(value.origin, buffer, off)))
    }
    if (value instanceof Plane) {
      off = this.writeUInt32(off, GDScriptTypes.PLANE, buffer)
      return this.encodeF32(
        value.d, buffer,
        this.encodeF32(value.z, buffer, this.encodeF32(value.y, buffer, this.encodeF32(value.x, buffer, off))),
      )
    }
    if (value instanceof Quat) {
      off = this.writeUInt32(off, GDScriptTypes.QUATERNION, buffer)
      return this.encodeF32(
        value.w, buffer,
        this.encodeF32(value.z, buffer, this.encodeF32(value.y, buffer, this.encodeF32(value.x, buffer, off))),
      )
    }
    if (value instanceof Projection) {
      off = this.writeUInt32(off, GDScriptTypes.PROJECTION, buffer)
      return this.encodeVec4(
        value.w, buffer,
        this.encodeVec4(value.z, buffer, this.encodeVec4(value.y, buffer, this.encodeVec4(value.x, buffer, off))),
      )
    }
    if (value instanceof Color) {
      off = this.writeUInt32(off, GDScriptTypes.COLOR, buffer)
      return this.encodeF32(
        value.a, buffer,
        this.encodeF32(value.b, buffer, this.encodeF32(value.g, buffer, this.encodeF32(value.r, buffer, off))),
      )
    }
    if (value === undefined) {
      throw new Error('variant-encoder: cannot encode undefined (would emit a size-mismatched frame)')
    }
    throw new Error(`variant-encoder: unsupported value type ${typeof value}`)
  }

  private encodeInt2(value: Vector2i, buffer: Buffer, offset: number): number {
    buffer.writeInt32LE(value.x, offset)
    buffer.writeInt32LE(value.y, offset + 4)
    return offset + 8
  }

  private encodeInt3(value: Vector3i, buffer: Buffer, offset: number): number {
    buffer.writeInt32LE(value.x, offset)
    buffer.writeInt32LE(value.y, offset + 4)
    buffer.writeInt32LE(value.z, offset + 8)
    return offset + 12
  }

  private encodeInt4(value: Vector4i, buffer: Buffer, offset: number): number {
    buffer.writeInt32LE(value.x, offset)
    buffer.writeInt32LE(value.y, offset + 4)
    buffer.writeInt32LE(value.z, offset + 8)
    buffer.writeInt32LE(value.w, offset + 12)
    return offset + 16
  }

  private encodeF32(v: number, buffer: Buffer, offset: number): number {
    buffer.writeFloatLE(v, offset)
    return offset + 4
  }

  private encodeVec2(value: Vector2, buffer: Buffer, offset: number): number {
    return this.encodeF32(value.y, buffer, this.encodeF32(value.x, buffer, offset))
  }

  private encodeVec3(value: Vector3, buffer: Buffer, offset: number): number {
    return this.encodeF32(value.z, buffer, this.encodeF32(value.y, buffer, this.encodeF32(value.x, buffer, offset)))
  }

  private encodeVec4(value: Vector4, buffer: Buffer, offset: number): number {
    return this.encodeF32(
      value.w, buffer,
      this.encodeF32(value.z, buffer, this.encodeF32(value.y, buffer, this.encodeF32(value.x, buffer, offset))),
    )
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
    if (typeof value === 'bigint') return 12 // INT64: type + 8-byte payload
    if (typeof value === 'boolean') return 8
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
    // Math types (Phase 12): type word + flat components (int32/float32).
    if (value instanceof Vector2i || value instanceof Vector2) return 12
    if (value instanceof Vector3i || value instanceof Vector3) return 16
    if (value instanceof Vector4i || value instanceof Vector4) return 20
    if (value instanceof Rect2i || value instanceof Rect2) return 20
    if (value instanceof Plane || value instanceof Quat || value instanceof Color) return 20
    if (value instanceof AABB || value instanceof Transform2D) return 28
    if (value instanceof Basis) return 40
    if (value instanceof Transform3D) return 52
    if (value instanceof Projection) return 68
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
