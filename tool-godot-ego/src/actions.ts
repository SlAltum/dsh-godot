/**
 * `godot_actions`: list the InputMap actions the project defines, so
 * `godot_key` can drive named actions instead of raw keycodes.
 * @module @deepseek-ai/dsh-tool-godot-ego/actions
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GameSessionRegistry } from './session-service.ts'
import { sessionFor } from './tool-support.ts'

/** What `godot_actions` returns to the model. */
export interface ActionsResult {
  readonly actions: string[]
  readonly count: number
}

/** Render the action list. */
function renderActions(value: ActionsResult): string {
  if (value.actions.length === 0) return 'This project defines no InputMap actions.'
  return [`InputMap actions (${value.count})`, ...value.actions.map(name => `  ${name}`)].join('\n')
}

/**
 * Build the `godot_actions` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function actionsTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_actions',
    description: 'List the InputMap actions defined by the running project. '
      + 'Pass any of these names to godot_key action to press or release an action without knowing its key.',
    parameters: {},
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          actions: { type: 'array', items: { type: 'string' }, required: true },
          count: { type: 'number', required: true },
        },
      },
      render: (_args, value: ActionsResult) => [{ type: 'text', text: renderActions(value) }],
    },
    async execute(_args, exec): Promise<ActionsResult> {
      const session = sessionFor(registry, exec)
      const reply = await session.request('actions', {}, exec.signal)
      const actions = (Array.isArray(reply.payload.actions) ? reply.payload.actions : [])
        .filter((name): name is string => typeof name === 'string')
      return { actions, count: actions.length }
    },
  })
}
