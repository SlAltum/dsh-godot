/**
 * The injected GDScript sources: the facts the bridge must encode (buffer-only
 * capture, always-on processing, viewport input, no project mutation) and the
 * boot script's scene handoff. The same sources are parsed by Godot in the C1
 * smoke test; here they are asserted as text so a regression fails fast.
 */

import { describe, expect, it } from 'vitest'
import { BOOT_SOURCE, BRIDGE_SOURCE, bootstrapSource, bridgeSource } from '../src/bridge-source.ts'

describe('bridgeSource', () => {
  const source = bridgeSource({ allowEval: false })

  it('keeps the bridge alive while the game is paused', () => {
    expect(source).toContain('process_mode = Node.PROCESS_MODE_ALWAYS')
  })

  it('captures frames through in-memory buffers only', () => {
    expect(source).toContain('save_png_to_buffer')
    expect(source).toContain('save_jpg_to_buffer')
    expect(source).toContain('save_webp_to_buffer')
    expect(source).not.toMatch(/save_png\(/)
    expect(source).toContain('Marshalls.raw_to_base64')
  })

  it('injects input through the viewport', () => {
    expect(source).toContain('get_viewport().push_input')
    expect(source).not.toContain('Input.parse_input_event')
  })

  it('releases the wheel button so the next click reaches its Control', () => {
    // Pinned on a real Godot 4.7.2: a press-only wheel event leaves the GUI
    // state such that the following left click does not toggle its Control.
    expect(source).toContain('var up := event.duplicate()')
  })

  it('reads the endpoint and token from the environment', () => {
    expect(source).toContain('OS.get_environment("DSH_EGO_PORT")')
    expect(source).toContain('OS.get_environment("DSH_EGO_TOKEN")')
  })

  it('serializes properties explicitly instead of JSON.stringify', () => {
    expect(source).toContain('func _to_json_value(')
    expect(source).toContain('PROPERTY_USAGE_STORAGE | PROPERTY_USAGE_SCRIPT_VARIABLE')
    expect(source).toContain('PROPERTY_USAGE_CATEGORY | PROPERTY_USAGE_GROUP | PROPERTY_USAGE_SUBGROUP')
  })

  it('bakes the eval gate into the source', () => {
    expect(source).toContain('const ALLOW_EVAL := false')
    expect(bridgeSource({ allowEval: true })).toContain('const ALLOW_EVAL := true')
    expect(bridgeSource()).toContain('const ALLOW_EVAL := false')
  })

  it('answers the actions and scene commands', () => {
    expect(source).toContain('"actions":')
    expect(source).toContain('InputMap.get_actions()')
    expect(source).toContain('"scene":')
    expect(source).toContain('change_scene_to_file')
  })

  it('starts with extends before the generated constant', () => {
    expect(BRIDGE_SOURCE[0]).toBe('extends Node')
    expect(bridgeSource().split('\n')[0]).toBe('extends Node')
  })
})

describe('bootstrapSource', () => {
  it('loads the bridge from outside the project and starts the main scene', () => {
    const source = bootstrapSource({ bridgePath: 'C:/tmp/bridge.gd' })
    expect(source).toContain('extends SceneTree')
    expect(source).toContain('const BRIDGE_PATH := "C:/tmp/bridge.gd"')
    expect(source).toContain('change_scene_to_file(main_scene)')
    expect(source).toContain('application/run/main_scene')
    expect(source).not.toContain('autoload')
  })

  it('escapes the embedded path and falls back to the environment', () => {
    const source = bootstrapSource({ bridgePath: 'C:/a"b/bridge.gd' })
    expect(source).toContain('const BRIDGE_PATH := "C:/a\\"b/bridge.gd"')
    expect(source).toContain('OS.get_environment("DSH_EGO_BRIDGE")')
  })

  it('prefers a scene override from the environment', () => {
    const source = bootstrapSource({ bridgePath: 'C:/tmp/bridge.gd' })
    expect(source).toContain('OS.get_environment("DSH_EGO_SCENE")')
    expect(source.indexOf('DSH_EGO_SCENE')).toBeLessThan(source.indexOf('application/run/main_scene'))
  })

  it('omits the path when none is given', () => {
    expect(bootstrapSource()).toContain('const BRIDGE_PATH := ""')
    expect(BOOT_SOURCE.some(line => line.includes('__BRIDGE_PATH__'))).toBe(true)
  })
})
