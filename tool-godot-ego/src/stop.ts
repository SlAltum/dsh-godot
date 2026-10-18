/**
 * `godot_stop`: end the workspace's session.
 *
 * The graceful path asks the bridge to quit, waits for the process within the
 * configured grace, then disposes; a lost or unresponsive session is reaped by
 * the same call. Repeating it is safe: with no session the result is
 * `{ stopped: false }` — the composability contract's idempotent inverse.
 * @module @deepseek-ai/dsh-tool-godot-ego/stop
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GameSessionRegistry } from './session-service.ts'

/** What `godot_stop` returns to the model. */
export interface StopResult {
  readonly stopped: boolean
  readonly sessionId?: string
  readonly exitCode?: number
  readonly signal?: string
}

/**
 * Build the `godot_stop` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function stopTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_stop',
    description: 'Stop the running game session started by godot_play. '
      + 'Waits for the game to exit, escalates to termination if it does not, and reports the exit code or signal. '
      + 'Calling it with no running session is safe and returns stopped: false.',
    parameters: {},
    timeoutMs: 30_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stopped: { type: 'boolean', required: true },
          sessionId: { type: 'string' },
          exitCode: { type: 'number' },
          signal: { type: 'string' },
        },
      },
      render: (_args, value: StopResult) => {
        const detail = value.exitCode !== undefined
          ? ` (exit ${value.exitCode})`
          : value.signal !== undefined ? ` (${value.signal})` : ''
        return [{ type: 'text', text: value.stopped ? `stopped session ${value.sessionId}${detail}` : 'no running session for this workspace' }]
      },
    },
    async execute(_args, exec): Promise<StopResult> {
      const workspace = exec.agent?.session.header.cwd ?? process.cwd()
      const result = await registry.stop(workspace)
      if (!result.stopped) return { stopped: false }
      return {
        stopped: true,
        sessionId: result.sessionId,
        ...(typeof result.exitCode === 'number' ? { exitCode: result.exitCode } : {}),
        ...(typeof result.signal === 'string' ? { signal: result.signal } : {}),
      }
    },
  })
}
