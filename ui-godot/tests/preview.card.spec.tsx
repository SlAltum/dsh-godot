/**
 * Render the `godot_debug` card to a standalone HTML page for visual review.
 *
 * Opt-in (`PREVIEW=1`), because it writes a file rather than asserting:
 *
 *     PREVIEW=1 npx vitest run tests/preview.card.spec.tsx
 *
 * The page inlines the real theme stylesheets and the card's own CSS modules
 * (rewritten to the class names the client build mints), so what it shows is the
 * card's actual layout and type — a screenshot of it answers "how does the card
 * look" without a signed-in shell.
 */

// @vitest-environment node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/** Rewrite one CSS module for the class names the build mints. */
function scope(css: string, scopeName: string): string {
  return css.replace(/\.([A-Za-z][\w-]*)/g, `._${scopeName}_$1`)
}

const THEME = resolve(
  process.env.DSH_CHECKOUT ?? 'D:/source_code/deepseek-harness',
  'packages/client/ui-theme/src/styles',
)

/** The page's `<style>` blocks: theme tokens, then the card's own modules. */
async function styles(): Promise<string> {
  const read = async (file: string): Promise<string> => readFile(file, 'utf8').catch(() => '')
  const theme = [
    await read(resolve(THEME, 'base.css')),
    await read(resolve(THEME, 'design-platform.css')),
    await read(resolve(THEME, 'gradient-shadow-text.css')),
  ].join('\n')
  const debugCard = scope(await read('src/client/debug/DebugCard.module.css'), 'DebugCard')
  const nodeTree = scope(await read('src/client/scene/NodeTree.module.css'), 'NodeTree')
  return `${theme}\n${debugCard}\n${nodeTree}`
}

/** The class a stubbed CSS module import returns for one local name. */
function stub(scopeName: string): { default: Record<string, string> } {
  return {
    default: new Proxy({}, {
      get: (_target, key) => `_${scopeName}_${String(key)}`,
    }) as Record<string, string>,
  }
}

vi.mock('../src/client/debug/DebugCard.module.css', () => stub('DebugCard'))
vi.mock('../src/client/scene/NodeTree.module.css', () => stub('NodeTree'))
// The row component's own stylesheet and dependency chain are not what this page
// shows; the card's content is.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  TextShimmer: (props: { children?: unknown }) => createElement('span', { class: '_DebugCard_facts' }, props.children as never),
  DisclosureRow: (props: { title: string; icon: unknown; collapsedContent?: unknown; children?: unknown }) =>
    createElement('div', { class: '_DebugCard_row' },
      props.icon as never,
      createElement('span', { class: '_DebugCard_name' }, props.title),
      props.collapsedContent as never,
      createElement('div', { class: '_DebugCard_body' }, props.children as never)),
}))
vi.mock('../src/client/assets/godot-logo.svg', () => ({
  // The real logo, inlined: a `file://` SVG is not fetchable from the page.
  default: `data:image/svg+xml;base64,${readFileSync('src/client/assets/godot-logo.svg').toString('base64')}`,
}))

const { DebugCard } = await import('../src/client/debug/DebugCard.tsx')
const { zh } = await import('../src/client/locales.ts')

/** A Gomoku-shaped view: one stop, a tree, an expanded node, an edit, output. */
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
    frames: [{ file: 'res://main.gd', line: 37, func: '_ready' }],
    varsLines: ['  members:', '    self = Object<27564967377>', '    _moves = 0', '    _current = 1'],
    sceneTree: {
      nodes: [{
        name: 'Main', className: 'res://main.gd', id: '27564967377', sceneFilePath: 'res://main.tscn',
        children: [
          { name: 'Background', className: 'ColorRect', id: '27598521811', sceneFilePath: '', children: [] },
          {
            name: 'Header', className: 'Control', id: '27632076247', sceneFilePath: '',
            children: [
              { name: 'HeaderMark', className: 'ColorRect', id: '27665630681', sceneFilePath: '', children: [] },
              { name: 'Eyebrow', className: 'Label', id: '27699185125', sceneFilePath: '', children: [] },
              { name: 'Title', className: 'Label', id: '27732739559', sceneFilePath: '', children: [] },
            ],
          },
          {
            name: 'Board', className: 'Control', id: '27833402861', sceneFilePath: '',
            children: [
              { name: 'BoardView', className: 'res://board_view.gd', id: '27866957295', sceneFilePath: '', children: [] },
              {
                name: 'BoardHits', className: 'Control', id: '27900511729', sceneFilePath: '',
                children: [
                  { name: 'Cell_00_00', className: 'Button', id: '30031218218', sceneFilePath: '', children: [] },
                  { name: 'Cell_00_01', className: 'Button', id: '30081549869', sceneFilePath: '', children: [] },
                ],
              },
            ],
          },
        ],
      }],
    },
  }],
  expansion: {
    stopIndex: 0,
    expandedObjects: 1,
    truncated: false,
    entries: [{
      name: 'Main', id: '27564967377', className: 'Control',
      rows: [
        { name: 'size', value: 'Vector2(1280, 720)' },
        { name: 'visible', value: 'true' },
        { name: '_moves', value: '0' },
      ],
      children: [],
    }],
  },
  edits: {
    stopIndex: 0,
    truncated: false,
    results: [{ target: 'Main', property: '_moves', requested: 3, type: 'int', ok: true }],
  },
  outputTail: ['Godot Engine v4.7.2.stable.official.ed1daf0bf'],
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

const running = process.env.PREVIEW === '1'

/** The client serves package assets from this route; the page reads them off disk. */
const ASSET_ROUTE = 'plugins/@deepseek-ai/dsh-ui-godot/assets/'

describe('card preview', () => {
  it.skipIf(!running)('writes an HTML page of the debug card', async () => {
    const html = renderToStaticMarkup(createElement(DebugCard, {
      t: (key: string) => (zh as Record<string, string>)[key] ?? key,
      block: {
        meta: view,
        call: { argsRaw: JSON.stringify({ mode: 'launch', path: 'gomoku', breakpoints: [{ file: 'res://main.gd', line: 37 }] }) },
      },
    } as never))
      // The class icons are package assets: read them from the built bundle. An
      // SVG behind `file://` cannot be masked, so each one is inlined.
      .replaceAll(ASSET_ROUTE, `file:///${resolve(process.cwd(), 'lib/assets').replaceAll('\\', '/')}/`)
      .replace(/file:\/\/\/[^"')]+\.svg/g, (url) => {
        try {
          return `data:image/svg+xml;base64,${readFileSync(url.replace('file:///', '')).toString('base64')}`
        } catch {
          return url
        }
      })
    const page = `<!doctype html><meta charset="utf-8"><title>godot_debug card</title>
<style>${await styles()}</style>
<style>
  body { margin: 0; padding: 24px; background: var(--dsw-alias-bg-layer-1, #fff); }
  .frame { max-width: 980px; }
</style>
<div class="frame" onclick="window.__rowClicks = (window.__rowClicks || 0) + 1">${html}</div>
<script>
  // Stands in for the transcript row that holds the card: it counts the clicks
  // that reach it, so a swallowed click and an escaping one can be told apart.
  window.__rowClicks = 0
</script>
`
    const out = resolve(process.cwd(), '../.context/card-preview.html')
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, page, 'utf8')
    expect(page).toContain('--dsw-alias-label-primary')
    expect(page).toContain('_DebugCard_stop')
  })
})
