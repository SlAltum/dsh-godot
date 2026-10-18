/**
 * The `godot.debugSession` service (T21): one interactive session per host
 * process, exposed through `ctx.provide` so the dynamic plugin's host half
 * can bridge it to `harness.handle` RPC (review H1 — `harness.handle` is a
 * dynamic-plugin-only primitive; the session never touches RPC itself).
 *
 * Single-session rule: a game dials exactly one debugger (T11.0), so the
 * manager refuses a second start while one session is active. The session id
 * is the only handle that crosses the boundary (JSON-safe strings, review
 * MEDIUM-5).
 *
 * @module @deepseek-ai/dsh-tool-godot-debug/session-service
 */

import { randomUUID } from 'node:crypto'
import { pickFreePort, type SubprocessLike } from '@deepseek-ai/dsh-lsp-godot'
import { DebugSession, type SessionCommandRequest, type SessionCommandResult, type SessionSnapshot, type DebugSessionLaunch } from './session.ts'

/** Service-wide defaults and bounds (the resolved config feeds the caps). */
export interface DebugSessionServiceOptions {
  maxMessageBytes: number
  maxOutputBytes: number
  maxTreeNodes: number
  /** Inactivity (commands only) before a timeout detach (default 10 min). */
  idleTimeoutMs: number
  /** Session-level connection window (defaults to idleTimeoutMs). */
  connectWaitMs?: number
  /** Idle-timer cadence (tests use a short one; default 30 s). */
  idleCheckIntervalMs?: number
  /** The spawn seam; REQUIRED for launch-mode sessions (T21.8). */
  subprocess?: SubprocessLike
  /** Terminate-escalation grace for a spawned game (launch mode). */
  graceMs?: number
}

/** One `start` request: attach (default) joins a caller-started game on an
 *  explicit port; launch (T21.8) spawns the game itself — the port is
 *  auto-picked, the version is gated, and the session owns the process. */
export interface DebugSessionStartOptions {
  mode?: 'attach' | 'launch'
  /** attach: required 1-65535; launch: ignored (auto-picked). */
  port?: number
  projectRoot: string
  /** launch: required (the executable to spawn). */
  executable?: string
  executableArgs?: string[]
  scene?: string
  args?: string[]
  singleThreadedScene?: boolean
}

/** The service surface the dynamic host half bridges. */
export interface DebugSessionService {
  start(options: DebugSessionStartOptions): Promise<
    | { sessionId: string; port: number; state: 'connecting'; mode: 'attach' | 'launch' }
    | { error: 'port-invalid' | 'session-active' | 'launch-invalid' }
  >
  stop(sessionId: string): { ok: boolean }
  poll(sessionId: string): SessionSnapshot | { error: 'unknown-session' }
  command(sessionId: string, request: SessionCommandRequest):
    | Promise<SessionCommandResult>
    | { error: 'unknown-session' }
}

/** Create the single-session manager.
 * @param options - the session bounds and factory.
 * @returns the single-session manager. */
export function createDebugSessionService(options: DebugSessionServiceOptions): DebugSessionService {
  let current: DebugSession | undefined

  // Poll/stop may still address a DETACHED session (the panel must show the
  // detach reason); only `start` refuses while one session is active.
  const resolve = (sessionId: string): DebugSession | undefined => {
    if (current === undefined || current.sessionId !== sessionId) return undefined
    return current
  }

  const service: DebugSessionService = {
    async start({ mode, port, projectRoot, executable, executableArgs, scene, args, singleThreadedScene }) {
      if (current !== undefined && !current.detached) return { error: 'session-active' }
      if (mode === 'launch') {
        // T21.8: the session spawns the game — the port is pre-picked here,
        // the version gate and process ownership live in DebugSession.
        if (typeof executable !== 'string' || executable === '') return { error: 'launch-invalid' }
        if (options.subprocess === undefined) return { error: 'launch-invalid' }
        const picked = await pickFreePort()
        const session = new DebugSession(
          randomUUID(),
          picked,
          projectRoot,
          {
            maxMessageBytes: options.maxMessageBytes,
            maxOutputBytes: options.maxOutputBytes,
            maxTreeNodes: options.maxTreeNodes,
          },
          options.idleTimeoutMs,
          options.connectWaitMs ?? options.idleTimeoutMs,
          options.idleCheckIntervalMs,
          {
            executable,
            ...(executableArgs !== undefined ? { executableArgs } : {}),
            ...(scene !== undefined ? { scene } : {}),
            ...(args !== undefined ? { args } : {}),
            ...(singleThreadedScene !== undefined ? { singleThreadedScene } : {}),
          } satisfies DebugSessionLaunch,
          options.subprocess,
          options.graceMs,
        )
        current = session
        void session.connect()
        return { sessionId: session.sessionId, port: session.port, state: 'connecting', mode: 'launch' }
      }
      // attach (default): an explicit port the caller's game dials.
      if (!Number.isInteger(port) || port === undefined || port < 1 || port > 65535) return { error: 'port-invalid' }
      const session = new DebugSession(
        randomUUID(),
        port,
        projectRoot,
        {
          maxMessageBytes: options.maxMessageBytes,
          maxOutputBytes: options.maxOutputBytes,
          maxTreeNodes: options.maxTreeNodes,
        },
        options.idleTimeoutMs,
        options.connectWaitMs ?? options.idleTimeoutMs,
        options.idleCheckIntervalMs,
      )
      current = session
      void session.connect()
      return { sessionId: session.sessionId, port: session.port, state: 'connecting', mode: 'attach' }
    },

    stop(sessionId) {
      const session = resolve(sessionId)
      if (session === undefined) return { ok: false }
      session.detach('stop')
      return { ok: true }
    },

    poll(sessionId) {
      const session = resolve(sessionId)
      if (session === undefined) return { error: 'unknown-session' }
      return session.poll()
    },

    command(sessionId, request) {
      const session = resolve(sessionId)
      if (session === undefined) return { error: 'unknown-session' }
      return session.command(request)
    },
  }
  return service
}
