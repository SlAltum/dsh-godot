/**
 * Host endpoints under `/api/godot`: the MJPEG viewer, the session list the
 * watch panel polls, and the click endpoint used by that panel.
 *
 * The web server exposes no auth layer of its own, so every endpoint is
 * guarded here: a pinned `token` option keeps the query-token check the first
 * viewer used, and without one the request must come from loopback and must
 * not be a cross-site browser request (`Sec-Fetch-Site`/`Origin`).
 * Frames are 640-wide JPEGs at a fixed interval, and a slow client is skipped
 * rather than buffered (backpressure). Closing the request clears the timer.
 * @module @deepseek-ai/dsh-tool-godot-ego/view-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { EgoGodotError } from './errors.ts'
import type { GameSessionRegistry } from './session-service.ts'
import { parseTree, type SceneTreeNode } from './targets.ts'

/** The slice of `ctx.webServer` this route uses. */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): () => void
}

/** Viewer options. */
export interface ViewRouteOptions {
  intervalMs?: number
  maxWidth?: number
  quality?: number
  /**
   * Pinned access token. When set, every `/api/godot` request must carry it as
   * `?token=`. When omitted, the loopback/same-site guard applies instead.
   */
  token?: string
}

/** Frame bytes retained before a slow client is skipped. */
const MAX_BUFFERED_BYTES = 1_000_000

/** Largest accepted JSON body for one input request. */
const MAX_INPUT_BYTES = 16_384

/** Default and maximum node count of one scene-tree answer. */
const TREE_NODES_DEFAULT = 300
const TREE_NODES_MAX = 800

/** How long one tree answer may take before the route gives up. */
const TREE_TIMEOUT_MS = 3_000

/** Property rows one node answer returns at most. */
const NODE_MAX_PROPS = 120

/** Session projection returned by `/api/godot/sessions`. */
interface SessionView {
  readonly sessionId: string
  readonly state: string
  readonly pid: number | null
  readonly window: readonly [number, number] | null
  readonly lostReason: string | null
}

/**
 * Register the viewer, session-list, and input routes on the host web server.
 * @param ctx - plugin context carrying the optional `webServer` service.
 * @param registry - the session registry (frames and input go to the named session).
 * @param options - interval, size, quality, and the optional pinned token.
 * @returns the route disposer for all three endpoints.
 * @throws EgoGodotError `GODOT_EGO_UNAVAILABLE` when no web server is mounted.
 */
export function viewRoute(ctx: Context, registry: GameSessionRegistry, options: ViewRouteOptions = {}): () => void {
  const server = ctx.get('webServer') as WebServerLike | undefined
  if (server === undefined) {
    throw new EgoGodotError('the web server is not mounted, so the watch panel cannot start', 'GODOT_EGO_UNAVAILABLE')
  }
  const token = options.token
  const disposers = [
    server.register({
      kind: 'prefix',
      path: '/api/godot/view',
      handler: (req, res) => { stream(req, res, registry, options, token) },
    }),
    server.register({
      kind: 'prefix',
      path: '/api/godot/sessions',
      handler: (req, res) => { listSessions(req, res, registry, token) },
    }),
    server.register({
      kind: 'prefix',
      path: '/api/godot/input',
      handler: (req, res) => { void input(req, res, registry, token) },
    }),
    server.register({
      kind: 'prefix',
      path: '/api/godot/tree',
      handler: (req, res) => { void tree(req, res, registry, token) },
    }),
    server.register({
      kind: 'prefix',
      path: '/api/godot/node',
      handler: (req, res) => { void node(req, res, registry, token) },
    }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}

/** Whether a request may use the endpoints. */
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

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(text)
}

/** Project the registry for the watch panel. */
function projectSessions(registry: GameSessionRegistry): SessionView[] {
  return registry.list().map((session) => {
    const snapshot = session.snapshot?.()
    return {
      sessionId: session.sessionId,
      state: snapshot?.state ?? 'ready',
      pid: session.pid,
      window: snapshot?.window ?? null,
      lostReason: snapshot?.lostReason ?? null,
    }
  })
}

/** `/api/godot/sessions`: what the watch panel polls. */
function listSessions(
  req: IncomingMessage,
  res: ServerResponse,
  registry: GameSessionRegistry,
  token: string | undefined,
): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!authorized(req, url, token)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  json(res, 200, { ok: true, sessions: projectSessions(registry) })
}

/**
 * `/api/godot/tree`: the running game's node tree.
 *
 * The watch panel renders it exactly like a `.tscn` preview — same rows, same
 * icons — so the live hierarchy is readable while the game runs. Bounded like
 * every other answer: the bridge reports the whole tree, the route trims it.
 */
async function tree(
  req: IncomingMessage,
  res: ServerResponse,
  registry: GameSessionRegistry,
  token: string | undefined,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!authorized(req, url, token)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const sessionId = url.searchParams.get('session') ?? ''
  const handle = registry.list().find(item => item.sessionId === sessionId)
  if (handle === undefined || handle.snapshot?.().state === 'lost') {
    json(res, 404, { ok: false, error: 'unknown-session' })
    return
  }
  const requested = Number(url.searchParams.get('maxNodes') ?? TREE_NODES_DEFAULT)
  const maxNodes = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), TREE_NODES_MAX)
    : TREE_NODES_DEFAULT
  const abort = new AbortController()
  const timer = setTimeout(() => { abort.abort() }, TREE_TIMEOUT_MS)
  try {
    // The bridge trims the tree itself, so hand it the same budget the route
    // promises: otherwise it answers its own default (200 nodes) and reports a
    // truncation nobody asked for.
    const reply = await handle.request('state', { tree: true, targets: false, diff: false, maxNodes }, abort.signal)
    const parsed = parseTree(reply.payload.tree)
    if (parsed === null) {
      json(res, 200, { ok: false, error: 'no-tree' })
      return
    }
    const bounded = boundTree(parsed, maxNodes)
    const returned = countNodes(bounded.nodes[0] ?? null)
    // The bridge enforces the budget we send, so an answer that fills the budget
    // may have left nodes behind even when our own bound did not fire. (The
    // scene's node count is not the yardstick: it counts the Window wrapper the
    // tree does not carry.)
    const sceneNodes = typeof reply.payload.nodeCount === 'number' ? reply.payload.nodeCount : returned
    json(res, 200, {
      ok: true,
      nodes: bounded.nodes,
      nodeCount: returned,
      sceneNodes,
      truncated: bounded.truncated || returned >= maxNodes,
    })
  } catch {
    json(res, 200, { ok: false, error: 'tree-unavailable' })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `/api/godot/node`: one node's properties, for the panel's detail pane.
 *
 * On demand only: the panel asks when a node is selected, so a tree with
 * hundreds of nodes costs nothing until someone looks at one.
 */
async function node(
  req: IncomingMessage,
  res: ServerResponse,
  registry: GameSessionRegistry,
  token: string | undefined,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!authorized(req, url, token)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const sessionId = url.searchParams.get('session') ?? ''
  const path = url.searchParams.get('path') ?? ''
  const handle = registry.list().find(item => item.sessionId === sessionId)
  if (handle === undefined || handle.snapshot?.().state === 'lost') {
    json(res, 404, { ok: false, error: 'unknown-session' })
    return
  }
  if (path === '') {
    json(res, 400, { ok: false, error: 'missing-path' })
    return
  }
  const abort = new AbortController()
  const timer = setTimeout(() => { abort.abort() }, TREE_TIMEOUT_MS)
  try {
    const reply = await handle.request('node', { path, maxProps: NODE_MAX_PROPS, depth: 2 }, abort.signal)
    if (typeof reply.payload.error === 'string') {
      json(res, 200, { ok: false, error: 'node-unavailable' })
      return
    }
    const rows = Array.isArray(reply.payload.props) ? reply.payload.props : []
    json(res, 200, {
      ok: true,
      className: typeof reply.payload.class === 'string' ? reply.payload.class : '',
      scene: typeof reply.payload.scene === 'string' ? reply.payload.scene : '',
      total: typeof reply.payload.total === 'number' ? reply.payload.total : rows.length,
      props: rows.flatMap((row) => {
        if (typeof row !== 'object' || row === null) return []
        const record = row as Record<string, unknown>
        if (typeof record.name !== 'string') return []
        return [{
          name: record.name,
          value: typeof record.value === 'string' ? record.value : JSON.stringify(record.value ?? null),
          ...(typeof record.type === 'string' && record.type !== '' ? { type: record.type } : {}),
        }]
      }),
    })
  } catch {
    json(res, 200, { ok: false, error: 'node-unavailable' })
  } finally {
    clearTimeout(timer)
  }
}

/** Trim a tree to a node budget, reporting whether anything was dropped. */
function boundTree(root: SceneTreeNode, maxNodes: number): { nodes: SceneTreeNode[]; truncated: boolean } {
  let remaining = maxNodes
  let truncated = false
  const cut = (node: SceneTreeNode): SceneTreeNode | null => {
    if (remaining <= 0) {
      truncated = true
      return null
    }
    remaining -= 1
    const children: SceneTreeNode[] = []
    for (const child of node.children) {
      const kept = cut(child)
      if (kept !== null) children.push(kept)
    }
    return { ...node, children }
  }
  const top = cut(root)
  return { nodes: top === null ? [] : [top], truncated }
}

/** Count every node of a tree (null counts as none). */
function countNodes(node: SceneTreeNode | null): number {
  if (node === null) return 0
  return node.children.reduce((total, child) => total + countNodes(child), 1)
}

/** `/api/godot/input`: one click forwarded to a session. */
async function input(
  req: IncomingMessage,
  res: ServerResponse,
  registry: GameSessionRegistry,
  token: string | undefined,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!authorized(req, url, token)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'use POST' })
    return
  }
  let body: unknown
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    json(res, 400, { ok: false, error: 'invalid JSON body' })
    return
  }
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const sessionId = record.session
  const x = record.x
  const y = record.y
  if (typeof sessionId !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
    json(res, 400, { ok: false, error: 'session, x, and y are required' })
    return
  }
  const session = registry.list().find(candidate => candidate.sessionId === sessionId)
  if (session === undefined) {
    json(res, 404, { ok: false, error: 'unknown session' })
    return
  }
  try {
    const reply = await session.request('click', {
      x,
      y,
      button: record.button === 'right' || record.button === 'middle' ? record.button : 'left',
      double: record.double === true,
    })
    json(res, 200, {
      ok: true,
      hit: typeof reply.payload.hit === 'string' ? reply.payload.hit : null,
      frames: typeof reply.payload.frames === 'number' ? reply.payload.frames : 0,
    })
  } catch (error: unknown) {
    json(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Read a bounded request body. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_INPUT_BYTES) {
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** `/api/godot/view`: the MJPEG stream. */
function stream(
  req: IncomingMessage,
  res: ServerResponse,
  registry: GameSessionRegistry,
  options: ViewRouteOptions,
  token: string | undefined,
): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!authorized(req, url, token)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  const session = registry.list().find(candidate => candidate.sessionId === url.searchParams.get('session'))
  if (session === undefined) {
    res.writeHead(404)
    res.end('unknown session')
    return
  }
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store',
  })
  res.flushHeaders()
  const intervalMs = options.intervalMs ?? 200
  let busy = false
  const timer = setInterval(() => { void push() }, intervalMs)
  const stop = (): void => { clearInterval(timer) }
  req.on('close', stop)

  const push = async (): Promise<void> => {
    if (busy || res.writableLength > MAX_BUFFERED_BYTES) return
    busy = true
    try {
      const reply = await session.request('shot', {
        format: 'jpg',
        maxWidth: options.maxWidth ?? 640,
        quality: options.quality ?? 0.7,
      })
      const data = Buffer.from(typeof reply.payload.data === 'string' ? reply.payload.data : '', 'base64')
      res.write(Buffer.concat([
        Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${data.length}\r\n\r\n`),
        data,
        Buffer.from('\r\n'),
      ]))
    } catch {
      stop()
      res.end()
    } finally {
      busy = false
    }
  }
}
