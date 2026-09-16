/**
 * Godot settings card, browser half — the persistent replacement for the
 * dynamic UI plugin's settings card (`settings.plugin.item`, keyed 'godot').
 *
 * The card edits the `godot` settings namespace through the client settings
 * scope; the namespace itself is owned by the host-plane tool-godot package,
 * so this package carries zero host code. The card is a dsh.client row in the
 * deployment composition, which is what makes it survive process restarts
 * (the dynamic plugin was process-memory-only).
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the settings shell's SlotMap merge for
// 'settings.plugin.item' (declared by the slot's declarer) and the
// ctx.settingsScope Context merge. Cross-plugin collaboration goes through
// the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { GodotCard } from './GodotCard.tsx'
import { GODOT_NS, GodotCardController } from './godot-card-controller.ts'
import { en, zh, type GodotLocaleKey } from './locales.ts'

export type { GodotCardProps } from './GodotCard.tsx'
export type { GodotCardFace, GodotCardState, GodotSettings } from './godot-card-controller.ts'
export type { GodotLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Godot settings card copy. */
    'settings.godot': GodotLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.godot'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Contribute the Godot settings card to the plugin configuration section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-godot: dictionaries')

  const godot = new GodotCardController(ctx.settingsScope.bind({ namespace: GODOT_NS }))

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: GODOT_NS,
      locale: NS,
      inject: () => godot.inject(),
    }, GodotCard)
  })
}
