/**
 * Plugin configuration for `ego-godot`: the executable, the window/rendering
 * switches, the protocol and retention budgets, and the cooperative tool-call
 * budget. Every key is optional in deployment input; {@link resolveConfig}
 * fills the defaults and validates them at load so a misconfiguration fails
 * loud instead of mid-session.
 * @module @deepseek-ai/dsh-tool-godot-ego/config
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Plugin configuration as a deployment provides it (every key optional). */
export interface EgoConfig {
  /** Godot executable path or PATH-resolved command name (default `godot`). */
  executable?: string
  /** Fixed argv elements inserted after the executable (deployment wrappers). */
  executableArgs?: string[]
  /** Register `godot_eval` (expression evaluation inside the running game). */
  allowEval?: boolean
  /** Start the game window off-screen (kept visible by default). */
  offscreen?: boolean
  /** Frame-rate cap passed as `--max-fps` (0 = engine default, no cap). */
  maxFps?: number
  /** Deterministic frame pacing passed as `--fixed-fps` (0 = disabled). */
  fixedFps?: number
  /** Budget for the one-time `--headless --editor --import` pass. */
  importTimeoutMs?: number
  /** Cooperative tool-call budget enforced through `exec.signal`. */
  timeoutMs?: number
  /** Per-request budget for one bridge command. */
  requestTimeoutMs?: number
  /** Terminate-escalation grace for the spawned game. */
  graceMs?: number
  /** Max scene-tree nodes rendered by `godot_state` (0 = tree off). */
  maxNodes?: number
  /** Max property rows rendered by `godot_node`. */
  maxProps?: number
  /** Preview screenshot width in pixels (0 = no downscale). */
  maxWidth?: number
}

/** The resolved configuration after schemastery fills every default. */
export type ResolvedEgoConfig = Required<EgoConfig>

export const Config: z<EgoConfig> = z.object({
  executable: z.string().default('godot'),
  executableArgs: z.array(z.string()).default([]),
  allowEval: z.boolean().default(false),
  offscreen: z.boolean().default(false),
  maxFps: z.number().default(60),
  fixedFps: z.number().default(0),
  importTimeoutMs: z.number().default(120_000),
  timeoutMs: z.number().default(60_000),
  requestTimeoutMs: z.number().default(20_000),
  graceMs: z.number().default(5_000),
  maxNodes: z.number().default(200),
  maxProps: z.number().default(40),
  maxWidth: z.number().default(1280),
})

/**
 * Fill defaults and validate one deployment config.
 * @param input - the deployment input (every key optional).
 * @returns the resolved config, safe to close over for the plugin lifetime.
 * @throws Error naming the first offending field.
 */
export function resolveConfig(input: EgoConfig = {}): ResolvedEgoConfig {
  const resolved = Config(input) as ResolvedEgoConfig
  validateConfig(resolved)
  return resolved
}

/**
 * Load-time validation of a resolved config.
 * @param config - the schemastery-resolved config (defaults already filled).
 * @throws Error naming the first violation.
 */
export function validateConfig(config: ResolvedEgoConfig): void {
  if (config.executable.trim().length === 0) {
    throw new Error('tool-godot-ego: executable must be a non-empty string')
  }
  assertRange('maxFps', config.maxFps, 0, 1000)
  assertRange('fixedFps', config.fixedFps, 0, 1000)
  assertTimer('importTimeoutMs', config.importTimeoutMs)
  assertTimer('timeoutMs', config.timeoutMs)
  assertTimer('requestTimeoutMs', config.requestTimeoutMs)
  assertTimer('graceMs', config.graceMs)
  assertRange('maxNodes', config.maxNodes, 0, 100_000)
  assertRange('maxProps', config.maxProps, 1, 10_000)
  assertRange('maxWidth', config.maxWidth, 0, 8192)
}

/** Reject a non-integer or out-of-range numeric field. */
function assertRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`tool-godot-ego: ${name} must be an integer between ${min} and ${max}`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-godot-ego: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
