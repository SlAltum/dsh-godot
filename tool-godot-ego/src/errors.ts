/**
 * The package-owned failure taxonomy, structurally aligned with
 * `tool-godot`/`tool-godot-debug` (`HarnessError` subclasses surfaced as
 * `{ name, code }`) but implemented locally so no cross-package export is
 * added. `ALREADY_RUNNING` is deliberately absent: "a session is already
 * running" is a domain outcome carrying `{ running: true, sessionId }`, not an
 * error.
 * @module @deepseek-ai/dsh-tool-godot-ego/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** The failure taxonomy the tools surface to callers. */
export type EgoGodotErrorCode =
  | 'GODOT_EGO_UNAVAILABLE'
  | 'GODOT_EGO_NO_SESSION'
  | 'GODOT_EGO_NO_PROJECT'
  | 'GODOT_EGO_TIMEOUT'
  | 'GODOT_EGO_REJECTED'
  | 'GODOT_EGO_NOT_IMPORTED'
  | 'GODOT_EGO_ABORTED'
  | 'GODOT_EGO_STALE_FRAME'
  | 'GODOT_EGO_LOST'

/**
 * Typed ego-godot failure. Extends {@link HarnessError} so it carries a stable
 * {@link EgoGodotErrorCode} and chains `cause`.
 */
export class EgoGodotError extends HarnessError {
  override readonly code: EgoGodotErrorCode

  /**
   * @param message - the model-facing description.
   * @param code - the structured failure code.
   * @param options - standard ErrorOptions (cause chaining).
   */
  constructor(message: string, code: EgoGodotErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
