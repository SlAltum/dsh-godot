// @vitest-environment jsdom
/**
 * The shipped `lib/client.js` contract, checked against the file the loader gets.
 *
 * Three failures are silent in production and expensive to find there:
 *  - a bundle registered under any id but the package name is classified as
 *    "not a client row" and the whole surface disappears;
 *  - a `require()` the shell module table cannot answer throws only at
 *    materialization, after boot;
 *  - an unscoped stylesheet class (`card`, `btn`) silently restyles the host.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const ID = '@deepseek-ai/dsh-ui-godot'

/** Shell module table: the implicit client baseline this bundle may request. */
const BASELINE = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

interface Handoff {
  id: string
  factory: (require: (spec: string) => unknown) => Record<string, unknown>
}

/** Just enough of each baseline module for the bundle body to execute. */
const STUBS: Record<string, unknown> = {
  'react': {
    Component: class {
      // The bundle declares an error boundary at module scope; `extends` needs a base.
      props: unknown
      state: unknown
      render(): unknown { return null }
    },
    createElement: () => null,
    memo: (component: unknown) => component,
    useCallback: (fn: unknown) => fn,
    useRef: () => ({ current: undefined }),
    useState: () => [undefined, () => {}],
    useSyncExternalStore: () => undefined,
  },
  'react/jsx-runtime': { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null },
  '@deepseek-ai/dsh-client-store': {
    createSnapshotStore: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
  },
  '@deepseek-ai/dsh-client-ui-primitives': {
    DisclosureRow: () => null,
    TextShimmer: () => null,
    IconPanelLeftOutlineRegular: () => null,
    Tooltip: (props: { children?: unknown }) => props.children,
  },
}

/** Execute the artifact in jsdom and capture what it registers. */
function register(): Handoff {
  const code = readFileSync(resolve(import.meta.dirname, '../lib/client.js'), 'utf8')
  let handoff: Handoff | undefined
  const win = window as unknown as { __ModuleLoader__?: { load(h: Handoff): void } }
  win.__ModuleLoader__ = { load(h) { handoff = h } }
  new Function('window', code)(win)
  if (handoff === undefined) throw new Error('lib/client.js did not register a factory')
  return handoff
}

/** Materialize the factory, recording every module-table request it makes. */
function materialize(handoff: Handoff): { exports: Record<string, unknown>, requested: string[] } {
  const requested: string[] = []
  const exports = handoff.factory((spec) => {
    requested.push(spec)
    if (!BASELINE.has(spec)) throw new Error(`require("${spec}") is not in the client baseline`)
    return STUBS[spec]
  })
  return { exports, requested }
}

beforeEach(() => { document.head.innerHTML = '' })

describe('lib/client.js', () => {
  it('registers under the package name the boot manifest keys rows by', () => {
    expect(register().id).toBe(ID)
  })

  it('materializes with baseline modules only and exports the plugin body', () => {
    const { exports, requested } = materialize(register())
    expect([...new Set(requested)].filter(spec => !BASELINE.has(spec))).toEqual([])
    expect(exports.inject).toEqual(['slots', 'locale', 'configForms', 'documentPreviews'])
    expect(typeof exports.apply).toBe('function')
  })

  it('injects its stylesheets with scoped class names', () => {
    materialize(register())
    const styles = [...document.head.querySelectorAll('style[data-plugin="ui-godot"]')]
    expect(styles.length).toBeGreaterThan(0)
    const text = styles.map(style => style.textContent ?? '').join('\n')
    expect(text).toContain('godot_GodotCard_module_css_card')
    expect(text).toContain('godot_GodotWatch_module_css_ball')
    // Nothing bare survives: a top-level `.card` rule would restyle the host.
    expect(text).not.toMatch(/^\.card\s*\{/m)
  })
})
