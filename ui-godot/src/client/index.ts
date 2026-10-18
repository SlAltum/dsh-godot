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
// Type-only: the Plugin manager's SlotMap merge for 'plugins.item' and
// the ctx.configForms Context merge. Cross-plugin collaboration goes through
// the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the shell's `shell.overlay` list slot the watch panel registers into.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { GodotCard } from './GodotCard.tsx'
import { GodotWatch } from './GodotWatch.tsx'
import { GODOT_NS, GodotCardController } from './godot-card-controller.ts'
import { GodotWatchController, WATCH_NS } from './godot-watch-controller.ts'
import { en, zh, type GodotLocaleKey } from './locales.ts'

export type { GodotCardProps } from './GodotCard.tsx'
export type { GodotCardFace, GodotCardState, GodotSettings } from './godot-card-controller.ts'
export type { GodotLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Godot settings card copy. */
    'settings.godot': GodotLocaleKey
    /** Godot watch panel copy. */
    'godot.watch': GodotLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.godot'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale', 'configForms']

/** Contribute the Godot card to the Plugins page while the Host serves its entry. */
/** The installable bundle whose page carries the Godot settings card. */
export const GODOT_BUNDLE = '@deepseek-ai/dsh-godot-bundle'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-godot: dictionaries')
  ctx.effect(() => ctx.locale.register(WATCH_NS, { zh, en }), 'ui-godot: watch dictionary')

  const godot = new GodotCardController(ctx.configForms.get(GODOT_NS))
  ctx.effect(() => () => { godot.dispose() }, 'ui-godot: form subscription')
  // The card configures the `tool-godot` row, but it is contributed to the
  // Godot bundle's page: Godot is an installed capability bundle, so its
  // settings live under Installed plugins, not the built-in configuration list.
  ctx.effect(() => ctx.configForms.whileServed([GODOT_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: GODOT_BUNDLE, locale: NS, inject: () => godot.inject(),
  }, GodotCard))), 'ui-godot: page')

  // Watch panel: a frame-wide overlay ball that polls the sandbox's session
  // list and streams the running game. Polling starts only once the shell
  // declares `shell.overlay`, so a page without the overlay seats nothing.
  // The panel is optional chrome: a failure here is logged and leaves the
  // settings card working instead of failing the whole client fiber.
  const watch = new GodotWatchController()
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => {
    let dispose: (() => void) | undefined
    try {
      dispose = ctx.slots.register({
        name: 'shell.overlay', id: 'godot.watch', order: 40, locale: WATCH_NS, inject: () => watch.inject(),
      }, GodotWatch)
      watch.start()
      return () => { watch.dispose(); dispose?.() }
    } catch (error: unknown) {
      ctx.logger.warn(error)
      watch.dispose()
      dispose?.()
      return () => {}
    }
  }), 'ui-godot: watch')
}
