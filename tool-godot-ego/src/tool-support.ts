/**
 * Shared tool plumbing: resolve the workspace's running session or fail with
 * the stable `GODOT_EGO_NO_SESSION` code.
 * @module @deepseek-ai/dsh-tool-godot-ego/tool-support
 */

import { EgoGodotError } from './errors.ts'
import type { GameSessionRegistry, EgoSessionHandle } from './session-service.ts'

/**
 * The session for the calling workspace.
 * @param registry - the plugin-owned session registry.
 * @param exec - the executing tool context (its agent names the workspace).
 * @returns the workspace session.
 * @throws EgoGodotError `GODOT_EGO_NO_SESSION` when none is running.
 */
export function sessionFor(registry: GameSessionRegistry, exec: { agent?: unknown }): EgoSessionHandle {
  const agent = exec.agent as { session: { header: { cwd: string } } } | undefined
  const workspace = agent?.session.header.cwd ?? process.cwd()
  const session = registry.get(workspace)
  if (session === undefined) {
    throw new EgoGodotError('no running game session; call godot_play first', 'GODOT_EGO_NO_SESSION')
  }
  return session
}

/** Named non-printable keys → Godot keycodes (printable characters use their code point). */
const NAMED_KEYS: Readonly<Record<string, number>> = {
  space: 32,
  enter: 4194309,
  escape: 4194305,
  tab: 4194306,
  backspace: 4194308,
  delete: 4194313,
  left: 4194319,
  up: 4194320,
  right: 4194321,
  down: 4194322,
}

/**
 * Resolve a model-facing key name to a Godot keycode.
 * @param key - a named key (`Space`, `Escape`, ...) or one printable character.
 * @returns the keycode, or `undefined` for an unknown name.
 */
export function keycodeOf(key: string): number | undefined {
  const named = NAMED_KEYS[key.toLowerCase()]
  if (named !== undefined) return named
  if (key.length === 1) return key.toUpperCase().charCodeAt(0)
  return undefined
}
