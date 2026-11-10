/**
 * `.tscn` parsing: the node hierarchy a reader wants, recovered from the text.
 *
 * Every case here is one Godot actually writes: a root with no `parent=`, the
 * `parent="."` shorthand, a parent path relative to the root, an inherited
 * scene (`instance=ExtResource`), a node script, `unique_name_in_owner`, and
 * the per-node property block that ends at the next bracketed header.
 */

import { describe, expect, it } from 'vitest'
import { parseTscn } from '../src/client/scene/tscn.ts'

/** A scene exercising every rule at once. */
const SCENE = `[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://ui/panel.tscn" id="2_panel"]

[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_1"]
bg_color = Color(1, 1, 1, 1)

[node name="Main" type="Control"]
layout_mode = 3
script = ExtResource("1_main")

[node name="Background" type="ColorRect" parent="."]
offset_right = 1280.0

[node name="Board" type="Control" parent="."]
layout_mode = 0

[node name="Grid" type="Node2D" parent="Board"]
unique_name_in_owner = true

[node name="Panel" parent="Board" instance=ExtResource("2_panel")]

[node name="Deep" type="Label" parent="Board/Grid"]
text = "hi"
`

describe('parseTscn', () => {
  it('takes the first parentless node as the root', () => {
    const scene = parseTscn(SCENE)
    expect(scene.rootName).toBe('Main')
    expect(scene.root?.path).toBe('Main')
    expect(scene.root?.type).toBe('Control')
  })

  it('hangs parent="." nodes directly under the root', () => {
    const scene = parseTscn(SCENE)
    const background = scene.nodes.find(node => node.name === 'Background')
    expect(background?.path).toBe('Main/Background')
    expect(background?.parent).toBe('Main')
  })

  it('resolves a parent path relative to the root, at any depth', () => {
    const scene = parseTscn(SCENE)
    const grid = scene.nodes.find(node => node.name === 'Grid')
    expect(grid?.path).toBe('Main/Board/Grid')
    const deep = scene.nodes.find(node => node.name === 'Deep')
    expect(deep?.path).toBe('Main/Board/Grid/Deep')
    expect(deep?.parent).toBe('Main/Board/Grid')
  })

  it('builds children in file order under the right parent', () => {
    const scene = parseTscn(SCENE)
    const board = scene.nodes.find(node => node.name === 'Board')
    expect(board?.children.map(child => child.name)).toEqual(['Grid', 'Panel'])
    expect(scene.root?.children.map(child => child.name)).toEqual(['Background', 'Board'])
  })

  it('records the header line of every node and walks depth-first', () => {
    const scene = parseTscn(SCENE)
    // Depth-first from the root: Main, Background, Board, Grid, Deep, Panel.
    expect(scene.nodes.map(node => node.name)).toEqual(['Main', 'Background', 'Board', 'Grid', 'Deep', 'Panel'])
    expect(scene.nodes.map(node => node.line).slice().sort((left, right) => left - right))
      .toEqual([9, 13, 16, 19, 22, 24])
  })

  it('gives each node its own property block, ending at the next header', () => {
    const scene = parseTscn(SCENE)
    const background = scene.nodes.find(node => node.name === 'Background')
    expect(background?.body).toBe('[node name="Background" type="ColorRect" parent="."]\noffset_right = 1280.0')
  })

  it('resolves a node script and an inherited scene to their resource paths', () => {
    const scene = parseTscn(SCENE)
    expect(scene.nodes.find(node => node.name === 'Main')?.script).toBe('res://main.gd')
    expect(scene.nodes.find(node => node.name === 'Panel')?.instance).toBe('res://ui/panel.tscn')
  })

  it('marks a node unique in the owner', () => {
    const scene = parseTscn(SCENE)
    expect(scene.nodes.find(node => node.name === 'Grid')?.unique).toBe(true)
    expect(scene.nodes.find(node => node.name === 'Board')?.unique).toBe(false)
  })

  it('lists external resources in file order', () => {
    const scene = parseTscn(SCENE)
    expect(scene.resources.map(resource => resource.path)).toEqual(['res://main.gd', 'res://ui/panel.tscn'])
  })

  it('keeps a node whose parent is missing under the root instead of dropping it', () => {
    const scene = parseTscn(`[node name="Root" type="Node"]\n\n[node name="Lost" type="Node" parent="Nowhere"]\n`)
    // Its declared path stays what the file says; only its position in the tree
    // falls back to the root, so a broken parent does not hide the node.
    expect(scene.nodes.map(node => node.path)).toEqual(['Root', 'Root/Nowhere/Lost'])
    expect(scene.root?.children.map(child => child.name)).toEqual(['Lost'])
  })

  it('renders a file with no nodes as empty', () => {
    expect(parseTscn('[gd_scene format=3]\n')).toEqual({ rootName: '', root: undefined, nodes: [], resources: [] })
  })

})
