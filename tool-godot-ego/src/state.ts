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
  maxTargets?: number
  offset?: number
  name?: string
  class?: string
  text?: string
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
      + 'With more Controls than one reply shows, narrow with name/class/text (case-insensitive substrings) '
      + 'or page with offset; the target header states the total and the range it printed. '
      + 'Use the Control paths with godot_click for deterministic clicks, and diff: true to see only what changed.',
    parameters: {
      tree: { type: 'boolean', description: 'Include the scene tree (default true).' },
      targets: { type: 'boolean', description: 'Include the clickable Control list (default true).' },
      maxNodes: { type: 'number', description: 'Scene-tree node budget; defaults to the configured value.' },
      maxTargets: { type: 'number', description: 'Clickable-Control lines to print (default 60).' },
      offset: { type: 'number', description: 'Controls to skip before printing, to page a long list.' },
      name: { type: 'string', description: 'Keep Controls whose path contains this substring.' },
      class: { type: 'string', description: 'Keep Controls whose class contains this substring (for example, "Button").' },
      text: { type: 'string', description: 'Keep Controls whose visible text contains this substring.' },
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
      // The bridge cap is what actually bounds the list; ask for enough that a
      // filtered or paged view can reach any Control.
      const maxTargets = args.maxTargets ?? 60
      const offset = args.offset ?? 0
      const reply = await session.request('state', {
        tree: args.tree ?? true,
        targets: args.targets ?? true,
        diff: args.diff === true,
        maxNodes,
        maxTargets: Math.max(maxTargets + offset, 2000),
      }, exec.signal)
      return {
        snapshot: renderState(reply.payload, {
          maxNodes,
          maxTargets,
          offset,
          filter: {
            ...(args.name !== undefined ? { name: args.name } : {}),
            ...(args.class !== undefined ? { className: args.class } : {}),
            ...(args.text !== undefined ? { text: args.text } : {}),
          },
        }),
      }
    },
  })
}
