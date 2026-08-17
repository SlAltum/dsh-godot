/**
 * The package-owned error type, structurally aligned with tool-godot's
 * `GodotError` (a `HarnessError` subclass surfaced as `{ name, code }`) but
 * implemented locally — no cross-package export is added (plan D2). Only the
 * three codes the debug tool needs: infrastructure failures
 * (`GODOT_UNAVAILABLE`), unreadable/unsupported input or protocol
 * (`GODOT_PARSE_ERROR`), and cancellation (`GODOT_ABORTED`).
 * @module @deepseek-ai/dsh-tool-godot-debug/error
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/**
 * Typed godot-debug failure. Extends {@link HarnessError} so it carries a
 * stable {@link GodotErrorCode} and chains `cause`; the tool registry exposes
 * `{ name, code }` on `isError` results so retry/permission/UI layers can
 * branch without parsing messages.
 */
export class GodotError extends HarnessError {
    code;
    /**
     * @param message - the model-facing description.
     * @param code - the structured failure code.
     * @param options - standard ErrorOptions (cause chaining).
     */
    constructor(message, code, options) {
        super(message, code, options);
        this.code = code;
    }
}
