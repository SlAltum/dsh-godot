/**
 * `godot_eval`: evaluate one expression inside the running game. Registered
 * only when `allowEval` is on (plan D8); the bridge re-checks the env gate.
 * @module @deepseek-ai/dsh-tool-godot-ego/eval
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GameSessionRegistry } from './session-service.ts'
import { sessionFor } from './tool-support.ts'

/** `godot_eval` arguments. */
export interface EvalArgs {
  expression: string
}

/**
 * Build the `godot_eval` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function evalTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_eval',
    description: 'Evaluate one GDScript expression inside the running game and return its value. '
      + 'Only registered when the deployment enables allowEval; prefer godot_state/godot_node for observation.',
    parameters: {
      expression: { type: 'string', required: true, description: 'GDScript expression, for example, "get_tree().paused" or "Engine.get_frames_per_second()".' },
    },
    timeoutMs: 30_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          value: { type: 'string', required: true },
          type: { type: 'string', required: true },
        },
      },
      render: (_args, value: { value: string; type: string }) => [{ type: 'text', text: `${value.value} (${value.type})` }],
    },
    async execute(args: EvalArgs, exec) {
      const session = sessionFor(registry, exec)
      const reply = await session.request('eval', { expression: args.expression }, exec.signal)
      return {
        value: JSON.stringify(reply.payload.value ?? null),
        type: typeof reply.payload.type === 'string' ? reply.payload.type : 'unknown',
      }
    },
  })
}
