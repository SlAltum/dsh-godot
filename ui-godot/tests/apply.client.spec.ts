/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const describe = vi.fn(() => Promise.resolve({ rpcId: 's', result: { ok: false as const, error: {} } }))
  new TestRemote(ctx)
  ctx.provide('connection', {
    isLoopback: true,
    api: { settings: { describe } },
  } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugin.item': { kind: 'keyed', scope: 'root' } },
  } as never, () => null)
}

describe('ui-godot apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
  })

  it('registers the Godot card under the godot namespace key', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(slots.entries('settings.plugin.item').map(entry => entry.options.key)).toEqual(['godot'])
    const entry = slots.entries('settings.plugin.item')[0]!
    const face = (entry as { inject?: () => unknown }).inject?.() as { hooks: Record<string, unknown> }
    // The card injects exactly one snapshot store plus its own actions.
    expect(Object.keys(face.hooks)).toEqual(['godotCard'])
    expect(face).toHaveProperty('edit')
    expect(face).toHaveProperty('save')
  })

  it('registers the card into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.plugin.item')).toHaveLength(0)

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.plugin.item')).toHaveLength(1) })
  })

  it('collapses the contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.plugin.item')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('settings.plugin.item')).toHaveLength(0)
  })
})
