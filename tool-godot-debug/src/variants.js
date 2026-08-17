/* oxlint-disable sonarjs/no-identical-functions -- protocol value classes
   project their own fields into sub_values; the identical bodies are the
   natural result of the Godot value shapes (e.g. Basis and Vector3 both have
   x/y/z members), not duplicated logic to extract. */
/**
 * The Godot variant type system: type codes, encoding flags, the buffer
 * cursor, and the structured value classes used by the debugger protocol.
 * Ported from godot-vscode-plugin's `variables/variants.ts` (semantics kept,
 * including the `stringify_value` display rounding) so the renderer can show
 * values the way Godot's own tooling does.
 * @module @deepseek-ai/dsh-tool-godot-debug/variants
 */
/** GDScript variant type codes as spoken by the debugger protocol. */
export const GDScriptTypes = {
    NIL: 0,
    BOOL: 1,
    INT: 2,
    FLOAT: 3,
    STRING: 4,
    VECTOR2: 5,
    VECTOR2I: 6,
    RECT2: 7,
    RECT2I: 8,
    VECTOR3: 9,
    VECTOR3I: 10,
    TRANSFORM2D: 11,
    VECTOR4: 12,
    VECTOR4I: 13,
    PLANE: 14,
    QUATERNION: 15,
    AABB: 16,
    BASIS: 17,
    TRANSFORM3D: 18,
    PROJECTION: 19,
    COLOR: 20,
    STRING_NAME: 21,
    NODE_PATH: 22,
    RID: 23,
    OBJECT: 24,
    CALLABLE: 25,
    SIGNAL: 26,
    DICTIONARY: 27,
    ARRAY: 28,
    PACKED_BYTE_ARRAY: 29,
    PACKED_INT32_ARRAY: 30,
    PACKED_INT64_ARRAY: 31,
    PACKED_FLOAT32_ARRAY: 32,
    PACKED_FLOAT64_ARRAY: 33,
    PACKED_STRING_ARRAY: 34,
    PACKED_VECTOR2_ARRAY: 35,
    PACKED_VECTOR3_ARRAY: 36,
    PACKED_COLOR_ARRAY: 37,
    PACKED_VECTOR4_ARRAY: 38,
};
/**
 * The 64-bit flag. Deliberately the same bit as `ENCODE_FLAG_OBJECT_AS_ID`
 * (the protocol reuses it): do not "fix" the collision — both consumers
 * (float/int width and object-as-id) read the same bit.
 */
export const ENCODE_FLAG_64 = 1 << 16;
/** Object values arrive as a uint64 id instead of an inline object. */
export const ENCODE_FLAG_OBJECT_AS_ID = 1 << 16;
/** Typed-array container type flags occupy bits 16-17. */
export const ENCODE_FLAG_TYPED_ARRAY_MASK = 0b11 << 16;
/** Typed-dictionary key/value type flags occupy bits 16-19. */
export const ENCODE_FLAG_TYPED_DICT_MASK = 0b1111 << 16;
/** How a typed container's element type is carried. */
export const ContainerTypeFlags = {
    NONE: 0,
    BUILTIN: 1,
    CLASS_NAME: 2,
    SCRIPT: 3,
};
/**
 * Format a number for display with significant digits instead of a fixed
 * decimal count (Phase 9): integers render verbatim, non-integers keep up to
 * `maxSignificantDigits` significant digits with trailing zeros removed.
 * This replaces the source plugin's `toFixed(1)` UI rounding (`0.123456` →
 * `0.1`) and the snapshot layer's `toFixed(5)` — 7 digits round-trip any
 * float32 value losslessly, and float32 wire artifacts (`0.10000000149011612`)
 * normalize back to `0.1`. Very large/small values fall through to JS
 * exponential form (`1e+21`, `1e-7`).
 * @param value - the number to format.
 * @param maxSignificantDigits - the significant-digit cap (default 7).
 * @returns the display string.
 */
export function formatNumber(value, maxSignificantDigits = 7) {
    if (Number.isInteger(value))
        return String(value);
    return String(Number.parseFloat(value.toPrecision(maxSignificantDigits)));
}
/** Round numbers for the math types' stringify_value (Phase 9: significant
 *  digits; the source plugin's toFixed(1) UI rounding is superseded). */
function clean_number(value) {
    return formatNumber(value);
}
/** A decoded object whose properties were inlined (class name + entries). */
export class RawObject extends Map {
    class_name;
    constructor(class_name) {
        super();
        this.class_name = class_name;
    }
}
/** A reference to a live Godot object by its uint64 id. */
export class ObjectId {
    id;
    constructor(id) {
        this.id = id;
    }
    stringify_value() {
        return `<${this.id}>`;
    }
    sub_values() {
        return [{ name: 'id', value: this.id }];
    }
    type_name() {
        return 'Object';
    }
}
/** A server-side resource id (renders like an ObjectId). */
export class RID extends ObjectId {
    type_name() {
        return 'RID';
    }
}
/** A decoded Godot Vector2 value (protocol display shape). */
export class Vector2 {
    x;
    y;
    constructor(x = 0.0, y = 0.0) {
        this.x = x;
        this.y = y;
    }
    stringify_value() {
        return `(${clean_number(this.x)}, ${clean_number(this.y)})`;
    }
    sub_values() {
        return [
            { name: 'x', value: this.x },
            { name: 'y', value: this.y },
        ];
    }
    type_name() {
        return 'Vector2';
    }
}
/** A decoded Godot Vector2i value (protocol display shape). */
export class Vector2i extends Vector2 {
    type_name() {
        return 'Vector2i';
    }
}
/** A decoded Godot Vector3 value (protocol display shape). */
export class Vector3 {
    x;
    y;
    z;
    constructor(x = 0.0, y = 0.0, z = 0.0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    stringify_value() {
        return `(${clean_number(this.x)}, ${clean_number(this.y)}, ${clean_number(this.z)})`;
    }
    sub_values() {
        return [
            { name: 'x', value: this.x },
            { name: 'y', value: this.y },
            { name: 'z', value: this.z },
        ];
    }
    type_name() {
        return 'Vector3';
    }
}
/** A decoded Godot Vector3i value (protocol display shape). */
export class Vector3i extends Vector3 {
    type_name() {
        return 'Vector3i';
    }
}
/** A decoded Godot Vector4 value (protocol display shape). */
export class Vector4 {
    x;
    y;
    z;
    w;
    constructor(x = 0.0, y = 0.0, z = 0.0, w = 0.0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
    stringify_value() {
        return `(${clean_number(this.x)}, ${clean_number(this.y)}, ${clean_number(this.z)}, ${clean_number(this.w)})`;
    }
    sub_values() {
        return [
            { name: 'x', value: this.x },
            { name: 'y', value: this.y },
            { name: 'z', value: this.z },
            { name: 'w', value: this.w },
        ];
    }
    type_name() {
        return 'Vector4';
    }
}
/** A decoded Godot Vector4i value (protocol display shape). */
export class Vector4i extends Vector4 {
    type_name() {
        return 'Vector4i';
    }
}
/** A decoded Godot Rect2 value (protocol display shape). */
export class Rect2 {
    position;
    size;
    constructor(position, size) {
        this.position = position;
        this.size = size;
    }
    stringify_value() {
        return `(${this.position.stringify_value()} - ${this.size.stringify_value()})`;
    }
    sub_values() {
        return [
            { name: 'position', value: this.position },
            { name: 'size', value: this.size },
        ];
    }
    type_name() {
        return 'Rect2';
    }
}
/** A decoded Godot Rect2i value (protocol display shape). */
export class Rect2i extends Rect2 {
    type_name() {
        return 'Rect2i';
    }
}
/** A decoded Godot Basis value (protocol display shape). */
export class Basis {
    x;
    y;
    z;
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    stringify_value() {
        return `(${this.x.stringify_value()}, ${this.y.stringify_value()}, ${this.z.stringify_value()})`;
    }
    sub_values() {
        return [
            { name: 'x', value: this.x },
            { name: 'y', value: this.y },
            { name: 'z', value: this.z },
        ];
    }
    type_name() {
        return 'Basis';
    }
}
/** A decoded Godot AABB value (protocol display shape). */
export class AABB {
    position;
    size;
    constructor(position, size) {
        this.position = position;
        this.size = size;
    }
    stringify_value() {
        return `(${this.position.stringify_value()}, ${this.size.stringify_value()})`;
    }
    sub_values() {
        return [
            { name: 'position', value: this.position },
            { name: 'size', value: this.size },
        ];
    }
    type_name() {
        return 'AABB';
    }
}
/** A decoded Godot Transform3D value (protocol display shape). */
export class Transform3D {
    basis;
    origin;
    constructor(basis, origin) {
        this.basis = basis;
        this.origin = origin;
    }
    stringify_value() {
        return `(${this.basis.stringify_value()} - ${this.origin.stringify_value()})`;
    }
    sub_values() {
        return [
            { name: 'basis', value: this.basis },
            { name: 'origin', value: this.origin },
        ];
    }
    type_name() {
        return 'Transform';
    }
}
/** A decoded Godot Transform2D value (protocol display shape). */
export class Transform2D {
    origin;
    x;
    y;
    constructor(origin, x, y) {
        this.origin = origin;
        this.x = x;
        this.y = y;
    }
    stringify_value() {
        return `(${this.origin.stringify_value()} - (${this.x.stringify_value()}, ${this.y.stringify_value()})`;
    }
    sub_values() {
        return [
            { name: 'origin', value: this.origin },
            { name: 'x', value: this.x },
            { name: 'y', value: this.y },
        ];
    }
    type_name() {
        return 'Transform2D';
    }
}
/** A decoded Godot Plane value (protocol display shape). */
export class Plane {
    x;
    y;
    z;
    d;
    constructor(x, y, z, d) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.d = d;
    }
    stringify_value() {
        return `(${clean_number(this.x)}, ${clean_number(this.y)}, ${clean_number(this.z)}, ${clean_number(this.d)})`;
    }
    sub_values() {
        return [
            { name: 'x', value: this.x },
            { name: 'y', value: this.y },
            { name: 'z', value: this.z },
            { name: 'd', value: this.d },
        ];
    }
    type_name() {
        return 'Plane';
    }
}
/** A decoded Godot quaternion value (protocol display shape). */
export class Quat {
    x;
    y;
    z;
    w;
    constructor(x, y, z, w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
    stringify_value() {
        return `(${clean_number(this.x)}, ${clean_number(this.y)}, ${clean_number(this.z)}, ${clean_number(this.w)})`;
    }
    sub_values() {
        return [
            { name: 'x', value: this.x },
            { name: 'y', value: this.y },
            { name: 'z', value: this.z },
            { name: 'w', value: this.w },
        ];
    }
    type_name() {
        return 'Quat';
    }
}
/** A decoded Godot Projection value (protocol display shape). */
export class Projection {
    x;
    y;
    z;
    w;
    constructor(x, y, z, w) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
    stringify_value() {
        return `(${this.x.stringify_value()}, ${this.y.stringify_value()}, ${this.z.stringify_value()}, ${this.w.stringify_value()})`;
    }
    sub_values() {
        return [
            { name: 'x', value: this.x },
            { name: 'y', value: this.y },
            { name: 'z', value: this.z },
            { name: 'w', value: this.w },
        ];
    }
    type_name() {
        return 'Projection';
    }
}
/** A decoded Godot Color value (protocol display shape). */
export class Color {
    r;
    g;
    b;
    a;
    constructor(r, g, b, a = 1.0) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }
    stringify_value() {
        return `(${clean_number(this.r)}, ${clean_number(this.g)}, ${clean_number(this.b)}, ${clean_number(this.a)})`;
    }
    sub_values() {
        return [
            { name: 'r', value: this.r },
            { name: 'g', value: this.g },
            { name: 'b', value: this.b },
            { name: 'a', value: this.a },
        ];
    }
    type_name() {
        return 'Color';
    }
}
/** A decoded Godot NodePath value (protocol display shape). */
export class NodePath {
    names;
    sub_names;
    absolute;
    constructor(names, sub_names, absolute) {
        this.names = names;
        this.sub_names = sub_names;
        this.absolute = absolute;
    }
    stringify_value() {
        return `(/${this.names.join('/')}${this.sub_names.length > 0 ? ':' : ''}${this.sub_names.join(':')})`;
    }
    sub_values() {
        return [
            { name: 'names', value: this.names },
            { name: 'sub_names', value: this.sub_names },
            { name: 'absolute', value: this.absolute },
        ];
    }
    type_name() {
        return 'NodePath';
    }
}
/** A decoded Godot StringName value (protocol display shape). */
export class StringName {
    value;
    constructor(value) {
        this.value = value;
    }
    stringify_value() {
        return this.value;
    }
    sub_values() {
        return [{ name: 'value', value: this.value }];
    }
    type_name() {
        return 'StringName';
    }
}
/** A decoded Godot Callable value (protocol display shape). */
export class Callable {
    stringify_value() {
        return '()';
    }
    sub_values() {
        return [];
    }
    type_name() {
        return 'Callable';
    }
}
/** A decoded Godot Signal value (protocol display shape). */
export class Signal {
    name;
    oid;
    constructor(name, oid) {
        this.name = name;
        this.oid = oid;
    }
    stringify_value() {
        return `(${this.name}, ${this.oid.stringify_value()})`;
    }
    sub_values() {
        return [];
    }
    type_name() {
        return 'Signal';
    }
}
