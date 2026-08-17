/**
 * The Godot variant decoder: binary frame payloads → structured values.
 * Ported from godot-vscode-plugin's `variables/variant_decoder.ts` with one
 * deliberate fix: `PACKED_FLOAT64_ARRAY` decodes with 64-bit reads (the
 * source plugin's branch called the 32-bit decoder, see plan D12). Null (NIL)
 * decodes as `null`, never `undefined`, so callers can distinguish "no value"
 * from a missing field.
 * @module @deepseek-ai/dsh-tool-godot-debug/variant-decoder
 */
import { GDScriptTypes, Vector3, Vector2, Basis, AABB, Color, NodePath, ObjectId, Plane, Quat, Rect2, Transform3D, Transform2D, RawObject, Vector2i, Vector3i, Rect2i, Vector4, Vector4i, StringName, Projection, ENCODE_FLAG_64, ENCODE_FLAG_OBJECT_AS_ID, ENCODE_FLAG_TYPED_ARRAY_MASK, ENCODE_FLAG_TYPED_DICT_MASK, RID, Callable, Signal, } from './variants.ts';
/** Decodes variant-encoded frame payloads into structured values (see variants.ts). */
export class VariantDecoder {
    /**
     * Decode exactly one variant from a self-contained buffer.
     * @param payload - the variant's bytes (no length prefix).
     * @returns the decoded value.
     * @throws Error on a truncated or unknown-type payload.
     */
    decodeVariant(payload) {
        const model = { buffer: payload, offset: 0, len: payload.length };
        const value = this.decode(model);
        return value;
    }
    /**
     * Decode a full message frame payload into the message array. A frame
     * carries exactly one variant — the command array `[command, threadId?,
     * params]` (pinned by T3.0 frame analysis).
     * @param payload - the frame payload after the `[u32 LE len]` header.
     * @returns the message array.
     * @throws Error when the frame carries more than one top-level variant.
     */
    decodeMessage(payload) {
        const model = { buffer: payload, offset: 0, len: payload.length };
        const out = [];
        while (model.len > 0)
            out.push(this.decode(model));
        if (out.length !== 1)
            throw new Error(`frame carried ${out.length} top-level variants, expected 1`);
        return out[0];
    }
    /** Decode one variant at the cursor. */
    decode(model) {
        const type = this.decodeUInt32(model);
        switch (type & 0xff) {
            case GDScriptTypes.NIL:
                return null;
            case GDScriptTypes.BOOL:
                return this.decodeUInt32(model) !== 0;
            case GDScriptTypes.INT:
                return type & ENCODE_FLAG_64 ? this.decodeInt64(model) : this.decodeInt32(model);
            case GDScriptTypes.FLOAT:
                return type & ENCODE_FLAG_64 ? this.decodeFloat64(model) : this.decodeFloat32(model);
            case GDScriptTypes.STRING:
                return this.decodeString(model);
            case GDScriptTypes.VECTOR2:
                return type & ENCODE_FLAG_64 ? this.decodeVector2d(model) : this.decodeVector2f(model);
            case GDScriptTypes.VECTOR2I:
                return new Vector2i(this.decodeInt32(model), this.decodeInt32(model));
            case GDScriptTypes.RECT2:
                return type & ENCODE_FLAG_64 ? this.decodeRect2d(model) : this.decodeRect2f(model);
            case GDScriptTypes.RECT2I:
                return new Rect2i(this.decodeVector2i(model), this.decodeVector2i(model));
            case GDScriptTypes.VECTOR3:
                return type & ENCODE_FLAG_64 ? this.decodeVector3d(model) : this.decodeVector3f(model);
            case GDScriptTypes.VECTOR3I:
                return new Vector3i(this.decodeInt32(model), this.decodeInt32(model), this.decodeInt32(model));
            case GDScriptTypes.TRANSFORM2D:
                return type & ENCODE_FLAG_64 ? this.decodeTransform2Dd(model) : this.decodeTransform2Df(model);
            case GDScriptTypes.PLANE:
                return type & ENCODE_FLAG_64 ? this.decodePlaned(model) : this.decodePlanef(model);
            case GDScriptTypes.VECTOR4:
                return type & ENCODE_FLAG_64 ? this.decodeVector4d(model) : this.decodeVector4f(model);
            case GDScriptTypes.VECTOR4I:
                return new Vector4i(this.decodeInt32(model), this.decodeInt32(model), this.decodeInt32(model), this.decodeInt32(model));
            case GDScriptTypes.QUATERNION:
                return type & ENCODE_FLAG_64 ? this.decodeQuaterniond(model) : this.decodeQuaternionf(model);
            case GDScriptTypes.AABB:
                return type & ENCODE_FLAG_64 ? this.decodeAABBd(model) : this.decodeAABBf(model);
            case GDScriptTypes.BASIS:
                return type & ENCODE_FLAG_64 ? this.decodeBasisd(model) : this.decodeBasisf(model);
            case GDScriptTypes.TRANSFORM3D:
                return type & ENCODE_FLAG_64 ? this.decodeTransform3Dd(model) : this.decodeTransform3Df(model);
            case GDScriptTypes.PROJECTION:
                return type & ENCODE_FLAG_64 ? this.decodeProjectiond(model) : this.decodeProjectionf(model);
            case GDScriptTypes.COLOR:
                return this.decodeColor(model);
            case GDScriptTypes.STRING_NAME:
                return new StringName(this.decodeString(model));
            case GDScriptTypes.NODE_PATH:
                return this.decodeNodePath(model);
            case GDScriptTypes.RID:
                return new RID(this.decodeUInt64(model));
            case GDScriptTypes.OBJECT:
                return type & ENCODE_FLAG_OBJECT_AS_ID
                    ? new ObjectId(this.decodeUInt64(model))
                    : this.decodeRawObject(model);
            case GDScriptTypes.CALLABLE:
                return new Callable();
            case GDScriptTypes.SIGNAL:
                return new Signal(this.decodeString(model), new ObjectId(this.decodeUInt64(model)));
            case GDScriptTypes.DICTIONARY:
                return this.decodeDictionary(model, type);
            case GDScriptTypes.ARRAY:
                return this.decodeArray(model, type);
            case GDScriptTypes.PACKED_BYTE_ARRAY:
                return this.decodePackedByteArray(model);
            case GDScriptTypes.PACKED_INT32_ARRAY:
                return this.decodePackedInt32Array(model);
            case GDScriptTypes.PACKED_INT64_ARRAY:
                return this.decodePackedInt64Array(model);
            case GDScriptTypes.PACKED_FLOAT32_ARRAY:
                return this.decodePackedFloat32Array(model);
            case GDScriptTypes.PACKED_FLOAT64_ARRAY:
                // Source-plugin bug fix: the original branch called the 32-bit
                // decoder, corrupting every 64-bit array payload (plan D12).
                return this.decodePackedFloat64Array(model);
            case GDScriptTypes.PACKED_STRING_ARRAY:
                return this.decodePackedStringArray(model);
            case GDScriptTypes.PACKED_VECTOR2_ARRAY:
                return type & ENCODE_FLAG_OBJECT_AS_ID ? this.decodePackedVector2dArray(model) : this.decodePackedVector2fArray(model);
            case GDScriptTypes.PACKED_VECTOR3_ARRAY:
                return type & ENCODE_FLAG_OBJECT_AS_ID ? this.decodePackedVector3dArray(model) : this.decodePackedVector3fArray(model);
            case GDScriptTypes.PACKED_COLOR_ARRAY:
                return this.decodePackedColorArray(model);
            case GDScriptTypes.PACKED_VECTOR4_ARRAY:
                return type & ENCODE_FLAG_OBJECT_AS_ID ? this.decodePackedVector4dArray(model) : this.decodePackedVector4fArray(model);
            default:
                throw new Error(`unknown variant type ${type & 0xff} (raw ${type})`);
        }
    }
    decodeUInt32(model) {
        const result = model.buffer.readUInt32LE(model.offset);
        model.len -= 4;
        model.offset += 4;
        return result;
    }
    decodeInt32(model) {
        const result = model.buffer.readInt32LE(model.offset);
        model.len -= 4;
        model.offset += 4;
        return result;
    }
    decodeUInt64(model) {
        const result = model.buffer.readBigUInt64LE(model.offset);
        model.len -= 8;
        model.offset += 8;
        return result;
    }
    decodeInt64(model) {
        const result = model.buffer.readBigInt64LE(model.offset);
        model.len -= 8;
        model.offset += 8;
        return result;
    }
    decodeFloat32(model) {
        const result = model.buffer.readFloatLE(model.offset);
        model.len -= 4;
        model.offset += 4;
        return result;
    }
    decodeFloat64(model) {
        const result = model.buffer.readDoubleLE(model.offset);
        model.len -= 8;
        model.offset += 8;
        return result;
    }
    decodeString(model) {
        let len = this.decodeUInt32(model);
        const pad = len % 4 === 0 ? 0 : 4 - (len % 4);
        const s = model.buffer.toString('utf8', model.offset, model.offset + len);
        len += pad;
        model.offset += len;
        model.len -= len;
        return s;
    }
    decodeVector2f(model) {
        return new Vector2(this.decodeFloat32(model), this.decodeFloat32(model));
    }
    decodeVector2d(model) {
        return new Vector2(this.decodeFloat64(model), this.decodeFloat64(model));
    }
    decodeVector2i(model) {
        return new Vector2i(this.decodeInt32(model), this.decodeInt32(model));
    }
    decodeVector3f(model) {
        return new Vector3(this.decodeFloat32(model), this.decodeFloat32(model), this.decodeFloat32(model));
    }
    decodeVector3d(model) {
        return new Vector3(this.decodeFloat64(model), this.decodeFloat64(model), this.decodeFloat64(model));
    }
    decodeVector4f(model) {
        return new Vector4(this.decodeFloat32(model), this.decodeFloat32(model), this.decodeFloat32(model), this.decodeFloat32(model));
    }
    decodeVector4d(model) {
        return new Vector4(this.decodeFloat64(model), this.decodeFloat64(model), this.decodeFloat64(model), this.decodeFloat64(model));
    }
    decodeRect2f(model) {
        return new Rect2(this.decodeVector2f(model), this.decodeVector2f(model));
    }
    decodeRect2d(model) {
        return new Rect2(this.decodeVector2d(model), this.decodeVector2d(model));
    }
    decodePlanef(model) {
        return new Plane(this.decodeFloat32(model), this.decodeFloat32(model), this.decodeFloat32(model), this.decodeFloat32(model));
    }
    decodePlaned(model) {
        return new Plane(this.decodeFloat64(model), this.decodeFloat64(model), this.decodeFloat64(model), this.decodeFloat64(model));
    }
    decodeQuaternionf(model) {
        return new Quat(this.decodeFloat32(model), this.decodeFloat32(model), this.decodeFloat32(model), this.decodeFloat32(model));
    }
    decodeQuaterniond(model) {
        return new Quat(this.decodeFloat64(model), this.decodeFloat64(model), this.decodeFloat64(model), this.decodeFloat64(model));
    }
    decodeAABBf(model) {
        return new AABB(this.decodeVector3f(model), this.decodeVector3f(model));
    }
    decodeAABBd(model) {
        return new AABB(this.decodeVector3d(model), this.decodeVector3d(model));
    }
    decodeBasisf(model) {
        return new Basis(this.decodeVector3f(model), this.decodeVector3f(model), this.decodeVector3f(model));
    }
    decodeBasisd(model) {
        return new Basis(this.decodeVector3d(model), this.decodeVector3d(model), this.decodeVector3d(model));
    }
    decodeTransform2Df(model) {
        return new Transform2D(this.decodeVector2f(model), this.decodeVector2f(model), this.decodeVector2f(model));
    }
    decodeTransform2Dd(model) {
        return new Transform2D(this.decodeVector2d(model), this.decodeVector2d(model), this.decodeVector2d(model));
    }
    decodeTransform3Df(model) {
        return new Transform3D(this.decodeBasisf(model), this.decodeVector3f(model));
    }
    decodeTransform3Dd(model) {
        return new Transform3D(this.decodeBasisd(model), this.decodeVector3d(model));
    }
    decodeProjectionf(model) {
        return new Projection(this.decodeVector4f(model), this.decodeVector4f(model), this.decodeVector4f(model), this.decodeVector4f(model));
    }
    decodeProjectiond(model) {
        return new Projection(this.decodeVector4d(model), this.decodeVector4d(model), this.decodeVector4d(model), this.decodeVector4d(model));
    }
    decodeColor(model) {
        const rgb = this.decodeVector3f(model);
        return new Color(rgb.x, rgb.y, rgb.z, this.decodeFloat32(model));
    }
    decodeNodePath(model) {
        const nameCount = this.decodeUInt32(model) & 0x7fffffff;
        let subnameCount = this.decodeUInt32(model);
        const flags = this.decodeUInt32(model);
        const absolute = (flags & 1) === 1;
        if (flags & 2)
            subnameCount++;
        const total = nameCount + subnameCount;
        const names = [];
        const subNames = [];
        for (let i = 0; i < total; i++) {
            const s = this.decodeString(model);
            if (i < nameCount)
                names.push(s);
            else
                subNames.push(s);
        }
        return new NodePath(names, subNames, absolute);
    }
    decodeRawObject(model) {
        const className = this.decodeString(model);
        const propCount = this.decodeUInt32(model);
        const output = new RawObject(className);
        for (let i = 0; i < propCount; i++) {
            const name = this.decodeString(model);
            output.set(name, this.decode(model));
        }
        return output;
    }
    decodeContainerTypeFlag(model, type, bitOffset) {
        const shifted = (type >> bitOffset) & 0b11;
        if (shifted === 0)
            return; // ContainerTypeFlags.NONE: no element type carried
        if (shifted === 1)
            this.decodeUInt32(model); // BUILTIN: type code
        else
            this.decodeString(model); // CLASS_NAME / SCRIPT
    }
    decodeArray(model, type) {
        if (type & ENCODE_FLAG_TYPED_ARRAY_MASK) {
            this.decodeContainerTypeFlag(model, type, 16);
        }
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decode(model));
        return output;
    }
    decodeDictionary(model, type) {
        if (type & ENCODE_FLAG_TYPED_DICT_MASK) {
            this.decodeContainerTypeFlag(model, type, 16);
            this.decodeContainerTypeFlag(model, type, 18);
        }
        const count = this.decodeUInt32(model);
        const output = new Map();
        for (let i = 0; i < count; i++) {
            const key = this.decode(model);
            const value = this.decode(model);
            output.set(key, value);
        }
        return output;
    }
    decodePackedByteArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++) {
            output.push(model.buffer.readUInt8(model.offset));
            model.offset++;
            model.len--;
        }
        return output;
    }
    decodePackedInt32Array(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeInt32(model));
        return output;
    }
    decodePackedInt64Array(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeInt64(model));
        return output;
    }
    decodePackedFloat32Array(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeFloat32(model));
        return output;
    }
    decodePackedFloat64Array(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeFloat64(model));
        return output;
    }
    decodePackedStringArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeString(model));
        return output;
    }
    decodePackedVector2fArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeVector2f(model));
        return output;
    }
    decodePackedVector2dArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeVector2d(model));
        return output;
    }
    decodePackedVector3fArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeVector3f(model));
        return output;
    }
    decodePackedVector3dArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeVector3d(model));
        return output;
    }
    decodePackedVector4fArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeVector4f(model));
        return output;
    }
    decodePackedVector4dArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeVector4d(model));
        return output;
    }
    decodePackedColorArray(model) {
        const count = this.decodeUInt32(model);
        const output = [];
        for (let i = 0; i < count; i++)
            output.push(this.decodeColor(model));
        return output;
    }
}
