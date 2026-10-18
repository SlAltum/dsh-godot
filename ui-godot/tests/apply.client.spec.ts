/** What the browser half registers, when, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, NS } from '../src/client/index.ts'
import type { GodotCardFace } from '../src/client/index.ts'

/** One Host view of a served namespace. */
function view(ns: string, revision = 0) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision }
}

/**
 * @param served - namespaces the Host describes; omitted answers a failed read,
 * which leaves the page nothing to register for.
 */
async function bench(served?: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { ok: false, error: new RemoteError('gateway/internal', 'no provider', {}) }
    : { ok: true, value: { writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)) } }))
  const remote = new TestRemote(ctx, { settings: { describe: describeSettings } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeSettings, remote }
}

/** The Plugins page's item slot, as its owner declares it. */
function declareRoot(slots: SlotRegistry, overlay = false): () => void {
  return slots.register({
    name: 'root',
    children: {
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      ...(overlay ? { 'shell.overlay': { kind: 'list', scope: 'root' } } : {}),
    },
  } as never, () => null)
}

describe('ui-godot apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms'])
  })

  it('registers the Godot card while the Host serves its entry', async () => {
    const { ctx, slots } = await bench(['tool-godot'])
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })
    const entry = slots.entries('plugins.bundle.config')[0]!
    expect(entry.options).toMatchObject({ key: '@deepseek-ai/dsh-godot-bundle' })
    expect(entry.locale).toBe(NS)
    const face = (entry.inject as () => Pick<GodotCardFace, 'hooks'>)()
    expect(Object.keys(face.hooks)).toEqual(['godotCard'])
    expect(face.hooks.godotCard.getSnapshot()).toMatchObject({ available: false, dirty: false })
  })

  it('registers nothing while the entry is not served, and follows the Host when that changes', async () => {
    const { ctx, slots, describeSettings, remote } = await bench(['agent-loop'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)

    describeSettings.mockResolvedValue({
      ok: true, value: { writable: true, hasDocument: true, namespaces: [view('tool-godot', 1)] },
    })
    remote.emit('settings/document-updated', ['tool-godot', 1])
    await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })

    describeSettings.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } })
    remote.emit('settings/document-updated', ['tool-godot', 2])
    await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(0) })
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench(['tool-godot'])
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })
  })

  it('collapses the card on teardown', async () => {
    const { ctx, slots } = await bench(['tool-godot'])
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })

    await fiber.dispose()

    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
  })

  it('registers the watch panel into shell.overlay and removes it on teardown', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [] }) }))
    vi.stubGlobal('fetch', fetch)
    try {
      const { ctx, slots } = await bench(['tool-godot'])
      declareRoot(slots, true)
      const fiber = ctx.plugin({ inject: [...inject], apply })
      await fiber.await()
      await vi.waitFor(() => { expect(slots.entries('shell.overlay')).toHaveLength(1) })
      const entry = slots.entries('shell.overlay')[0]!
      expect(entry.options).toMatchObject({ id: 'godot.watch', order: 40 })
      expect(entry.locale).toBe('godot.watch')
      const face = (entry.inject as () => { hooks: Record<string, unknown> })()
      expect(Object.keys(face.hooks)).toEqual(['watch'])
      await vi.waitFor(() => { expect(fetch).toHaveBeenCalledWith('/api/godot/sessions', { headers: { accept: 'application/json' } }) })

      await fiber.dispose()
      expect(slots.entries('shell.overlay')).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the settings card when the watch panel cannot start', async () => {
    const setIntervalStub = vi.fn(() => { throw new TypeError('Illegal invocation') })
    vi.stubGlobal('setInterval', setIntervalStub)
    try {
      const { ctx, slots } = await bench(['tool-godot'])
      declareRoot(slots, true)
      const fiber = ctx.plugin({ inject: [...inject], apply })
      await fiber.await()
      await vi.waitFor(() => { expect(slots.entries('plugins.bundle.config')).toHaveLength(1) })
      expect(slots.entries('shell.overlay')).toHaveLength(0)
      expect(setIntervalStub).toHaveBeenCalled()
      await fiber.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('has a no-op host entry', async () => {
    const host = await import('../src/index.ts')
    host.apply()
  })
})
