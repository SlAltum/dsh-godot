// @vitest-environment jsdom
/**
 * Real tsdown artifact shape: lib/client.js hands off through
 * window.__ModuleLoader__.load, resolves externals through the injected
 * require, returns the exports (apply + inject), and a mounted apply
 * registers the Godot card into a real SlotRegistry ring. Skips when dist/ is
 * not built (`pnpm --filter @deepseek-ai/dsh-ui-godot bundle`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'

const PLUGIN_ID = '@deepseek-ai/dsh-ui-godot'

interface Handoff { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> }
type Win = { __ModuleLoader__?: { load(h: Handoff): void } }

function readBundle(): string | undefined {
  try {
    return readFileSync(resolve('packages/godot/ui-godot/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  for (const el of document.querySelectorAll('style')) el.remove()
})

describe('tsdown client artifact', () => {
  const code = readBundle()

  async function loadArtifact() {
    let handoff: Handoff | undefined
    ;(window as Win).__ModuleLoader__ = { load: (h) => { handoff = h } }
    // The implied-eval ban targets accidental string execution, not this
    // deliberate built-bundle fixture running in the window scope.
    // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
    new Function(code!)()
    expect(handoff).toBeDefined()
    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
      ['react-dom', await import('react-dom')],
      ['@deepseek-ai/dsh-client-store', await import('@deepseek-ai/dsh-client-store')],
      ['@deepseek-ai/dsh-client-ui-primitives', await import('@deepseek-ai/dsh-client-ui-primitives')],
    ])
    const exports = handoff!.factory((spec) => {
      if (!modules.has(spec)) throw new Error(`unexpected require: ${spec}`)
      return modules.get(spec)
    })
    return { handoff: handoff!, exports }
  }

  it.skipIf(code === undefined)('hands off with the manifest id and a DI-require factory', async () => {
    const { handoff, exports } = await loadArtifact()
    expect(handoff.id).toBe(PLUGIN_ID)
    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual(['slots', 'locale', 'configForms'])
  })

  it.skipIf(code === undefined)('mounted as an object plugin, apply registers the Godot card on the real ring', async () => {
    const { exports } = await loadArtifact()
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.slots
    // The Plugins page declares the card slot; this registration-only probe
    // declares it directly.
    slots.register({
      name: 'root',
      children: { 'plugins.item': { kind: 'list', scope: 'root' } },
    }, (_p: { renderSlot?: unknown }) => null)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    // The shared configuration forms the card edits through. This probe never
    // reads a Host document, so the scope stub stands in and whileServed
    // registers as if the Host served the tool-godot entry.
    ctx.provide('configForms', {
      developerTools: { enabled: createSnapshotStore(true) },
      get: () => stubConfigForm().scope,
      whileServed: (_namespaces: readonly string[], register: () => () => void) => register(),
    } as never)
    const locale = await import('@deepseek-ai/dsh-client-locale/client')
    await ctx.plugin({ inject: [...locale.inject], apply: locale.apply }).await()
    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void; inject: string[] })
    await fiber.await()

    expect(slots.entries('plugins.item').map(entry => entry.options.id)).toEqual(['tool-godot'])
    await fiber.dispose()
    expect(slots.entries('plugins.item')).toHaveLength(0)
  })

  it.skipIf(code === undefined)('injects plugin-tagged module CSS during factory execution', async () => {
    await loadArtifact()
    const tags = document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`)
    expect(tags.length).toBeGreaterThan(0)
  })
})
