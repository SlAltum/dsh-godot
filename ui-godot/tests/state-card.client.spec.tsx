/**
 * The `godot_state` card: the read's facts and the live tree it returned.
 *
 * The stylesheet and the logo are mocked (this file checks content; the real
 * asset handling belongs to the build), and the shell row is stubbed with the
 * same contract the card renders against.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setCardOpen } from '../src/client/cards/fold.ts'

vi.mock('../src/client/state/StateCard.module.css', () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock('../src/client/assets/godot-logo.svg', () => ({ default: 'data:image/svg+xml,logo' }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    DisclosureRow: (props: {
      title: string
      open: boolean
      onToggle: () => void
      expandOnRowClick?: boolean
      titleClassName?: string
      collapsedContent?: unknown
      children?: unknown
    }) => createElement(
      'div',
      { 'data-row': 'row', onClick: props.expandOnRowClick === true ? props.onToggle : undefined },
      createElement('span', { 'data-title': props.title, class: props.titleClassName }, props.title),
      props.collapsedContent as never,
      props.open ? createElement('div', { 'data-body': 'body' }, props.children as never) : null,
    ),
  }
})

const { StateCard } = await import('../src/client/state/StateCard.tsx')

/** The dictionary is only a lookup here; the card receives it as a prop. */
const t = (key: string): string => key

/** One read: two nodes under a root, with the facts the card reports. */
const view = {
  version: 1,
  scene: 'res://main.tscn',
  fps: 60,
  frame: 1234,
  nodeCount: 3,
  paused: false,
  treeTruncated: false,
  nodes: [{
    name: 'Main', className: 'res://main.gd', id: '11', scene: 'res://main.tscn',
    unique: true, script: 'res://main.gd',
    children: [{ name: 'Start', className: 'Button', id: '12', scene: '', unique: false, script: '', children: [] }],
  }],
}

/** Render one call block, unfolded. */
function render(block: unknown): string {
  setCardOpen('state-call', true)
  return renderToStaticMarkup(
    createElement(StateCard, { t, toolName: 'godot_state', callId: 'state-call', block } as never),
  )
}

describe('StateCard', () => {
  it('reports the read: scene, fps, frame, nodes', () => {
    const html = render({ meta: { view }, call: { argsRaw: '{}' } })
    expect(html).toContain('res://main.tscn')
    expect(html).toContain('60 fps')
    expect(html).toContain('1234')
    expect(html).toContain('3 sceneNodes')
    expect(html).not.toContain('statePaused')
    // A title and its facts need the shell's separator between them.
    expect(html).toContain('class="sep"')
  })

  it('renders the live hierarchy with its class text and unique mark', () => {
    const html = render({ meta: { view }, call: { argsRaw: '{}' } })
    expect(html).toContain('Main')
    expect(html).toContain('Start')
    expect(html).toContain('Button')
    expect(html).toContain('sceneUnique')
  })

  it('says when the read carried no tree', () => {
    const empty = { ...view, nodes: undefined }
    const html = render({ meta: { view: empty }, call: { argsRaw: '{}' } })
    expect(html).toContain('stateNoTree')
    // A read that carried no tree must not also print a tree heading.
    expect(html).not.toContain('debugSceneTree')
  })

  it('marks the tree slice when the node budget cut it', () => {
    const cut = { ...view, treeTruncated: true }
    expect(render({ meta: { view: cut }, call: { argsRaw: '{}' } })).toContain('debugTreeTruncated')
  })

  it('shows the pause flag when the game is paused', () => {
    const paused = { ...view, paused: true }
    expect(render({ meta: { view: paused }, call: { argsRaw: '{}' } })).toContain('statePaused')
  })

  it('marks the rows this read changed, and counts them', () => {
    const diffed = {
      ...view,
      changed: { appeared: ['Main/Start'], changed: ['Main'], disappeared: [] },
    }
    const html = render({ meta: { view: diffed }, call: { argsRaw: '{}' } })
    expect(html.match(/rowMarked/g)?.length).toBe(2)
    expect(html).toContain('stateChanged 2')
  })

  it('marks nothing when the read carried no diff', () => {
    expect(render({ meta: { view }, call: { argsRaw: '{}' } })).not.toContain('rowMarked')
  })

  it('falls back to the rendered text when the call carries no view', () => {
    const html = render({ content: [{ type: 'text', text: 'scene res://main.tscn · 60 fps' }] })
    expect(html).toContain('60 fps')
    expect(html).not.toContain('stateNoTree')
  })
})
