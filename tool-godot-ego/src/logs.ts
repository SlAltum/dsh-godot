/**
 * `godot_logs`: read the game process's captured stdout/stderr incrementally.
 * The session keeps the subprocess handle; the tool passes a byte cursor back
 * so the model can follow output without re-reading history.
 * @module @deepseek-ai/dsh-tool-godot-ego/logs
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { EgoGodotError } from './errors.ts'
import type { GameSessionRegistry } from './session-service.ts'
import { sessionFor } from './tool-support.ts'

/** `godot_logs` arguments. */
export interface LogsArgs {
  since?: number
  maxBytes?: number
}

/** What `godot_logs` returns to the model. */
export interface LogsResult {
  readonly text: string
  readonly nextOffset: number
}

/**
 * Build the `godot_logs` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function logsTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_logs',
    description: 'Read the running game\'s captured output: print() lines, script errors, and engine errors. '
      + 'Pass the previous nextOffset as since to read only new output; the reply returns the next cursor.',
    parameters: {
      since: { type: 'number', description: 'Byte offset to read from (default 0, or the previous nextOffset).' },
      maxBytes: { type: 'number', description: 'Maximum bytes per stream (default 4096).' },
    },
    timeoutMs: 30_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          nextOffset: { type: 'number', required: true },
        },
      },
      render: (_args, value: LogsResult) => [{ type: 'text', text: value.text }],
    },
    execute(args: LogsArgs, exec): Promise<LogsResult> {
      // A resolved promise turns the synchronous lookup/limit failures into rejections.
      return Promise.resolve().then(() => {
        const session = sessionFor(registry, exec)
        if (session.logs === undefined) {
          throw new EgoGodotError('this session does not capture process output', 'GODOT_EGO_UNAVAILABLE')
        }
        const result = session.logs(args.since ?? 0, args.maxBytes ?? 4096)
        const parts: string[] = []
        if (result.stdout !== '') parts.push(`stdout:\n${result.stdout}`)
        if (result.stderr !== '') parts.push(`stderr:\n${result.stderr}`)
        return { text: parts.length === 0 ? '(no new output)' : parts.join('\n'), nextOffset: result.nextOffset }
      })
    },
  })
}
