/**
 * The `.tscn` body: what it renders from a scene file, and the two empty states
 * a reader can hit (a file with no nodes, and content still loading).
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../src/client/scene/SceneBody.module.css', () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}))

const { SceneBody } = await import('../src/client/scene/SceneBody.tsx')

/** The dictionary is a lookup here; the body receives it as a prop. */
const t = (key: string): string => key

/** A scene with a nested node, a script and an inherited scene. */
const SCENE = `[gd_scene format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://ui/panel.tscn" id="2_panel"]

[node name="Main" type="Control"]
script = ExtResource("1_main")

[node name="Board" type="Control" parent="."]

[node name="Panel" parent="Board" instance=ExtResource("2_panel")]
`

/** Render one document body with the given content. */
function render(content: unknown): string {
  // Through createElement, so hooks run under the renderer's dispatcher.
  return renderToStaticMarkup(createElement(SceneBody, { t, content } as Parameters<typeof SceneBody>[0]))
}

/** A text content payload shaped like the document owner's. */
function text(value: string) {
  return { kind: 'text', text: value, pages: [{ offset: 0, text: value, lines: value.split('\n').length }], eof: true }
}

describe('SceneBody', () => {
  it('renders the tree with each node and its engine class', () => {
    const html = render(text(SCENE))
    expect(html).toContain('Main')
    expect(html).toContain('Board')
    expect(html).toContain('Panel')
    expect(html).toContain('Control')
  })

  it('counts nodes and external resources in the header', () => {
    const html = render(text(SCENE))
    expect(html).toContain('3 sceneNodes')
    expect(html).toContain('2 sceneResources')
  })

  it('marks a scripted node with the script glyph and an inherited scene with the scene glyph', () => {
    const html = render(text(SCENE))
    // The Godot editor's Scene dock draws icons, not letters: the class icon
    // stays, and the marks sit in a right-aligned block.
    expect(html).toContain('assets/icons/Script.svg')
    expect(html).toContain('res://main.gd')
    expect(html).toContain('assets/icons/PackedScene.svg')
    expect(html).toContain('res://ui/panel.tscn')
  })

  it('gives every node its class icon, and no mark for a class the set lacks', () => {
    const html = render(text(SCENE))
    expect(html).toContain('plugins/@deepseek-ai/dsh-ui-godot/assets/icons/Control.svg')
    // A class outside the set keeps the row aligned instead of drawing a dot.
    const unknown = render(text('[gd_scene format=3]\n\n[node name="R" type="NotAnEngineClass"]\n'))
    expect(unknown).toContain('iconSpacer')
    expect(unknown).not.toContain('assets/icons/NotAnEngineClass.svg')
  })

  it('opens with the pick-a-node note instead of a source pane', () => {
    const html = render(text(SCENE))
    expect(html).toContain('scenePickNode')
  })

  it('says so when the file declares no nodes', () => {
    expect(render(text('[gd_scene format=3]\n'))).toContain('sceneEmpty')
  })

  it('says so while the content is still loading', () => {
    expect(render({ kind: 'renderer', revision: 1, loaded: () => {}, failed: () => {}, reload: () => {} }))
      .toContain('sceneLoading')
  })
})
