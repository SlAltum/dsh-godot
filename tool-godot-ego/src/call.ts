/**
 * `godot_call`: invoke a method on a live node.
 *
 * The sandbox can already read properties and inject input, but a hover effect,
 * an animation transition, or a save routine often proves itself only by being
 * invoked. This is the narrow form of that: one method on one node, with the
 * engine reporting the return value and the reply naming what it called, so a
 * no-op is not mistaken for a success.
 * @module @deepseek-ai/dsh-tool-godot-ego/call
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { EgoGodotError } from './errors.ts'
import type { GameSessionRegistry } from './session-service.ts'
import { formatValue } from './node.ts'
import { sessionFor } from './tool-support.ts'

/** `godot_call` arguments. */
export interface CallArgs {
  path: string
  method: string
  args?: unknown[]
}

/**
 * Build the `godot_call` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function callTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_call',
    description: 'Call a method on a live node and report its return value, for interaction that only a method '
      + 'invocation can verify (an animation transition, a save routine, a hover handler). '
      + 'Arguments are JSON scalars and strings. A method that needs vectors or objects is the wrong probe here, '
      + 'so drive the UI with godot_click instead. The reply names the node and method it called, so a missing method '
      + 'fails loudly instead of looking like a no-op.',
    parameters: {
      path: { type: 'string', required: true, description: 'Node path from godot_state, for example, "Main/HUD/StartButton".' },
      method: { type: 'string', required: true, description: 'Method name, for example, "show" or "_on_pressed".' },
      args: {
        type: 'array',
        description: 'Arguments in call order (JSON scalars, strings, arrays, and objects).',
      },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value: { text: string }) => [{ type: 'text', text: value.text }],
    },
    async execute(args: CallArgs, exec) {
      const session = sessionFor(registry, exec)
      if (args.method.trim().length === 0) throw new Error('method must be a non-empty string')
      const reply = await session.request('call', {
        path: args.path,
        method: args.method,
        args: args.args ?? [],
      }, exec.signal)
      if (typeof reply.payload.error === 'string') {
        const message = typeof reply.payload.message === 'string'
          ? reply.payload.message
          : `could not call ${args.method} on "${args.path}"`
        throw new EgoGodotError(message, 'GODOT_EGO_REJECTED')
      }
      const type = typeof reply.payload.type === 'string' ? reply.payload.type : ''
      const value = reply.payload.value
      const returned = type === 'null' || value === null
        ? 'no return value'
        : `${formatValue(value)}  (${type})`
      return { text: `${args.path}.${args.method}(${(args.args ?? []).map(formatValue).join(', ')}) → ${returned}` }
    },
  })
}
