/**
 * The `godot_debug` card: what it renders from a persisted view, and what it
 * falls back to when a call carries no view (older results, or a failure).
 *
 * The stylesheet and the logo are mocked: this file checks the card's content,
 * and the real asset handling belongs to the build.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../src/client/debug/DebugCard.module.css', () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock('../src/client/assets/godot-logo.svg', () => ({ default: 'data:image/svg+xml,logo' }))
// The shell's row component brings its stylesheet and a chain of workspace packages
// into Node; the card only needs the contract it renders against.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    // Same shape as the real component: a text span for strings, children otherwise.
    TextShimmer: (props: { children?: unknown }) => createElement('span', null, props.children as never),
    DisclosureRow: (props: {
      title: string
      icon: unknown
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
      props.icon as never,
      props.collapsedContent as never,
      props.open ? createElement('div', { 'data-body': 'body' }, props.children as never) : null,
    ),
  }
})

const { DebugCard, setCardOpen } = await import('../src/client/debug/DebugCard.tsx')

/** The dictionary is only a lookup here; the card receives it as a prop. */
const t = (key: string): string => key

/** One view with a stop, an expansion, an edit and output. */
const view = {
  version: 1,
  stopCount: 1,
  maxStops: 10,
  detached: false,
  stops: [{
    index: 0,
    reason: 'Breakpoint',
    isUserBreakpoint: true,
    threadId: 1,
    frames: [
      { file: 'res://main.gd', line: 7, func: 'main' },
      { file: 'res://main.gd', line: 3, func: 'ready' },
    ],
    varsLines: ['player = Object<42>', 'score = 3'],
    sceneTree: {
      nodes: [{
        name: 'Root', className: 'Control', id: '42', sceneFilePath: 'res://main.tscn',
        children: [{ name: 'Player', className: 'res://player.gd', id: '43', sceneFilePath: '', children: [] }],
      }],
    },
  }],
  expansion: {
    stopIndex: 0,
    expandedObjects: 1,
    truncated: false,
    entries: [{
      name: 'player',
      id: '42',
      className: 'Player',
      rows: [{ name: 'health', value: '10' }],
      children: [{ name: 'player.sprite', id: '43', className: 'Sprite2D', rows: [] }],
    }],
  },
  edits: {
    stopIndex: 0,
    truncated: false,
    results: [{ target: 'player', property: 'health', requested: 5, type: 'int', ok: true }],
  },
  outputTail: ['main: starting'],
  errors: [],
  expandedObjects: 1,
  expansionTruncated: false,
  editsApplied: 1,
  editsTruncated: false,
  sceneTreeCount: 1,
  sceneTreeTruncated: false,
  outputTruncated: false,
  varsTruncated: false,
}

const args = JSON.stringify({
  mode: 'launch',
  scene: 'res://levels/test.tscn',
  breakpoints: [{ file: 'res://main.gd', line: 7 }],
})

/** Render one call block, unfolded. */
function render(block: unknown): string {
  return renderWith(block, {})
}

/** Render one call block with extra owner props, unfolded. */
function renderWith(block: unknown, extra: Record<string, unknown>): string {
  setCardOpen('test-call', true)
  return renderToStaticMarkup(
    createElement(DebugCard, { t, toolName: 'godot_debug', callId: 'test-call', block, ...extra } as never),
  )
}

describe('DebugCard', () => {
  it('summarizes the run: mode, target and breakpoint count', () => {
    const html = render({ meta: { view }, call: { argsRaw: args } })
    expect(html).toContain('debugLaunch')
    expect(html).toContain('res://levels/test.tscn')
    expect(html).toContain('1 debugBreakpoints')
  })

  it('names the target of an attach run by its port', () => {
    const html = render({ meta: { view }, call: { argsRaw: JSON.stringify({ mode: 'attach', port: 6007 }) } })
    expect(html).toContain('debugAttach')
    expect(html).toContain(':6007')
  })

  it('renders every stop with its frames, variables and scene tree', () => {
    const html = render({ meta: { view }, call: { argsRaw: args } })
    expect(html).toContain('main — res://main.gd:7')
    expect(html).toContain('ready')
    expect(html).toContain('score = 3')
    // The tree keeps its structure: a scripted node shows the script path as its
    // class and draws the script glyph, not a class icon it does not have.
    expect(html).toContain('Player')
    expect(html).toContain('res://player.gd')
    expect(html).toContain('assets/icons/Script.svg')
  })

  it('renders expanded objects with their nested children', () => {
    const html = render({ meta: { view }, call: { argsRaw: args } })
    expect(html).toContain('health')
    expect(html).toContain('player.sprite')
  })

  it('renders edits and output, and flags truncation in the chips', () => {
    const truncated = { ...view, outputTruncated: true }
    const html = render({ meta: { view: truncated }, call: { argsRaw: args } })
    expect(html).toContain('player.health')
    expect(html).toContain('main: starting')
    expect(html).toContain('debugTruncated')
  })

  it('shows the call while it runs, before any result exists', () => {
    // A started call has arguments and no result: the row still identifies the
    // run and says so, and it does not offer a fold with nothing behind it.
    const html = render({ call: { argsRaw: args } })
    expect(html).toContain('godot_debug')
    expect(html).toContain('debugRunning')
    expect(html).not.toContain('debugSceneTree')
    // The running summary is the row's secondary tier too: it must not fall
    // back to the message body size while the call is still streaming.
    expect(html).toContain('class="facts"')
    // The shell rows draw a dot between title and summary; the card draws its own.
    expect(html).toContain('class="sep"')
  })

  it('reads the view out of the meta the tool actually persists', () => {
    // The tool writes `{ ...debugMeta, view }`; debugMeta has its own `stops`
    // list, which is not the view's.
    const html = render({
      meta: {
        stopCount: 1,
        maxStops: 10,
        stops: [{ file: 'res://main.gd', line: 7, func: 'main', reason: 'Breakpoint', threadId: 1 }],
        detached: false,
        view,
      },
      call: { argsRaw: args },
    })
    expect(html).toContain('main — res://main.gd:7')
    expect(html).toContain('debugSceneTree')
  })

  it('opens with the stop root picked, so the card answers without a click', () => {
    const html = render({ meta: { view }, call: { argsRaw: args } })
    expect(html).toContain('Root')
    // The root's identity, not the empty-state hint.
    expect(html).toContain('id 42')
    expect(html).not.toContain('debugPickNode')
  })

  it('reads a picked node against the objects the run expanded', async () => {
    const { nodeInfo } = await import('../src/client/debug/DebugCard.tsx')
    const node = { name: 'Root', className: 'Control', id: '42', sceneFilePath: '', children: [] }
    const entries = [{
      name: 'player', id: '42', className: 'Player',
      rows: [{ name: 'health', value: '10' }], children: [],
    }]
    expect(nodeInfo(node, entries)?.rows).toEqual([{ name: 'health', value: '10' }])
    // A node the run never expanded has nothing to show.
    expect(nodeInfo({ ...node, id: '99' }, entries)).toBeUndefined()
  })

  it('folds through the row, and remembers the fold per call', () => {
    // The transcript re-creates a toolview on every streaming render, so the fold has
    // to outlive the component instance: it is kept per call id, outside React.
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const renderCard = (): void => {
      root.render(createElement(DebugCard, {
        t,
        toolName: 'godot_debug',
        callId: 'fold-call',
        block: { meta: { view }, call: { argsRaw: args } },
      } as never))
    }
    act(() => { renderCard() })
    const row = container.querySelector('[data-row]')
    expect(row?.querySelector('[data-title]')?.textContent).toBe('godot_debug')
    expect(container.querySelector('[data-body]')).toBeNull()
    act(() => { (row as HTMLElement).click() })
    expect(container.querySelector('[data-body]')).not.toBeNull()
    // A remount — the streaming case — comes back open.
    act(() => { root.render(createElement('div', null)) })
    act(() => { renderCard() })
    expect(container.querySelector('[data-body]')).not.toBeNull()
    act(() => { root.unmount() })
    container.remove()
  })

  it('survives a half-written view: absent entry lists, no stops', () => {
    // The tool can persist `expansion`/`edits` without their lists; reading `.length`
    // on those took the whole card down with "cannot read properties of undefined".
    const html = render({
      meta: {
        view: {
          stops: [],
          expandedObjects: 0,
          stopCount: 0,
          expansion: { stopIndex: 0, expandedObjects: 0, truncated: false },
          edits: { stopIndex: 0, truncated: false },
        },
      },
      call: { argsRaw: args },
    })
    expect(html).toContain('godot_debug')
    expect(html).not.toContain('report failed')
  })

  it('renders a stop that arrived without frames', async () => {
    const { asDebugView } = await import('../src/client/debug/debug-view.ts')
    const view = asDebugView({
      stops: [{ index: 0, reason: 'Breakpoint', isUserBreakpoint: true, threadId: 1, varsLines: ['a = 1'] }],
      outputTail: [], errors: [],
    })
    // A stop is identified by its index; the frame list is defaulted, not required.
    expect(view?.stops[0]?.frames).toEqual([])
    expect(render({ meta: { view }, call: { argsRaw: args } })).toContain('#1')
  })

  it('reads the persisted scene tree, and nothing when it is absent', async () => {
    const { asDebugView } = await import('../src/client/debug/debug-view.ts')
    const node = { name: 'Main', className: 'Control', id: '1', sceneFilePath: '', children: [] }
    const stop = { index: 0, reason: 'Breakpoint', isUserBreakpoint: true, threadId: 1, frames: [] }
    const base = { stops: [], outputTail: [], errors: [] }
    const view = asDebugView({ ...base, stops: [{ ...stop, sceneTree: { nodes: [node] } }] })
    expect(view?.stops[0]?.sceneTree?.nodes).toHaveLength(1)
    // A carrier with no node list must not survive as `{ nodes: undefined }` — that
    // shape is what crashed the card while it reported the view.
    expect(asDebugView({ ...base, stops: [stop] })?.stops[0]?.sceneTree).toBeUndefined()
    expect(asDebugView({ ...base, stops: [{ ...stop, sceneTree: {} }] })?.stops[0]?.sceneTree).toBeUndefined()
  })

  it('keeps the run\'s facts on the row while the report is open', () => {
    // The shell's rows keep their summary beside the title; the facts are not a
    // collapsed-only hint.
    const html = renderWith({ meta: { view }, call: { argsRaw: args } }, { inspect: () => {} })
    expect(html).toContain('debugLaunch')
    expect(html).toContain('debugInspect')
    // One card surface holds the sections, not a border per section.
    expect(html).toContain('bodyWrap')
  })

  it('falls back to the rendered text when the call carries no view', () => {
    const html = render({
      content: [{ type: 'text', text: 'Godot debug run: 1 stop' }],
      call: { argsRaw: args },
    })
    expect(html).toContain('Godot debug run: 1 stop')
  })

  it('marks a failed call and shows the failure text', () => {
    const html = render({
      isError: true,
      content: [{ type: 'text', text: 'GODOT_UNAVAILABLE: godot was not found' }],
      call: { argsRaw: args },
    })
    expect(html).toContain('failed')
    expect(html).toContain('GODOT_UNAVAILABLE')
  })
  it('marks every object the sample holds, nested ones included', () => {
    // The sample holds player (42) and its nested sprite (43); the tree's
    // Player row is that same object, so both rows carry the captured mark.
    const html = render({ meta: { view }, call: { argsRaw: args } })
    expect(html.match(/rowMarked/g)?.length).toBe(2)
  })

  it('renders a sample only at the pause that took it', () => {
    const second = { ...view, stops: [view.stops[0], { ...view.stops[0], index: 1 }] }
    const html = render({ meta: { view: second }, call: { argsRaw: args } })
    expect(html).toContain('debugNoExpansionHere')
  })

  it('says which of the three tree states this pause is in', () => {
    const noFrames = { ...view, stops: [{ ...view.stops[0], frames: [], sceneTree: undefined }] }
    expect(render({ meta: { view: noFrames }, call: { argsRaw: args } })).toContain('debugTreeNoFrames')
    const cut = { ...view, viewCut: 'sceneTree', stops: [{ ...view.stops[0], sceneTree: undefined }] }
    expect(render({ meta: { view: cut }, call: { argsRaw: args } })).toContain('debugTreeCut')
    const missed = { ...view, stops: [{ ...view.stops[0], sceneTree: undefined }] }
    expect(render({ meta: { view: missed }, call: { argsRaw: args } })).toContain('debugTreeNotCaptured')
  })

  it('reports the slice size and its own bound', () => {
    const bounded = {
      ...view,
      stops: [{ ...view.stops[0], sceneTree: { nodes: view.stops[0]!.sceneTree!.nodes, truncated: true } }],
    }
    const html = render({ meta: { view: bounded }, call: { argsRaw: args } })
    expect(html).toContain('debugTreeNodeCount')
    expect(html).toContain('debugTreeTruncated')
  })

})
