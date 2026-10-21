/**
 * Plugin configuration for the Godot LSP provider: attach/spawn/auto connect
 * modes, port selection, spawn process bounds, and byte/timer caps. Defaults
 * mirror lsp-stdio's host bounds where the same concept exists; validation
 * runs at load so misconfiguration fails loud (DSH convention). The schema
 * input is fully optional; consumers use {@link ResolvedGodotLspConfig}.
 * @module @deepseek-ai/dsh-lsp-godot/config
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** How the provider obtains an LSP server. */
export type ConnectMode = 'attach' | 'spawn' | 'auto'

/** Plugin configuration as a deployment provides it (every key optional). */
export interface GodotLspConfig {
  /** LSP server host for attach mode (Godot binds loopback by default). */
  host?: string
  /** Ports to probe in order when attaching. */
  ports?: number[]
  /** attach (running editor), spawn (headless editor), or auto (probe then spawn). */
  connectMode?: ConnectMode
  /** TCP connect budget before the attach probe fails. */
  connectTimeoutMs?: number
  /** Partial-frame stall budget before the connection is dropped. */
  idleTimeoutMs?: number
  /** Godot executable for spawn mode (resolved lazily at first spawn). */
  spawnExecutable?: string
  /** Extra argv inserted after the executable. */
  spawnArgs?: string[]
  /** Spawn LSP port; 0 = provider picks a free port through a bind probe. */
  spawnPort?: number
  /** Budget for a spawned editor's LSP port to accept connections (cold start + first import). */
  spawnReadyTimeoutMs?: number
  /** Largest source document opened in one query. */
  maxDocumentBytes?: number
  /** Largest single framed message accepted from the server. */
  maxMessageBytes?: number
  /** Largest spawned-editor stderr tail retained for diagnostics. */
  maxStderrBytes?: number
  /** Cancel-grace and terminate-escalation budget for spawned processes. */
  killGraceMs?: number
  /** Cooldown after a FAILED spawn (broken project / environment, godot#103313):
   *  further spawn attempts for the same workspace fail fast with
   *  `LSP_UNAVAILABLE` until it elapses; a successful spawn clears it. `0` =
   *  no cooldown (retry every query, the pre-T17 behavior). */
  spawnRetryCooldownMs?: number
}

/** The resolved configuration after schemastery fills every default. */
export type ResolvedGodotLspConfig = Required<GodotLspConfig>

export const Config: z<GodotLspConfig> = z.object({
  host: z.string().default('127.0.0.1'),
  ports: z.array(z.number()).default([6005]),
  connectMode: z.union(['attach', 'spawn', 'auto'] as const).default('auto'),
  connectTimeoutMs: z.number().default(1500),
  idleTimeoutMs: z.number().default(10_000),
  spawnExecutable: z.string().default('godot'),
  spawnArgs: z.array(z.string()).default([]),
  spawnPort: z.number().default(0),
  spawnReadyTimeoutMs: z.number().default(120_000),
  maxDocumentBytes: z.number().default(4_000_000),
  maxMessageBytes: z.number().default(16_000_000),
  maxStderrBytes: z.number().default(1_000_000),
  killGraceMs: z.number().default(2_000),
  spawnRetryCooldownMs: z.number().default(60_000),
})

/**
 * Fill schema defaults and validate one deployment config. Missing input is a
 * valid deployment: the loader may mount the plugin without a `config` key.
 * @param input - the deployment config (every key optional).
 * @returns the resolved config.
 * @throws Error naming the offending field.
 */
export function resolveConfig(input: GodotLspConfig = {}): ResolvedGodotLspConfig {
  const resolved = Config(input) as ResolvedGodotLspConfig
  validateConfig(resolved)
  return resolved
}

/**
 * Load-time validation of a resolved config; throws with a field-named message
 * on the first violation so misconfiguration fails at load, never mid-query.
 * @param config - the schemastery-resolved config (defaults already filled).
 * @throws Error naming the offending field.
 */
export function validateConfig(config: GodotLspConfig): void {
  // The schema fills every default; the caller's typed input stays optional.
  const resolved = config as ResolvedGodotLspConfig
  if (resolved.ports.length === 0) throw new Error('lsp-godot: ports must contain at least one port')
  for (const port of resolved.ports) assertPort('ports', port)
  assertPort('spawnPort', resolved.spawnPort, true)
  assertTimer('connectTimeoutMs', resolved.connectTimeoutMs)
  assertTimer('idleTimeoutMs', resolved.idleTimeoutMs)
  assertTimer('killGraceMs', resolved.killGraceMs)
  assertTimer('spawnReadyTimeoutMs', resolved.spawnReadyTimeoutMs)
  if (!Number.isInteger(resolved.spawnRetryCooldownMs) || resolved.spawnRetryCooldownMs < 0) {
    throw new Error('lsp-godot: spawnRetryCooldownMs must be a non-negative integer (0 disables the retry cooldown)')
  }
  assertPositiveInteger('maxDocumentBytes', resolved.maxDocumentBytes)
  assertPositiveInteger('maxMessageBytes', resolved.maxMessageBytes)
  assertPositiveInteger('maxStderrBytes', resolved.maxStderrBytes)
}

/** Reject a value outside the TCP port range; `allowZero` permits the provider-picked sentinel. */
function assertPort(name: string, value: number, allowZero = false): void {
  const min = allowZero ? 0 : 1
  if (!Number.isInteger(value) || value < min || value > 65535) {
    throw new Error(`lsp-godot: ${name} must be an integer between ${min} and 65535`)
  }
}

/** Reject a timer Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`lsp-godot: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Reject a nonpositive or non-integer byte cap. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`lsp-godot: ${name} must be a positive integer`)
  }
}
