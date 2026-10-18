/**
 * `godot_scene`: report the scene the running game is showing, or switch to
 * another one. Switches go through the bridge's `scene` command
 * (`change_scene_to_file`), which is the same handoff the boot script uses; the
 * project's own start-up logic does not run for a switched scene.
 * @module @deepseek-ai/dsh-tool-godot-ego/scene
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GameSessionRegistry } from './session-service.ts'
import { sessionFor } from './tool-support.ts'

/** `godot_scene` arguments. */
export interface SceneArgs {
  path?: string
}

/** What `godot_scene` returns to the model. */
export interface SceneResult {
  readonly scene: string
  readonly changed: boolean
  readonly frames?: number
}

/**
 * Build the `godot_scene` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function sceneTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_scene',
    description: 'Report the current scene of the running game, or switch to another scene by res:// path. '
      + 'Switching calls change_scene_to_file, so the new scene starts fresh and the project\'s own boot logic is not replayed.',
    parameters: {
      path: { type: 'string', description: '`res://` scene to switch to (for example, "res://levels/test.tscn"). Omit to report the current scene.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scene: { type: 'string', required: true },
          changed: { type: 'boolean', required: true },
          frames: { type: 'number' },
        },
      },
      render: (_args, value: SceneResult) => [{
        type: 'text',
        text: value.changed
          ? `switched to ${value.scene} · frame ${String(value.frames ?? 0)}`
          : `scene ${value.scene === '' ? '(no scene)' : value.scene}`,
      }],
    },
    async execute(args: SceneArgs, exec): Promise<SceneResult> {
      const session = sessionFor(registry, exec)
      if (args.path === undefined) {
        const reply = await session.request('scene', {}, exec.signal)
        return { scene: typeof reply.payload.scene === 'string' ? reply.payload.scene : '', changed: false }
      }
      if (!args.path.startsWith('res://')) throw new Error('scene path must be a res:// path')
      const reply = await session.request('scene', { path: args.path }, exec.signal)
      const frames = typeof reply.payload.frames === 'number' ? reply.payload.frames : 0
      return { scene: typeof reply.payload.scene === 'string' ? reply.payload.scene : args.path, changed: true, frames }
    },
  })
}
