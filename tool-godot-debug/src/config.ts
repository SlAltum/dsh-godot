/**
 * Plugin configuration for the `godot_debug` tool: the godot executable, the
 * protocol byte/timer caps, and the cooperative tool-call budget. Defaults
 * mirror tool-godot where the same concept exists; validation runs at load so
 * misconfiguration fails loud (DSH convention). The schema input is fully
 * optional; consumers use {@link ResolvedGodotDebugConfig}.
 * @module @deepseek-ai/dsh-tool-godot-debug/config
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Plugin configuration as a deployment provides it (every key optional). */
export interface GodotDebugConfig {
  /** Godot executable path or PATH-resolved command name (default `godot`). */
  executable?: string
  /** Fixed argv elements inserted after the godot executable (deployment wrappers). */
  executableArgs?: string[]
  /** Remote-debug port the game connects to; 0 (default) = auto-pick a free port. */
  debugPort?: number
  /** Largest single framed protocol message accepted from the game. */
  maxMessageBytes?: number
  /** Max bytes of game `output`/`error` content retained in one run. */
  maxOutputBytes?: number
  /** Largest spawned-game stderr tail retained for diagnostics. */
  maxStderrBytes?: number
  /** Partial-frame / response-stall budget before the connection is dropped. */
  idleTimeoutMs?: number
  /** Budget for the game to connect after spawn (cold start + first import). */
  connectWaitMs?: number
  /** Terminate-escalation grace for the spawned game, bounded by `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /** Cooperative tool-call budget on `godot_debug`, enforced through `exec.signal`. */
  timeoutMs?: number
  /** Max objects expanded via `scene:inspect_object` on the first frame-bearing
   *  stop (0 = expansion disabled). */
  maxExpandedObjects?: number
  /** Max property rows kept per expanded object. */
  maxExpandedProps?: number
  /** Max expansion depth: 1 = top-level objects only, 2 = nested objects
   *  inside property values (direct/array/dictionary) are expanded too. */
  maxExpandDepth?: number
  /** Max `scene:set_object_property` edits applied on the first frame-bearing
   *  stop (0 = edits disabled). */
  maxEdits?: number
  /** Max scene-tree nodes parsed/rendered per frame-bearing stop
   *  (0 = scene-tree snapshots disabled). */
  maxTreeNodes?: number
  /** Render numbers at FULL float64 precision (JS shortest round-trip form)
   *  instead of the 7-significant-digit cap (Phase 9 default). */
  fullPrecisionNumbers?: boolean
}

/** The resolved configuration after schemastery fills every default. */
export type ResolvedGodotDebugConfig = Required<GodotDebugConfig>

export const Config: z<GodotDebugConfig> = z.object({
  executable: z.string().default('godot'),
  executableArgs: z.array(z.string()).default([]),
  debugPort: z.number().default(0),
  maxMessageBytes: z.number().default(16_000_000),
  maxOutputBytes: z.number().default(1_000_000),
  maxStderrBytes: z.number().default(1_000_000),
  idleTimeoutMs: z.number().default(10_000),
  connectWaitMs: z.number().default(20_000),
  graceMs: z.number().default(5_000),
  timeoutMs: z.number().default(60_000),
  maxExpandedObjects: z.number().default(10),
  maxExpandedProps: z.number().default(100),
  maxExpandDepth: z.number().default(2),
  maxEdits: z.number().default(10),
  maxTreeNodes: z.number().default(200),
  fullPrecisionNumbers: z.boolean().default(false),
})

/**
 * Load-time validation of a resolved config; throws with a field-named message
 * on the first violation so misconfiguration fails at load, never mid-run.
 * @param config - the schemastery-resolved config (defaults already filled).
 * @throws Error naming the offending field.
 */
export function validateConfig(config: GodotDebugConfig): void {
  // The schema fills every default; the caller's typed input stays optional.
  const resolved = config as ResolvedGodotDebugConfig
  assertPort('debugPort', resolved.debugPort, true)
  assertPositiveInteger('maxMessageBytes', resolved.maxMessageBytes)
  assertPositiveInteger('maxOutputBytes', resolved.maxOutputBytes)
  assertPositiveInteger('maxStderrBytes', resolved.maxStderrBytes)
  assertTimer('idleTimeoutMs', resolved.idleTimeoutMs)
  assertTimer('connectWaitMs', resolved.connectWaitMs)
  assertTimer('graceMs', resolved.graceMs)
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  // 0 = expansion disabled (a documented sentinel, not an error).
  assertNonNegativeInteger('maxExpandedObjects', resolved.maxExpandedObjects)
  assertPositiveInteger('maxExpandedProps', resolved.maxExpandedProps)
  // Depth is bounded: 1 (Phase 5 behavior) up to a sane recursion cap.
  assertPositiveInteger('maxExpandDepth', resolved.maxExpandDepth)
  if (resolved.maxExpandDepth > 4) {
    throw new Error('tool-godot-debug: maxExpandDepth must be between 1 and 4')
  }
  // 0 = edits disabled (a documented sentinel, not an error).
  assertNonNegativeInteger('maxEdits', resolved.maxEdits)
  // 0 = scene-tree snapshots disabled (a documented sentinel, not an error).
  assertNonNegativeInteger('maxTreeNodes', resolved.maxTreeNodes)
}

/** Reject a value outside the TCP port range; `allowZero` permits the auto-pick sentinel. */
function assertPort(name: string, value: number, allowZero = false): void {
  const min = allowZero ? 0 : 1
  if (!Number.isInteger(value) || value < min || value > 65535) {
    throw new Error(`tool-godot-debug: ${name} must be an integer between ${min} and 65535`)
  }
}

/** Reject a timer Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-godot-debug: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Reject a nonpositive or non-integer cap. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-godot-debug: ${name} must be a positive integer`)
  }
}

/** Reject a negative or non-integer value (0 is a legal sentinel here). */
function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`tool-godot-debug: ${name} must be a non-negative integer`)
  }
}
