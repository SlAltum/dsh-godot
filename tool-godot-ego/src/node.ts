/**
 * `godot_node`: read one node's properties. The bridge filters the property
 * list to stored/script variables and serializes values explicitly; this
 * module owns the whitelist/budget arguments and the model-facing rendering.
 * @module @deepseek-ai/dsh-tool-godot-ego/node
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ResolvedEgoConfig } from './config.ts'
import { EgoGodotError } from './errors.ts'
import type { GameSessionRegistry } from './session-service.ts'
import { sessionFor } from './tool-support.ts'

/** `godot_node` arguments. */
export interface NodeArgs {
  path: string
  props?: string[]
  maxProps?: number
  depth?: number
}

/**
 * Render one property value compactly (JSON-safe shapes from the bridge).
 * @param value - the bridge-provided JSON value.
 * @returns the compact rendering.
 */
export function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value).map(([key, inner]) => `${key}: ${formatValue(inner)}`).join(', ')}}`
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `<${typeof value}>`
}

/**
 * Build the `godot_node` tool definition.
 * @param registry - the plugin-owned session registry.
 * @param config - resolved plugin config (property budget default).
 * @returns the tool definition.
 */
export function nodeTool(registry: GameSessionRegistry, config: ResolvedEgoConfig): ToolDefinition {
  return defineTool({
    name: 'godot_node',
    description: 'Read the properties of one node in the running game by scene path (for example, "Main/Player"). '
      + 'Returns stored and script variables with their current values; use props to name a few (glob "health*" allowed) instead of dumping everything.',
    parameters: {
      path: { type: 'string', required: true, description: 'Node path, relative to the current scene or absolute from /root.' },
      props: { type: 'array', items: { type: 'string' }, description: 'Property names or prefixes ("health*") to keep; omit for all stored properties.' },
      maxProps: { type: 'number', description: 'Maximum rows returned; defaults to the configured value.' },
      depth: { type: 'number', description: 'Container depth for values (default 2; deeper containers render as placeholders).' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true } },
      },
      render: (_args, value: { text: string }) => [{ type: 'text', text: value.text }],
    },
    async execute(args: NodeArgs, exec) {
      const session = sessionFor(registry, exec)
      const reply = await session.request('node', {
        path: args.path,
        maxProps: args.maxProps ?? config.maxProps,
        depth: args.depth ?? 2,
        ...(args.props !== undefined ? { props: args.props } : {}),
      }, exec.signal)
      if (typeof reply.payload.error === 'string') {
        throw new EgoGodotError(`no node at "${args.path}" in the current scene`, 'GODOT_EGO_REJECTED')
      }
      const className = typeof reply.payload.class === 'string' ? reply.payload.class : ''
      const scene = typeof reply.payload.scene === 'string' && reply.payload.scene !== '' ? ` ${reply.payload.scene}` : ''
      const rows = Array.isArray(reply.payload.props) ? reply.payload.props : []
      const total = typeof reply.payload.total === 'number' ? reply.payload.total : rows.length
      const lines = [`${args.path} [${className}]${scene}`]
      for (const row of rows) {
        const record = row as Record<string, unknown>
        const name = typeof record.name === 'string' ? record.name : ''
        const type = typeof record.type === 'string' ? record.type : ''
        lines.push(`  ${name} = ${formatValue(record.value)}${type === '' ? '' : `  (${type})`}`)
      }
      if (total > rows.length) {
        lines.push(`  ${total - rows.length} more properties (raise maxProps or name props)`)
      }
      return { text: lines.join('\n') }
    },
  })
}
