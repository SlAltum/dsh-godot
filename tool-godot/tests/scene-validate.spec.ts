/** Structural scene validation: the rules the feedback asked for, without an engine. */

import { describe, expect, it } from 'vitest'
import { parseSceneDocument, validateSceneText } from '../src/scene-validate.ts'

/** A resource reader over an in-memory map, so the rules stay pure in tests. */
const reader = (files: Record<string, string>) =>
  async (resourcePath: string): Promise<string | undefined> => files[resourcePath]

/** A scene with a Control id in a container, plus whatever body is given. */
function scene(body: string): string {
  return `[gd_scene load_steps=2 format=3]
${body}
`
}

describe('parseSceneDocument', () => {
  it('reads node paths, properties, resources, and connections', () => {
    const document = parseSceneDocument(scene(`[ext_resource type="Script" path="res://main.gd" id="1_a"]
[node name="Main" type="Control"]
script = ExtResource("1_a")

[node name="Row" type="HBoxContainer" parent="."]

[node name="Btn" type="Button" parent="Row"]
layout_mode = 2
text = "Go"

[connection signal="pressed" from="Row/Btn" to="." method="_on_pressed"]`))
    expect(document.nodes.map(node => node.path)).toEqual(['Main', 'Row', 'Row/Btn'])
    expect(document.properties.get('Row/Btn')).toMatchObject({ layout_mode: '2', text: '"Go"' })
    expect(document.resources[0]).toMatchObject({ type: 'Script', path: 'res://main.gd' })
    expect(document.connections[0]).toMatchObject({ from: 'Row/Btn', to: '.', method: '_on_pressed' })
  })
})

describe('validateSceneText', () => {
  const root = '/project'

  it('rejects a Control laid out with anchors inside a Container', async () => {
    const issues = await validateSceneText(scene(`[node name="Main" type="Control"]

[node name="Row" type="HBoxContainer" parent="."]

[node name="Btn" type="Button" parent="Row"]
anchors_preset = 15
offset_left = 8.0
offset_top = 8.0`), { path: 'res://bad.tscn', projectRoot: root })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'error', path: 'res://bad.tscn', line: 6 })
    expect(issues[0]?.message).toContain('laid out with anchors/offsets inside the Container "Row"')
    expect(issues[0]?.message).toContain('layout_mode = 2')
  })

  it('accepts the same Control with container layout', async () => {
    const issues = await validateSceneText(scene(`[node name="Main" type="Control"]

[node name="Row" type="HBoxContainer" parent="."]

[node name="Btn" type="Button" parent="Row"]
layout_mode = 2
size_flags_horizontal = 3`), { path: 'res://ok.tscn', projectRoot: root })
    expect(issues).toEqual([])
  })

  it('warns about container layout under a non-container parent', async () => {
    const issues = await validateSceneText(scene(`[node name="Main" type="Control"]

[node name="Plain" type="Control" parent="."]
layout_mode = 2`), { path: 'res://warn.tscn', projectRoot: root })
    expect(issues).toMatchObject([{ kind: 'warning', line: 4 }])
    expect(issues[0]?.message).toContain('not a Container')
  })

  it('reports a missing parent and a duplicate node path', async () => {
    const issues = await validateSceneText(scene(`[node name="Main" type="Node2D"]

[node name="Orphan" type="Node2D" parent="Gone"]

[node name="Twin" type="Node2D" parent="."]

[node name="Twin" type="Node2D" parent="."]`), { path: 'res://tree.tscn', projectRoot: root })
    expect(issues.map(issue => issue.message)).toEqual([
      'parent "Gone" of "Orphan" does not exist in this scene',
      'duplicate node path "Twin"',
    ])
  })

  it('reports a missing ext_resource', async () => {
    const issues = await validateSceneText(scene(`[ext_resource type="Script" path="res://gone.gd" id="1_a"]
[node name="Main" type="Node"]
script = ExtResource("1_a")`), { path: 'res://res.tscn', projectRoot: root, readFile: reader({}) })
    expect(issues).toMatchObject([{ kind: 'error', line: 2, message: 'ext_resource "res://gone.gd" does not exist' }])
  })

  it('reports a connection whose method the target script does not declare', async () => {
    const files = {
      'res://main.gd': 'extends Control\n\nfunc _on_pressed() -> void:\n\tpass\n',
    }
    const issues = await validateSceneText(scene(`[ext_resource type="Script" path="res://main.gd" id="1_a"]
[node name="Main" type="Control"]
script = ExtResource("1_a")

[node name="Btn" type="Button" parent="."]

[connection signal="pressed" from="Btn" to="." method="_on_missing"]`), { path: 'res://conn.tscn', projectRoot: root, readFile: reader(files) })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toBe('connection calls "_on_missing" on "Main", but res://main.gd declares no such function')
  })
})
