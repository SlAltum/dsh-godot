/**
 * The Godot variant decoder: binary frame payloads → structured values.
 * Ported from godot-vscode-plugin's `variables/variant_decoder.ts` with one
 * deliberate fix: `PACKED_FLOAT64_ARRAY` decodes with 64-bit reads (the
 * source plugin's branch called the 32-bit decoder, see plan D12). Null (NIL)
 * decodes as `null`, never `undefined`, so callers can distinguish "no value"
 * from a missing field.
 * @module @deepseek-ai/dsh-tool-godot-debug/variant-decoder
 */

import {
  GDScriptTypes,
  type BufferModel,
  Vector3,
  Vector2,
  Basis,
  AABB,
  Color,
  NodePath,
  ObjectId,
  Plane,
  Quat,
  Rect2,
  Transform3D,
  Transform2D,
  RawObject,
  Vector2i,
  Vector3i,
  Rect2i,
  Vector4,
  Vector4i,
  StringName,
  Projection,
  ENCODE_FLAG_64,
  ENCODE_FLAG_OBJECT_AS_ID,
  ENCODE_FLAG_TYPED_ARRAY_MASK,
  ENCODE_FLAG_TYPED_DICT_MASK,
  RID,
  Callable,
  Signal,
} from './variants.ts'

/** Any value the protocol can carry into a decoded message. */
export type DecodedVariant =
  | string
  | number
  | bigint
  | boolean
  | null
  | DecodedVariant[]
  | Map<DecodedVariant, DecodedVariant>
  | Vector2
  | Rect2
  | Vector3
  | Transform2D
  | Plane
  | Vector4
  | Quat
  | AABB
  | Basis
  | Transform3D
  | Projection
  | Color
  | StringName
  | NodePath
  | ObjectId
  | RawObject
  | Callable
  | Signal

/** Decodes variant-encoded frame payloads into structured values (see variants.ts). */


export class VariantDecoder {
  /**
   * Decode exactly one variant from a self-contained buffer.
   * @param payload - the variant's bytes (no length prefix).
   * @returns the decoded value.
   * @throws Error on a truncated or unknown-type payload.
   */
  decodeVariant(payload: Buffer): DecodedVariant {
    const model: BufferModel = { buffer: payload, offset: 0, len: payload.length }
    const value = this.decode(model)
    return value
  }

  /**
   * Decode a full message frame payload into the message array. A frame
   * carries exactly one variant — the command array `[command, threadId?,
   * params]` (pinned by T3.0 frame analysis).
   * @param payload - the frame payload after the `[u32 LE len]` header.
   * @returns the message array.
   * @throws Error when the frame carries more than one top-level variant.
   */
  decodeMessage(payload: Buffer): DecodedVariant[] {
    const model: BufferModel = { buffer: payload, offset: 0, len: payload.length }
    const out: DecodedVariant[] = []
    while (model.len > 0) out.push(this.decode(model))
    if (out.length !== 1) throw new Error(`frame carried ${out.length} top-level variants, expected 1`)
    return out[0] as DecodedVariant[]
  }

  /** Decode one variant at the cursor. */
  private decode(model: BufferModel): DecodedVariant {
    const type = this.decodeUInt32(model)
    switch (type & 0xff) {
      case GDScriptTypes.NIL:
        return null
      case GDScriptTypes.BOOL:
        return this.decodeUInt32(model) !== 0
      case GDScriptTypes.INT:
        return type & ENCODE_FLAG_64 ? this.decodeInt64(model) : this.decodeInt32(model)
      case GDScriptTypes.FLOAT:
        return type & ENCODE_FLAG_64 ? this.decodeFloat64(model) : this.decodeFloat32(model)
      case GDScriptTypes.STRING:
        return this.decodeString(model)
      case GDScriptTypes.VECTOR2:
        return type & ENCODE_FLAG_64 ? this.decodeVector2d(model) : this.decodeVector2f(model)
      case GDScriptTypes.VECTOR2I:
        return new Vector2i(this.decodeInt32(model), this.decodeInt32(model))
      case GDScriptTypes.RECT2:
        return type & ENCODE_FLAG_64 ? this.decodeRect2d(model) : this.decodeRect2f(model)
      case GDScriptTypes.RECT2I:
        return new Rect2i(this.decodeVector2i(model), this.decodeVector2i(model))
      case GDScriptTypes.VECTOR3:
        return type & ENCODE_FLAG_64 ? this.decodeVector3d(model) : this.decodeVector3f(model)
      case GDScriptTypes.VECTOR3I:
        return new Vector3i(this.decodeInt32(model), this.decodeInt32(model), this.decodeInt32(model))
      case GDScriptTypes.TRANSFORM2D:
        return type & ENCODE_FLAG_64 ? this.decodeTransform2Dd(model) : this.decodeTransform2Df(model)
      case GDScriptTypes.PLANE:
        return type & ENCODE_FLAG_64 ? this.decodePlaned(model) : this.decodePlanef(model)
      case GDScriptTypes.VECTOR4:
        return type & ENCODE_FLAG_64 ? this.decodeVector4d(model) : this.decodeVector4f(model)
      case GDScriptTypes.VECTOR4I:
        return new Vector4i(
          this.decodeInt32(model),
          this.decodeInt32(model),
          this.decodeInt32(model),
          this.decodeInt32(model),
        )
      case GDScriptTypes.QUATERNION:
        return type & ENCODE_FLAG_64 ? this.decodeQuaterniond(model) : this.decodeQuaternionf(model)
      case GDScriptTypes.AABB:
        return type & ENCODE_FLAG_64 ? this.decodeAABBd(model) : this.decodeAABBf(model)
      case GDScriptTypes.BASIS:
        return type & ENCODE_FLAG_64 ? this.decodeBasisd(model) : this.decodeBasisf(model)
      case GDScriptTypes.TRANSFORM3D:
        return type & ENCODE_FLAG_64 ? this.decodeTransform3Dd(model) : this.decodeTransform3Df(model)
      case GDScriptTypes.PROJECTION:
        return type & ENCODE_FLAG_64 ? this.decodeProjectiond(model) : this.decodeProjectionf(model)
      case GDScriptTypes.COLOR:
        return this.decodeColor(model)
      case GDScriptTypes.STRING_NAME:
        return new StringName(this.decodeString(model))
      case GDScriptTypes.NODE_PATH:
        return this.decodeNodePath(model)
      case GDScriptTypes.RID:
        return new RID(this.decodeUInt64(model))
      case GDScriptTypes.OBJECT:
        return type & ENCODE_FLAG_OBJECT_AS_ID
          ? new ObjectId(this.decodeUInt64(model))
          : this.decodeRawObject(model)
      case GDScriptTypes.CALLABLE:
        return new Callable()
      case GDScriptTypes.SIGNAL:
        return new Signal(this.decodeString(model), new ObjectId(this.decodeUInt64(model)))
      case GDScriptTypes.DICTIONARY:
        return this.decodeDictionary(model, type)
      case GDScriptTypes.ARRAY:
        return this.decodeArray(model, type)
      case GDScriptTypes.PACKED_BYTE_ARRAY:
        return this.decodePackedByteArray(model)
      case GDScriptTypes.PACKED_INT32_ARRAY:
        return this.decodePackedInt32Array(model)
      case GDScriptTypes.PACKED_INT64_ARRAY:
        return this.decodePackedInt64Array(model)
      case GDScriptTypes.PACKED_FLOAT32_ARRAY:
        return this.decodePackedFloat32Array(model)
      case GDScriptTypes.PACKED_FLOAT64_ARRAY:
        // Source-plugin bug fix: the original branch called the 32-bit
        // decoder, corrupting every 64-bit array payload (plan D12).
        return this.decodePackedFloat64Array(model)
      case GDScriptTypes.PACKED_STRING_ARRAY:
        return this.decodePackedStringArray(model)
      case GDScriptTypes.PACKED_VECTOR2_ARRAY:
        return type & ENCODE_FLAG_OBJECT_AS_ID ? this.decodePackedVector2dArray(model) : this.decodePackedVector2fArray(model)
      case GDScriptTypes.PACKED_VECTOR3_ARRAY:
        return type & ENCODE_FLAG_OBJECT_AS_ID ? this.decodePackedVector3dArray(model) : this.decodePackedVector3fArray(model)
      case GDScriptTypes.PACKED_COLOR_ARRAY:
        return this.decodePackedColorArray(model)
      case GDScriptTypes.PACKED_VECTOR4_ARRAY:
        return type & ENCODE_FLAG_OBJECT_AS_ID ? this.decodePackedVector4dArray(model) : this.decodePackedVector4fArray(model)
      default:
        throw new Error(`unknown variant type ${type & 0xff} (raw ${type})`)
    }
  }

  private decodeUInt32(model: BufferModel): number {
    const result = model.buffer.readUInt32LE(model.offset)
    model.len -= 4
    model.offset += 4
    return result
  }

  private decodeInt32(model: BufferModel): number {
    const result = model.buffer.readInt32LE(model.offset)
    model.len -= 4
    model.offset += 4
    return result
  }

  private decodeUInt64(model: BufferModel): bigint {
    const result = model.buffer.readBigUInt64LE(model.offset)
    model.len -= 8
    model.offset += 8
    return result
  }

  private decodeInt64(model: BufferModel): bigint {
    const result = model.buffer.readBigInt64LE(model.offset)
    model.len -= 8
    model.offset += 8
    return result
  }

  private decodeFloat32(model: BufferModel): number {
    const result = model.buffer.readFloatLE(model.offset)
    model.len -= 4
    model.offset += 4
    return result
  }

  private decodeFloat64(model: BufferModel): number {
    const result = model.buffer.readDoubleLE(model.offset)
    model.len -= 8
    model.offset += 8
    return result
  }

  private decodeString(model: BufferModel): string {
    let len = this.decodeUInt32(model)
    const pad = len % 4 === 0 ? 0 : 4 - (len % 4)
    const s = model.buffer.toString('utf8', model.offset, model.offset + len)
    len += pad
    model.offset += len
    model.len -= len
    return s
  }

  private decodeVector2f(model: BufferModel): Vector2 {
    return new Vector2(this.decodeFloat32(model), this.decodeFloat32(model))
  }

  private decodeVector2d(model: BufferModel): Vector2 {
    return new Vector2(this.decodeFloat64(model), this.decodeFloat64(model))
  }

  private decodeVector2i(model: BufferModel): Vector2i {
    return new Vector2i(this.decodeInt32(model), this.decodeInt32(model))
  }

  private decodeVector3f(model: BufferModel): Vector3 {
    return new Vector3(this.decodeFloat32(model), this.decodeFloat32(model), this.decodeFloat32(model))
  }

  private decodeVector3d(model: BufferModel): Vector3 {
    return new Vector3(this.decodeFloat64(model), this.decodeFloat64(model), this.decodeFloat64(model))
  }

  private decodeVector4f(model: BufferModel): Vector4 {
    return new Vector4(
      this.decodeFloat32(model),
      this.decodeFloat32(model),
      this.decodeFloat32(model),
      this.decodeFloat32(model),
    )
  }

  private decodeVector4d(model: BufferModel): Vector4 {
    return new Vector4(
      this.decodeFloat64(model),
      this.decodeFloat64(model),
      this.decodeFloat64(model),
      this.decodeFloat64(model),
    )
  }

  private decodeRect2f(model: BufferModel): Rect2 {
    return new Rect2(this.decodeVector2f(model), this.decodeVector2f(model))
  }

  private decodeRect2d(model: BufferModel): Rect2 {
    return new Rect2(this.decodeVector2d(model), this.decodeVector2d(model))
  }

  private decodePlanef(model: BufferModel): Plane {
    return new Plane(
      this.decodeFloat32(model),
      this.decodeFloat32(model),
      this.decodeFloat32(model),
      this.decodeFloat32(model),
    )
  }

  private decodePlaned(model: BufferModel): Plane {
    return new Plane(
      this.decodeFloat64(model),
      this.decodeFloat64(model),
      this.decodeFloat64(model),
      this.decodeFloat64(model),
    )
  }

  private decodeQuaternionf(model: BufferModel): Quat {
    return new Quat(
      this.decodeFloat32(model),
      this.decodeFloat32(model),
      this.decodeFloat32(model),
      this.decodeFloat32(model),
    )
  }

  private decodeQuaterniond(model: BufferModel): Quat {
    return new Quat(
      this.decodeFloat64(model),
      this.decodeFloat64(model),
      this.decodeFloat64(model),
      this.decodeFloat64(model),
    )
  }

  private decodeAABBf(model: BufferModel): AABB {
    return new AABB(this.decodeVector3f(model), this.decodeVector3f(model))
  }

  private decodeAABBd(model: BufferModel): AABB {
    return new AABB(this.decodeVector3d(model), this.decodeVector3d(model))
  }

  private decodeBasisf(model: BufferModel): Basis {
    return new Basis(this.decodeVector3f(model), this.decodeVector3f(model), this.decodeVector3f(model))
  }

  private decodeBasisd(model: BufferModel): Basis {
    return new Basis(this.decodeVector3d(model), this.decodeVector3d(model), this.decodeVector3d(model))
  }

  private decodeTransform2Df(model: BufferModel): Transform2D {
    return new Transform2D(this.decodeVector2f(model), this.decodeVector2f(model), this.decodeVector2f(model))
  }

  private decodeTransform2Dd(model: BufferModel): Transform2D {
    return new Transform2D(this.decodeVector2d(model), this.decodeVector2d(model), this.decodeVector2d(model))
  }

  private decodeTransform3Df(model: BufferModel): Transform3D {
    return new Transform3D(this.decodeBasisf(model), this.decodeVector3f(model))
  }

  private decodeTransform3Dd(model: BufferModel): Transform3D {
    return new Transform3D(this.decodeBasisd(model), this.decodeVector3d(model))
  }

  private decodeProjectionf(model: BufferModel): Projection {
    return new Projection(
      this.decodeVector4f(model),
      this.decodeVector4f(model),
      this.decodeVector4f(model),
      this.decodeVector4f(model),
    )
  }

  private decodeProjectiond(model: BufferModel): Projection {
    return new Projection(
      this.decodeVector4d(model),
      this.decodeVector4d(model),
      this.decodeVector4d(model),
      this.decodeVector4d(model),
    )
  }

  private decodeColor(model: BufferModel): Color {
    const rgb = this.decodeVector3f(model)
    return new Color(rgb.x, rgb.y, rgb.z, this.decodeFloat32(model))
  }

  private decodeNodePath(model: BufferModel): NodePath {
    const nameCount = this.decodeUInt32(model) & 0x7fffffff
    let subnameCount = this.decodeUInt32(model)
    const flags = this.decodeUInt32(model)
    const absolute = (flags & 1) === 1
    if (flags & 2) subnameCount++
    const total = nameCount + subnameCount
    const names: string[] = []
    const subNames: string[] = []
    for (let i = 0; i < total; i++) {
      const s = this.decodeString(model)
      if (i < nameCount) names.push(s)
      else subNames.push(s)
    }
    return new NodePath(names, subNames, absolute)
  }

  private decodeRawObject(model: BufferModel): RawObject {
    const className = this.decodeString(model)
    const propCount = this.decodeUInt32(model)
    const output = new RawObject(className)
    for (let i = 0; i < propCount; i++) {
      const name = this.decodeString(model)
      output.set(name, this.decode(model))
    }
    return output
  }

  private decodeContainerTypeFlag(model: BufferModel, type: number, bitOffset: number): void {
    const shifted = (type >> bitOffset) & 0b11
    if (shifted === 0) return // ContainerTypeFlags.NONE: no element type carried
    if (shifted === 1) this.decodeUInt32(model) // BUILTIN: type code
    else this.decodeString(model) // CLASS_NAME / SCRIPT
  }

  private decodeArray(model: BufferModel, type: number): DecodedVariant[] {
    if (type & ENCODE_FLAG_TYPED_ARRAY_MASK) {
      this.decodeContainerTypeFlag(model, type, 16)
    }
    const count = this.decodeUInt32(model)
    const output: DecodedVariant[] = []
    for (let i = 0; i < count; i++) output.push(this.decode(model))
    return output
  }

  private decodeDictionary(model: BufferModel, type: number): Map<DecodedVariant, DecodedVariant> {
    if (type & ENCODE_FLAG_TYPED_DICT_MASK) {
      this.decodeContainerTypeFlag(model, type, 16)
      this.decodeContainerTypeFlag(model, type, 18)
    }
    const count = this.decodeUInt32(model)
    const output = new Map<DecodedVariant, DecodedVariant>()
    for (let i = 0; i < count; i++) {
      const key = this.decode(model)
      const value = this.decode(model)
      output.set(key, value)
    }
    return output
  }

  private decodePackedByteArray(model: BufferModel): number[] {
    const count = this.decodeUInt32(model)
    const output: number[] = []
    for (let i = 0; i < count; i++) {
      output.push(model.buffer.readUInt8(model.offset))
      model.offset++
      model.len--
    }
    return output
  }

  private decodePackedInt32Array(model: BufferModel): number[] {
    const count = this.decodeUInt32(model)
    const output: number[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeInt32(model))
    return output
  }

  private decodePackedInt64Array(model: BufferModel): bigint[] {
    const count = this.decodeUInt32(model)
    const output: bigint[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeInt64(model))
    return output
  }

  private decodePackedFloat32Array(model: BufferModel): number[] {
    const count = this.decodeUInt32(model)
    const output: number[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeFloat32(model))
    return output
  }

  private decodePackedFloat64Array(model: BufferModel): number[] {
    const count = this.decodeUInt32(model)
    const output: number[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeFloat64(model))
    return output
  }

  private decodePackedStringArray(model: BufferModel): string[] {
    const count = this.decodeUInt32(model)
    const output: string[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeString(model))
    return output
  }

  private decodePackedVector2fArray(model: BufferModel): Vector2[] {
    const count = this.decodeUInt32(model)
    const output: Vector2[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeVector2f(model))
    return output
  }

  private decodePackedVector2dArray(model: BufferModel): Vector2[] {
    const count = this.decodeUInt32(model)
    const output: Vector2[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeVector2d(model))
    return output
  }

  private decodePackedVector3fArray(model: BufferModel): Vector3[] {
    const count = this.decodeUInt32(model)
    const output: Vector3[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeVector3f(model))
    return output
  }

  private decodePackedVector3dArray(model: BufferModel): Vector3[] {
    const count = this.decodeUInt32(model)
    const output: Vector3[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeVector3d(model))
    return output
  }

  private decodePackedVector4fArray(model: BufferModel): Vector4[] {
    const count = this.decodeUInt32(model)
    const output: Vector4[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeVector4f(model))
    return output
  }

  private decodePackedVector4dArray(model: BufferModel): Vector4[] {
    const count = this.decodeUInt32(model)
    const output: Vector4[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeVector4d(model))
    return output
  }

  private decodePackedColorArray(model: BufferModel): Color[] {
    const count = this.decodeUInt32(model)
    const output: Color[] = []
    for (let i = 0; i < count; i++) output.push(this.decodeColor(model))
    return output
  }
}
