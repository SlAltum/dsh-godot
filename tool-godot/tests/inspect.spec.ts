/**
 * Unit tests for `godot_inspect`: the project/scene/resource parsers, target
 * resolution, argument parsing, rendering, and card presentation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GodotError,
  parseAttrs,
  parseInspectArgs,
  parseProjectFile,
  parseResourceFile,
  parseSceneFile,
  presentInspectCall,
  renderInspectOutput,
  resolveInspectTarget,
} from '@deepseek-ai/dsh-tool-godot'
import type { InspectResult } from '@deepseek-ai/dsh-tool-godot'

describe('parseInspectArgs', () => {
  it('accepts a non-blank path', () => {
    expect(parseInspectArgs({ path: 'proj' })).toEqual({ path: 'proj' })
  })

  it('rejects a blank path', () => {
    expect(() => parseInspectArgs({ path: '  ' })).toThrow('path must be a non-empty string')
  })
})

describe('parseAttrs', () => {
  it('parses key="value" pairs', () => {
    expect(parseAttrs('type="Script" path="res://a.gd" id="1_x"')).toEqual({ type: 'Script', path: 'res://a.gd', id: '1_x' })
  })

  it('returns an empty map for no pairs', () => {
    expect(parseAttrs('')).toEqual({})
  })
})

describe('parseProjectFile', () => {
  it('parses config, application, and autoload sections', () => {
    const text = [
      '; Engine configuration file.',
      'config_version=5',
      'unknown_top=1',
      'bare line without equals',
      '',
      '[application]',
      '',
      'config/name="Fixture Game"',
      'config/features=PackedStringArray("4.7")',
      'run/main_scene="res://scenes/main.tscn"',
      '[autoload]',
      '',
      'Game="*res://scripts/game.gd"',
      'Audio="res://scripts/audio.gd"',
      '[unknown]',
      'some/key=1',
    ].join('\n')
    expect(parseProjectFile(text)).toEqual({
      configVersion: '5',
      name: 'Fixture Game',
      mainScene: 'res://scenes/main.tscn',
      autoloads: [
        { name: 'Game', path: 'res://scripts/game.gd' },
        { name: 'Audio', path: 'res://scripts/audio.gd' },
      ],
      sections: ['application', 'autoload', 'unknown'],
    })
  })

  it('handles a minimal file with only a version line', () => {
    expect(parseProjectFile('config_version=5\n')).toEqual({ configVersion: '5', autoloads: [], sections: [] })
  })
})

describe('parseSceneFile', () => {
  it('parses the header, ext_resources, and nodes', () => {
    const text = [
      '[gd_scene load_steps=3 format=3 uid="uid://abc"]',
      '',
      '[ext_resource type="Script" path="res://scripts/main.gd" id="1_x"]',
      '[ext_resource type="Texture2D" uid="uid://t" path="res://icon.svg" id="2_y"]',
      '[ext_resource path="res://no-type.gd" id="3_z"]',
      '[ext_resource type="Script" id="4_w"]',
      '',
      '[node name="Main" type="Node"]',
      'script = ExtResource("1_x")',
      '',
      '[node name="Child" type="Node2D" parent="."]',
      '',
      '[node name="Inst" parent="Main" instance=ExtResource("2_y")]',
      '',
      '[node type="Node"]',
      '',
      '[sub_resource type="GDScript" id="Sub_1"]',
    ].join('\n')
    expect(parseSceneFile(text)).toEqual({
      format: '3',
      uid: 'uid://abc',
      extResources: [
        { id: '1_x', type: 'Script', path: 'res://scripts/main.gd' },
        { id: '2_y', type: 'Texture2D', path: 'res://icon.svg' },
        { id: '3_z', type: '', path: 'res://no-type.gd' },
      ],
      nodes: [
        { name: 'Main', type: 'Node' },
        { name: 'Child', type: 'Node2D', parent: '.' },
        { name: 'Inst', parent: 'Main', instance: 'ExtResource("2_y")' },
        { name: '', type: 'Node' },
      ],
    })
  })

  it('parses a header without format or uid', () => {
    expect(parseSceneFile('[gd_scene load_steps=2]\n')).toEqual({ extResources: [], nodes: [] })
  })

  it('skips unrelated lines', () => {
    expect(parseSceneFile('position = Vector2(1, 2)\n[connection signal="s"]\n')).toEqual({ extResources: [], nodes: [] })
  })
})

describe('parseResourceFile', () => {
  it('parses sections and ext_resources', () => {
    const text = [
      '[gd_resource type="Script" load_steps=2 format=3]',
      '',
      '[ext_resource type="Script" path="res://a.gd" id="1_x"]',
      '[ext_resource type="Script" id="2_y"]',
      '[ext_resource path="res://c.gd" id="3_z"]',
      '',
      '[resource]',
      'script = ExtResource("1_x")',
    ].join('\n')
    expect(parseResourceFile(text)).toEqual({
      sections: ['gd_resource', 'resource'],
      extResources: [
        { id: '1_x', type: 'Script', path: 'res://a.gd' },
        { id: '3_z', type: '', path: 'res://c.gd' },
      ],
    })
  })
})

describe('resolveInspectTarget', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-godot-inspect-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('resolves a project directory', async () => {
    await writeFile(join(dir, 'project.godot'), 'config_version=5\n')
    expect(await resolveInspectTarget(dir)).toEqual({ kind: 'project', path: join(dir, 'project.godot') })
  })

  it('rejects a directory without project.godot', async () => {
    await expect(resolveInspectTarget(dir)).rejects.toMatchObject({ code: 'GODOT_PARSE_ERROR' })
  })

  it('resolves scene, resource, and project files', async () => {
    const tscn = join(dir, 'a.tscn')
    const tres = join(dir, 'b.tres')
    const proj = join(dir, 'project.godot')
    await writeFile(tscn, '')
    await writeFile(tres, '')
    await writeFile(proj, '')
    expect(await resolveInspectTarget(tscn)).toEqual({ kind: 'scene', path: tscn })
    expect(await resolveInspectTarget(tres)).toEqual({ kind: 'resource', path: tres })
    expect(await resolveInspectTarget(proj)).toEqual({ kind: 'project', path: proj })
  })

  it('rejects an unsupported file type', async () => {
    const txt = join(dir, 'notes.txt')
    await writeFile(txt, 'hello')
    await expect(resolveInspectTarget(txt)).rejects.toMatchObject({ code: 'GODOT_PARSE_ERROR' })
  })

  it('propagates a stat failure for a missing path', async () => {
    await expect(resolveInspectTarget(join(dir, 'missing'))).rejects.toBeInstanceOf(Error)
  })
})

describe('renderInspectOutput', () => {
  it('renders a project with all fields', () => {
    const value: InspectResult = {
      kind: 'project',
      path: 'proj',
      configVersion: '5',
      name: 'Fixture Game',
      mainScene: 'res://scenes/main.tscn',
      autoloads: [{ name: 'Game', path: 'res://scripts/game.gd' }],
      sections: ['application'],
    }
    const text = renderInspectOutput(value)
    expect(text).toContain('Godot project at proj')
    expect(text).toContain('Name: Fixture Game')
    expect(text).toContain('Main scene: res://scenes/main.tscn')
    expect(text).toContain('Config version: 5')
    expect(text).toContain('Game = res://scripts/game.gd')
    expect(text).toContain('Sections: application')
  })

  it('renders a minimal project', () => {
    expect(renderInspectOutput({ kind: 'project', path: 'proj', autoloads: [], sections: [] })).toBe('Godot project at proj')
  })

  it('renders a scene with resources and nodes', () => {
    const value: InspectResult = {
      kind: 'scene',
      path: 'scenes/main.tscn',
      format: '3',
      uid: 'uid://abc',
      extResources: [{ id: '1_x', type: 'Script', path: 'res://scripts/main.gd' }],
      nodes: [
        { name: 'Main', type: 'Node' },
        { name: 'Child', type: 'Node2D', parent: '.' },
        { name: 'Inst', parent: 'Main', instance: 'ExtResource("1_x")' },
      ],
    }
    const text = renderInspectOutput(value)
    expect(text).toContain('Godot scene at scenes/main.tscn')
    expect(text).toContain('Format: 3')
    expect(text).toContain('UID: uid://abc')
    expect(text).toContain('1_x: Script res://scripts/main.gd')
    expect(text).toContain('Main type=Node')
    expect(text).toContain('Child type=Node2D parent=.')
    expect(text).toContain('Inst parent=Main instance=ExtResource("1_x")')
  })

  it('renders a minimal scene', () => {
    expect(renderInspectOutput({ kind: 'scene', path: 'a.tscn', extResources: [], nodes: [] })).toBe('Godot scene at a.tscn')
  })

  it('renders a resource', () => {
    const value: InspectResult = {
      kind: 'resource',
      path: 'b.tres',
      sections: ['gd_resource'],
      extResources: [{ id: '1_x', type: 'Script', path: 'res://a.gd' }],
    }
    const text = renderInspectOutput(value)
    expect(text).toContain('Godot resource at b.tres')
    expect(text).toContain('1_x: Script res://a.gd')
    expect(text).toContain('Sections: gd_resource')
  })

  it('renders a minimal resource', () => {
    expect(renderInspectOutput({ kind: 'resource', path: 'b.tres', sections: [], extResources: [] })).toBe('Godot resource at b.tres')
  })
})

describe('presentInspectCall', () => {
  it('titles with the target path', () => {
    expect(presentInspectCall({ path: 'proj' })).toEqual({ card: 'generic', title: 'Inspect Godot proj' })
  })
})

describe('GodotError', () => {
  it('carries the stable code', () => {
    const error = new GodotError('bad', 'GODOT_PARSE_ERROR')
    expect(error.code).toBe('GODOT_PARSE_ERROR')
    expect(error.message).toBe('bad')
  })
})
