// One-shot: backfill JSDoc for exported declarations the export-jsdoc gate
// flags in tool-godot-debug (ported classes kept minimal comments). Inserts a
// class-level comment when the declaration is not already preceded by one.
import { readFileSync, writeFileSync } from 'node:fs'

const files = {
  'packages/godot/tool-godot-debug/src/variants.ts': [
    ['Vector2', 'A decoded Godot Vector2 value (protocol display shape).'],
    ['Vector2i', 'A decoded Godot Vector2i value (protocol display shape).'],
    ['Vector3', 'A decoded Godot Vector3 value (protocol display shape).'],
    ['Vector3i', 'A decoded Godot Vector3i value (protocol display shape).'],
    ['Vector4', 'A decoded Godot Vector4 value (protocol display shape).'],
    ['Vector4i', 'A decoded Godot Vector4i value (protocol display shape).'],
    ['Rect2', 'A decoded Godot Rect2 value (protocol display shape).'],
    ['Rect2i', 'A decoded Godot Rect2i value (protocol display shape).'],
    ['Basis', 'A decoded Godot Basis value (protocol display shape).'],
    ['AABB', 'A decoded Godot AABB value (protocol display shape).'],
    ['Transform3D', 'A decoded Godot Transform3D value (protocol display shape).'],
    ['Transform2D', 'A decoded Godot Transform2D value (protocol display shape).'],
    ['Plane', 'A decoded Godot Plane value (protocol display shape).'],
    ['Quat', 'A decoded Godot quaternion value (protocol display shape).'],
    ['Projection', 'A decoded Godot Projection value (protocol display shape).'],
    ['Color', 'A decoded Godot Color value (protocol display shape).'],
    ['NodePath', 'A decoded Godot NodePath value (protocol display shape).'],
    ['StringName', 'A decoded Godot StringName value (protocol display shape).'],
    ['Callable', 'A decoded Godot Callable value (protocol display shape).'],
    ['Signal', 'A decoded Godot Signal value (protocol display shape).'],
  ],
  'packages/godot/tool-godot-debug/src/variant-decoder.ts': [
    ['VariantDecoder', 'Decodes variant-encoded frame payloads into structured values (see variants.ts).'],
  ],
  'packages/godot/tool-godot-debug/src/variant-encoder.ts': [
    ['VariantEncoder', 'Encodes command values into variant frames (primitives and arrays only).'],
  ],
}

for (const [file, decls] of Object.entries(files)) {
  let src = readFileSync(file, 'utf8')
  for (const [name, doc] of decls) {
    const re = new RegExp(`(^\\s*)export class ${name}\\b`, 'm')
    const match = re.exec(src)
    if (match === null) {
      console.log(`MISS ${file} ${name}`)
      continue
    }
    const before = src.slice(0, match.index)
    if (before.trimEnd().endsWith('*/')) continue // already documented
    const indent = match[1]
    src = src.slice(0, match.index) + `${indent}/** ${doc} */\n${indent}` + src.slice(match.index)
  }
  writeFileSync(file, src)
}
console.log('variants/decoder/encoder done')
