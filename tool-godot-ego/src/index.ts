/**
 * Plugin entry: provides `godot.egoSessions` and owns the session lifetime.
 *
 * Composition contract (plan §3):
 * - `inject` declares the services the plugin cannot work without; the
 *   package activates only when they are present.
 * - `ctx.provide` publishes the registry; `ctx.effect` registers its inverse,
 *   so removing the plugin (config reload, provider swap, process shutdown)
 *   disposes every game session before the service disappears.
 * - Tools, the system-prompt section, and the viewer route are effect-scoped
 *   the same way: removing the plugin removes them before the service goes.
 * @module @deepseek-ai/dsh-tool-godot-ego
 */

import type { Context } from '@deepseek-ai/cordis'
import { actionsTool } from './actions.ts'
import { callTool } from './call.ts'
import { resolveConfig } from './config.ts'
import type { EgoConfig } from './config.ts'
import { diffTool } from './diff.ts'
import { evalTool } from './eval.ts'
import { findTool } from './find.ts'
import { inputTools } from './input.ts'
import { logsTool } from './logs.ts'
import { nodeTool } from './node.ts'
import { createPlayFactory, playTool } from './play.ts'
import { sceneTool } from './scene.ts'
import { seeTool } from './see.ts'
import { stateTool } from './state.ts'
import { statusTool } from './status.ts'
import { stopTool } from './stop.ts'
import { viewRoute } from './view-route.ts'
import { waitForTool } from './wait-for.ts'
import { GameSessionRegistry } from './session-service.ts'
import type { EgoSessionFactory } from './session-service.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-godot-ego'

/** Services required before the plugin activates. */
export const inject = ['subprocess']

export { Config, resolveConfig, validateConfig } from './config.ts'
export type { EgoConfig, ResolvedEgoConfig } from './config.ts'
export { EgoGodotError } from './errors.ts'
export type { EgoGodotErrorCode } from './errors.ts'
export { GameSessionRegistry } from './session-service.ts'
export type {
  EgoDisposeFailure,
  EgoEnsureResult,
  EgoPlayOptions,
  EgoSessionFactory,
  EgoSessionHandle,
} from './session-service.ts'

/** Composition seam: deployments and tests may supply the session factory. */
export interface EgoPluginDeps {
  readonly factory?: EgoSessionFactory
}

/**
 * Cordis entry point.
 * @param ctx - the plugin context.
 * @param config - deployment config (defaults filled here).
 */
export function apply(ctx: Context, config: EgoConfig = {}): void {
  applyWith(ctx, config, {})
}

/**
 * Register the plugin with an explicit session factory (composition seam).
 * @param ctx - the plugin context.
 * @param config - deployment config; validated before anything is registered.
 * @param deps - optional factory override; production omits it.
 */
export function applyWith(ctx: Context, config: EgoConfig, deps: EgoPluginDeps): void {
  // Validate at load: a bad budget must fail here, never mid-session.
  const resolved = resolveConfig(config)
  const registry = new GameSessionRegistry(deps.factory ?? createPlayFactory(ctx, resolved))
  ctx.provide('godot.egoSessions', registry)
  ctx.effect(() => () => registry.disposeAll(), 'tool-godot-ego.sessions')
  // Spatial composability: tools appear only where the tool registry exists.
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(playTool(registry))
    toolCtx.tools.register(stopTool(registry))
    toolCtx.tools.register(sceneTool(registry))
    toolCtx.tools.register(statusTool(registry))
    toolCtx.tools.register(stateTool(registry, resolved))
    toolCtx.tools.register(seeTool(toolCtx, registry, resolved))
    toolCtx.tools.register(diffTool(registry))
    toolCtx.tools.register(nodeTool(registry, resolved))
    toolCtx.tools.register(callTool(registry))
    toolCtx.tools.register(findTool(registry))
    toolCtx.tools.register(logsTool(registry))
    toolCtx.tools.register(actionsTool(registry))
    if (resolved.allowEval) toolCtx.tools.register(evalTool(registry))
    const inputs = inputTools(registry)
    toolCtx.tools.register(inputs.click)
    toolCtx.tools.register(inputs.key)
    toolCtx.tools.register(inputs.type)
    toolCtx.tools.register(inputs.fill)
    toolCtx.tools.register(inputs.check)
    toolCtx.tools.register(inputs.hover)
    toolCtx.tools.register(inputs.drag)
    toolCtx.tools.register(inputs.scroll)
    toolCtx.tools.register(inputs.wait)
    toolCtx.tools.register(waitForTool(registry))
  })
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => viewRoute(webCtx, registry), 'tool-godot-ego.view')
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'godot-ego',
      order: 50,
      text: 'Godot visual sandbox: call godot_play to start the project, godot_see to look at the current frame '
        + '(crop with target for detail), godot_state for the scene tree and clickable Control paths, '
        + 'godot_click / godot_key / godot_type / godot_fill / godot_check / godot_hover / godot_drag / godot_scroll to operate it, '
        + 'godot_wait or godot_wait_for before the next capture, godot_node for live property values, '
        + 'godot_call to invoke one node method and read its return value, '
        + 'godot_find to locate a Control by name/class/text, godot_actions for InputMap action names, '
        + 'godot_scene to report or switch scenes, godot_diff to measure visual change, godot_status for the session, '
        + 'godot_logs for print and error output, and godot_stop when done. '
        + 'Prefer clicking by Control path: it is deterministic. '
        + 'Every point you pass or read back is in the game viewport\'s own canvas space, not window pixels; '
        + 'godot_hover fails instead of reporting success when the requested Control was not reached.',
    })
  })
}
