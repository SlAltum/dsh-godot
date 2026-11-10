/**
 * `/api/godot/debug/*`: the interactive debug session over HTTP.
 *
 * `harness.handle` — the bridge the dynamic UI plugin used — is a
 * dynamic-plugin-only primitive, so a static client package cannot reach the
 * session that way. These four endpoints are the static equivalent, mirroring
 * `tool-godot-ego`'s `/api/godot/*` routes: the same loopback/same-site guard
 * (or a pinned token), JSON-only payloads, and only the session id crossing the
 * boundary — never a socket, a controller, or a `DebugSession` instance.
 *
 * | endpoint | method | body |
 * |---|---|---|
 * | `start` | POST | the attach/launch options |
 * | `stop` | POST | `{ sessionId }` |
 * | `poll` | GET | `?session=<id>` |
 * | `command` | POST | `{ sessionId, request }` |
 *
 * @module @deepseek-ai/dsh-tool-godot-debug/session-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { GodotError } from './error.ts'
import type { DebugSessionService } from './session-service.ts'
import type { EditRequest } from './edit.ts'
import type { SessionCommandRequest } from './session.ts'

/** The slice of `ctx.webServer` this route uses. */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): () => void
}

/** Route options. */
export interface DebugRouteOptions {
  /**
   * Pinned access token. When set, every request must carry it as `?token=`;
   * otherwise the loopback/same-site guard applies.
   */
  token?: string
  /** Launch-mode executable the panel does not have to know (the resolved `godot.toolchain` value). */
  executable?: string
  /** Wrapper args matching {@link executable}. */
  executableArgs?: string[]
}

/** Path prefix shared by the four endpoints. */
const PREFIX = '/api/godot/debug'

/** Largest accepted JSON body, matching the sandbox's input bound. */
const MAX_BODY_BYTES = 16_384

/** Command kinds the panel may send. */
const COMMAND_KINDS = new Set(['pause', 'continue', 'step', 'next', 'breakpoint', 'edits'])

/**
 * Register the session endpoints on the host web server.
 * @param ctx - plugin context carrying the optional `webServer` service.
 * @param service - the single-session manager.
 * @param options - the optional pinned token.
 * @returns the route disposer.
 * @throws GodotError `GODOT_UNAVAILABLE` when no web server is mounted.
 */
export function sessionRoute(ctx: Context, service: DebugSessionService, options: DebugRouteOptions = {}): () => void {
  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined) {
    throw new GodotError('the web server is not mounted, so the debug session panel cannot start', 'GODOT_UNAVAILABLE')
  }
  return server.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => { void dispatch(req, res, service, options) },
  })
}

/** Route one request to its endpoint. */
async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  service: DebugSessionService,
  options: DebugRouteOptions,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!authorized(req, url, options.token)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const action = url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g, '')
  switch (action) {
    case 'start': {
      const body = await readableBody(req, res)
      if (body === undefined) return
      await startRoute(res, service, body, options)
      return
    }
    case 'stop': {
      if (!requireMethod(res, req, 'POST')) return
      const body = await readableBody(req, res)
      if (body === undefined) return
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      if (sessionId === '') {
        json(res, 400, { ok: false, error: 'sessionId is required' })
        return
      }
      json(res, 200, { ok: true, stopped: service.stop(sessionId).ok })
      return
    }
    case 'poll': {
      if (!requireMethod(res, req, 'GET')) return
      const sessionId = url.searchParams.get('session') ?? ''
      if (sessionId === '') {
        json(res, 400, { ok: false, error: 'session is required' })
        return
      }
      const snapshot = service.poll(sessionId)
      if ('error' in snapshot) {
        json(res, 404, { ok: false, error: snapshot.error })
        return
      }
      json(res, 200, { ok: true, snapshot })
      return
    }
    case 'command': {
      if (!requireMethod(res, req, 'POST')) return
      const body = await readableBody(req, res)
      if (body === undefined) return
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      const request = parseCommandRequest(body.request)
      if (sessionId === '' || request === undefined) {
        json(res, 400, { ok: false, error: 'sessionId and a valid request are required' })
        return
      }
      const result = await service.command(sessionId, request)
      if ('error' in result) {
        json(res, 404, { ok: false, error: result.error })
        return
      }
      json(res, 200, { ok: true, result })
      return
    }
    default:
      json(res, 404, { ok: false, error: 'unknown-route' })
  }
}

/** `start`: validate the launch/attach options and open a session. */
async function startRoute(
  res: ServerResponse,
  service: DebugSessionService,
  body: Record<string, unknown>,
  options: DebugRouteOptions,
): Promise<void> {
  const projectRoot = typeof body.projectRoot === 'string' ? body.projectRoot : ''
  if (projectRoot === '') {
    json(res, 400, { ok: false, error: 'projectRoot is required' })
    return
  }
  const mode = body.mode === 'launch' ? 'launch' as const : 'attach' as const
  const started = await service.start({
    mode,
    ...(typeof body.port === 'number' ? { port: body.port } : {}),
    projectRoot,
    // The panel names no path: the plugin's resolved executable is the default.
    ...(typeof body.executable === 'string'
      ? { executable: body.executable }
      : (options.executable !== undefined ? { executable: options.executable } : {})),
    ...(isStringArray(body.executableArgs)
      ? { executableArgs: body.executableArgs }
      : (options.executableArgs !== undefined ? { executableArgs: options.executableArgs } : {})),
    ...(typeof body.scene === 'string' ? { scene: body.scene } : {}),
    ...(isStringArray(body.args) ? { args: body.args } : {}),
    ...(typeof body.singleThreadedScene === 'boolean' ? { singleThreadedScene: body.singleThreadedScene } : {}),
  })
  if ('error' in started) {
    // A second start while a session is active is a conflict, not a bad request.
    json(res, started.error === 'session-active' ? 409 : 400, { ok: false, error: started.error })
    return
  }
  json(res, 200, { ok: true, session: started })
}

/** Parse one command request, rejecting unknown shapes rather than guessing. */
function parseCommandRequest(value: unknown): SessionCommandRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.kind !== 'string' || !COMMAND_KINDS.has(raw.kind)) return undefined
  switch (raw.kind) {
    case 'pause':
    case 'continue':
    case 'step':
    case 'next':
      return { kind: raw.kind }
    case 'breakpoint':
      if (typeof raw.file !== 'string' || typeof raw.line !== 'number' || typeof raw.enabled !== 'boolean') return undefined
      return { kind: 'breakpoint', file: raw.file, line: raw.line, enabled: raw.enabled }
    default:
      return Array.isArray(raw.edits) ? { kind: 'edits', edits: raw.edits as EditRequest[] } : undefined
  }
}

/** Read one bounded JSON body; answers the request itself when it is unusable. */
async function readableBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  if (!requireMethod(res, req, 'POST')) return undefined
  let text: string
  try {
    text = await readBody(req)
  } catch {
    json(res, 400, { ok: false, error: 'invalid JSON body' })
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    json(res, 400, { ok: false, error: 'invalid JSON body' })
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    json(res, 400, { ok: false, error: 'body must be a JSON object' })
    return undefined
  }
  return parsed as Record<string, unknown>
}

/** Require one HTTP method, answering 405 otherwise. */
function requireMethod(res: ServerResponse, req: IncomingMessage, method: 'GET' | 'POST'): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: `use ${method}` })
  return false
}

/** Guard one request: a pinned token, or loopback plus a non-cross-site origin. */
function authorized(req: IncomingMessage, url: URL, token: string | undefined): boolean {
  if (token !== undefined) return url.searchParams.get('token') === token
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin !== undefined && host !== undefined) {
    if (origin !== `http://${host}` && origin !== `https://${host}`) return false
  }
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- tests inject a minimal request without a socket
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Read a bounded request body. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** Answer one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Whether a value is an array of strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
