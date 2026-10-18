/**
 * `godot_status`: report the session's lifecycle snapshot without touching the
 * game process. Useful after a crash (where the session is kept for `lostReason`)
 * and to see which window size the handshake reported.
 * @module @deepseek-ai/dsh-tool-godot-ego/status
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GameSessionRegistry } from './session-service.ts'
import { sessionFor } from './tool-support.ts'

/** What `godot_status` returns to the model. */
export interface StatusResult {
  readonly sessionId: string
  readonly state: string
  readonly pid?: number
  readonly window?: [number, number]
  readonly lostReason?: string
  readonly projectRoot?: string
  readonly imported?: boolean
}

/** Render the snapshot as one header line plus optional detail lines. */
function renderStatus(value: StatusResult): string {
  const pid = value.pid !== undefined ? ` · pid ${value.pid}` : ''
  const lines = [`session ${value.sessionId} · ${value.state}${pid}`]
  if (value.window !== undefined) lines.push(`window ${value.window[0]}x${value.window[1]}`)
  if (value.projectRoot !== undefined) {
    const imported = value.imported === true ? ' (imported)' : ''
    lines.push(`project ${value.projectRoot}${imported}`)
  }
  if (value.lostReason !== undefined) lines.push(`lost: ${value.lostReason}`)
  return lines.join('\n')
}

/**
 * Build the `godot_status` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function statusTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_status',
    description: 'Report the running game session: lifecycle state, pid, window size, project root, and the reason if the session was lost. '
      + 'Reads the host-side session only; it does not contact the game.',
    parameters: {},
    timeoutMs: 30_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true },
          state: { type: 'string', required: true },
          pid: { type: 'number' },
          window: { type: 'array', items: { type: 'number' } },
          lostReason: { type: 'string' },
          projectRoot: { type: 'string' },
          imported: { type: 'boolean' },
        },
      },
      render: (_args, value: StatusResult) => [{ type: 'text', text: renderStatus(value) }],
    },
    execute(_args, exec): Promise<StatusResult> {
      const session = sessionFor(registry, exec)
      const snapshot = session.snapshot?.()
      return Promise.resolve({
        sessionId: session.sessionId,
        state: snapshot?.state ?? 'unknown',
        ...(session.pid !== null ? { pid: session.pid } : {}),
        ...(snapshot?.window != null ? { window: [snapshot.window[0], snapshot.window[1]] as [number, number] } : {}),
        ...(snapshot?.lostReason != null ? { lostReason: snapshot.lostReason } : {}),
        ...(session.projectRoot !== undefined ? { projectRoot: session.projectRoot } : {}),
        ...(session.imported !== undefined ? { imported: session.imported } : {}),
      })
    },
  })
}
