/**
 * Godot settings card, browser half — the persistent replacement for the
 * dynamic UI plugin's settings card.
 *
 * The card edits the composed `tool-godot` entry's config through the shared
 * configuration form; the entry itself is owned by the host-plane tool-godot
 * package, so this package carries zero host code. The card is a dsh.client
 * row in the deployment composition, which is what makes it survive process
 * restarts (the dynamic plugin was process-memory-only).
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Plugin manager's SlotMap merge for 'plugins.item' and
// the ctx.configForms Context merge. Cross-plugin collaboration goes through
// the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
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
export const inject = ['slots', 'locale', 'configForms']

/** Contribute the Godot card to the Plugins page while the Host serves its entry. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-godot: dictionaries')

  const godot = new GodotCardController(ctx.configForms.get(GODOT_NS))
  ctx.effect(() => () => { godot.dispose() }, 'ui-godot: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([GODOT_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: GODOT_NS, order: 20, label: () => t('name'), locale: NS, inject: () => godot.inject(),
  }, GodotCard))), 'ui-godot: page')
}
