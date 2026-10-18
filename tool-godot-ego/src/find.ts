/**
 * `godot_find`: search the live Control list by name, class, or text. The
 * target list is the same one `godot_state` renders; filtering happens on the
 * host so the reply stays small in a busy scene.
 * @module @deepseek-ai/dsh-tool-godot-ego/find
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GameSessionRegistry } from './session-service.ts'
import { parseTargets, renderTargets } from './targets.ts'
import type { TargetEntry } from './targets.ts'
import { sessionFor } from './tool-support.ts'

/** Line budget for one search reply. */
const MAX_LINES = 60

/** `godot_find` arguments. */
export interface FindArgs {
  name?: string
  class?: string
  text?: string
}

/** What `godot_find` returns to the model. */
export interface FindResult {
  readonly text: string
}

/** Whether one target matches every provided filter. */
function matches(target: TargetEntry, args: FindArgs): boolean {
  const contains = (haystack: string, needle: string | undefined): boolean =>
    needle === undefined || haystack.toLowerCase().includes(needle.toLowerCase())
  return contains(target.path, args.name)
    && contains(target.className, args.class)
    && contains(target.text, args.text)
}

/**
 * Build the `godot_find` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function findTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_find',
    description: 'Find clickable Controls in the running game by case-insensitive substring match on '
      + 'path/name, class, and text. Every filter given must match; with no filter it lists the whole target list. '
      + 'Use the returned paths with godot_click.',
    parameters: {
      name: { type: 'string', description: 'Substring of the Control path, for example, "StartButton".' },
      class: { type: 'string', description: 'Substring of the Control class, for example, "Button".' },
      text: { type: 'string', description: 'Substring of the visible text.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true } },
      },
      render: (_args, value: FindResult) => [{ type: 'text', text: value.text }],
    },
    async execute(args: FindArgs, exec): Promise<FindResult> {
      const session = sessionFor(registry, exec)
      const reply = await session.request('state', { tree: false, targets: true, diff: false }, exec.signal)
      const all = parseTargets(reply.payload.targets)
      const matched = all.filter(target => matches(target, args))
      if (matched.length === 0) {
        const filters = [
          args.name !== undefined ? `name="${args.name}"` : '',
          args.class !== undefined ? `class="${args.class}"` : '',
          args.text !== undefined ? `text="${args.text}"` : '',
        ].filter(part => part !== '').join(', ')
        return { text: `no Control matched${filters === '' ? '' : ` ${filters}`} (${all.length} targets in the current scene)` }
      }
      const rendered = renderTargets(matched, MAX_LINES)
      const lines = [`${matched.length} of ${all.length} Controls match`, ...rendered.lines]
      if (rendered.truncated) lines.push(`  ${matched.length - rendered.lines.length} more matched (narrow the filters)`)
      return { text: lines.join('\n') }
    },
  })
}
