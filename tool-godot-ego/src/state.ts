/**
 * `godot_state`: one bounded snapshot of the running game — header, scene
 * tree, clickable Controls, and (optionally) what changed since the previous
 * snapshot. Rendering lives in `targets.ts`; this module owns the request and
 * the model-facing projection.
 * @module @deepseek-ai/dsh-tool-godot-ego/state
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ResolvedEgoConfig } from './config.ts'
import { EgoGodotError } from './errors.ts'
import type { GameSessionRegistry } from './session-service.ts'
import { renderState } from './targets.ts'

/** `godot_state` arguments. */
export interface StateArgs {
  tree?: boolean
  targets?: boolean
  maxNodes?: number
  diff?: boolean
}

/** What `godot_state` returns to the model. */
export interface StateResult {
  readonly snapshot: string
}

/**
 * Build the `godot_state` tool definition.
 * @param registry - the plugin-owned session registry.
 * @param config - resolved plugin config (node budget default).
 * @returns the tool definition.
 */
export function stateTool(registry: GameSessionRegistry, config: ResolvedEgoConfig): ToolDefinition {
  return defineTool({
    name: 'godot_state',
    description: 'Read the running game state: scene path, fps, frame number, node count, pause flag, '
      + 'the bounded scene tree, and every visible clickable Control with its path, rect, and text. '
      + 'Use the Control paths with godot_click for deterministic clicks, and diff: true to see only what changed.',
    parameters: {
      tree: { type: 'boolean', description: 'Include the scene tree (default true).' },
      targets: { type: 'boolean', description: 'Include the clickable Control list (default true).' },
      maxNodes: { type: 'number', description: 'Scene-tree node budget; defaults to the configured value.' },
      diff: { type: 'boolean', description: 'Include appeared/changed/disappeared Controls since the previous snapshot.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { snapshot: { type: 'string', required: true } },
      },
      render: (_args, value: StateResult) => [{ type: 'text', text: value.snapshot }],
    },
    async execute(args: StateArgs, exec): Promise<StateResult> {
      const workspace = exec.agent?.session.header.cwd ?? process.cwd()
      const session = registry.get(workspace)
      if (session === undefined) {
        throw new EgoGodotError('no running game session; call godot_play first', 'GODOT_EGO_NO_SESSION')
      }
      const maxNodes = args.maxNodes ?? config.maxNodes
      const reply = await session.request('state', {
        tree: args.tree ?? true,
        targets: args.targets ?? true,
        diff: args.diff === true,
        maxNodes,
      }, exec.signal)
      return { snapshot: renderState(reply.payload, { maxNodes, maxTargets: 60 }) }
    },
  })
}
