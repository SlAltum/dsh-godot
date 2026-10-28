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

  it('injects pointer input in viewport (canvas) space, not screen space', () => {
    // `push_input(event)` defaults to in_local_coords=false, which makes Godot
    // apply the window's screen transform to an event whose position already
    // came from `get_global_transform_with_canvas()`. A 0.8-scaled project then
    // receives the point 20% away from the Control that was targeted.
    expect(source).toContain('get_viewport().push_input(event, true)')
    expect(source).toContain('get_viewport().push_input(up, true)')
    expect(source).not.toMatch(/push_input\((event|up)\)/)
    expect(source).not.toContain('Input.parse_input_event')
  })

  it('maps a canvas rect into captured image pixels, not texture pixels', () => {
    // `get_texture().get_size()` and `get_image().get_size()` disagree on a
    // scaled window, so the crop ratio must come from the captured image.
    expect(source).toContain('func _image_rect(')
    expect(source).toContain('var scale := Vector2(image_size.x / canvas_size.x, image_size.y / canvas_size.y)')
    expect(source).toContain('var image_size := Vector2(full.get_size())')
    // A crop that cannot land is an error, never a silent full frame.
    expect(source).toContain('has no visible area')
    expect(source).toContain('_resolve_message(target)')
  })

  it('exposes a method call that reports its return value and refuses a missing method', () => {
    expect(source).toContain('"call":')
    expect(source).toContain('func _call(id: int, msg: Dictionary) -> void:')
    expect(source).toContain('node.callv(method, argv)')
    // A wrong method name must answer with candidates, not vanish.
    expect(source).toContain('func _method_hint(')
  })

  it('bounds the target list by the request, not by a hardcoded 200', () => {
    // A scene with 122 Controls is ordinary; paging must be able to reach them.
    expect(source).toContain('func _targets(main: Node, limit: int) -> Array:')
    expect(source).toContain('int(msg.get("maxTargets", 2000))')
    expect(source).not.toContain('out, 200)')
  })

  it('reports the canvas/window geometry with every state reply', () => {
    expect(source).toContain('"geometry": {')
    expect(source).toContain('"canvas": [canvas.x, canvas.y]')
    expect(source).toContain('"window": [window.x, window.y]')
    expect(source).toContain('"screen": [screen.x.x, screen.y.y, screen.origin.x, screen.origin.y]')
  })

  it('accepts every path form the tools hand out', () => {
    // godot_state emits "<scene root>/Child"; a scene-relative "Child" and the
    // absolute "/root/Main/Child" must all resolve to the same node.
    expect(source).toContain('func _resolve_candidates(')
    expect(source).toContain('"/root/" + path')
    expect(source).toContain('func _resolve_message(')
  })

  it('reports the Control the pointer is over, using the name the engine exposes', () => {
    // Godot 4.2+ exposes `gui_get_hovered_control`. The older spelling does not
    // exist, and a `has_method` guard around it fails silently, which is why
    // every click reported "no node consumed the click".
    expect(source).toContain('func _hovered_control()')
    expect(source).toContain('gui_get_hovered_control')
    expect(source).toContain('var hit: Variant = _hovered_path()')
    expect(source).toContain('"over": _hovered_path()')
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
