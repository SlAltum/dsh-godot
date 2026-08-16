/**
 * Connection establishment for the Godot LSP provider: attach to a running
 * server through the TCP endpoint, perform the initialize handshake, collect
 * the `gdscript_client/changeWorkspace` project-path notification (T0: the
 * server sends it before the initialize response when the client rootUri does
 * not match the opened project), and expose the server capabilities the
 * provider negotiates against. Ports are tried in order.
 * @module @deepseek-ai/dsh-lsp-godot/connection
 */

import { LspError } from '@deepseek-ai/dsh-lsp'
import type { WireServerCapabilities } from '@deepseek-ai/dsh-lsp-stdio/src/protocol.ts'
import { GodotLspEndpoint } from './endpoint.ts'
import type { ConnectionHandle } from './pool.ts'

/** One established connection: endpoint plus negotiated capabilities. */
export interface GodotLspConnection extends ConnectionHandle {
  readonly endpoint: GodotLspEndpoint
  /** The server's `initialize` capabilities (authoritative for operation support). */
  readonly capabilities: WireServerCapabilities
  /** The opened project path reported by `gdscript_client/changeWorkspace`; undefined when matching. */
  readonly serverProjectPath: string | undefined
  /** Whether the server's project matches the query workspace (same root or parent). */
  matchesWorkspace(): boolean
}

/** Options for one attach attempt sequence. */
export interface EstablishOptions {
  /** LSP server host. */
  host: string
  /** Ports to try in order. */
  ports: number[]
  /** TCP connect budget per port. */
  connectTimeoutMs: number
  /** Partial-frame stall budget. */
  idleTimeoutMs: number
  /** Largest framed message accepted. */
  maxMessageBytes: number
  /** Canonical client workspace path (from `ctx.fs`). */
  workspaceRoot: string
  /** Canonical client workspace file URI sent as `rootUri`. */
  workspaceFileUrl: string
}

/**
 * Establish a connection by trying every configured port in order. The first
 * successful connect + initialize wins; a failed attempt closes its endpoint
 * and the next port is tried. All ports exhausted fails with
 * `LSP_UNAVAILABLE`.
 * @param options - the attach parameters.
 * @returns an established connection (never dead at return time).
 */
export async function establishConnection(options: EstablishOptions): Promise<GodotLspConnection> {
  let lastError: unknown
  for (const port of options.ports) {
    const notifications: Array<{ method: string; params: unknown }> = []
    const endpoint = new GodotLspEndpoint({
      host: options.host,
      port,
      connectTimeoutMs: options.connectTimeoutMs,
      idleTimeoutMs: options.idleTimeoutMs,
      maxMessageBytes: options.maxMessageBytes,
      onNotification: (method, params) => notifications.push({ method, params }),
    })
    try {
      await endpoint.connect()
      const init = await endpoint.request('initialize', {
        processId: null,
        rootUri: options.workspaceFileUrl,
        workspaceFolders: [{ uri: options.workspaceFileUrl, name: 'workspace' }],
        capabilities: CLIENT_CAPABILITIES,
      })
      endpoint.notify('initialized', {})
      const capabilities = (init as { capabilities?: WireServerCapabilities }).capabilities ?? {}
      const change = notifications.find(n => n.method === CHANGE_WORKSPACE_METHOD)
      const serverProjectPath = change?.params === null || change?.params === undefined
        ? undefined
        : (change.params as { path?: string }).path
      return new GodotLspConnectionImpl(endpoint, capabilities, serverProjectPath, options.workspaceRoot)
    } catch (error) {
      endpoint.close()
      lastError = error
    }
  }
  throw new LspError(`Godot LSP server unavailable: ${messageOf(lastError)}`, 'LSP_UNAVAILABLE')
}

/**
 * Whether the server's opened project matches the query workspace: the client
 * workspace is the server project root or a subfolder of it (the source
 * plugin's check_workspace rule). A missing server path means the server
 * never complained, so the roots matched.
 * @param serverProjectPath - the path from `changeWorkspace`, if any.
 * @param workspaceRoot - the canonical client workspace path.
 * @returns true when the query may be served by this connection.
 */
export function workspaceMatches(serverProjectPath: string | undefined, workspaceRoot: string): boolean {
  if (serverProjectPath === undefined) return true
  const server = normalizePath(serverProjectPath)
  const client = normalizePath(workspaceRoot)
  return client === server || client.startsWith(`${server}/`)
}

class GodotLspConnectionImpl implements GodotLspConnection {
  constructor(
    readonly endpoint: GodotLspEndpoint,
    readonly capabilities: WireServerCapabilities,
    readonly serverProjectPath: string | undefined,
    private readonly workspaceRoot: string,
  ) {}

  get dead(): boolean {
    return !this.endpoint.connected
  }

  close(): void {
    this.endpoint.close()
  }

  matchesWorkspace(): boolean {
    return workspaceMatches(this.serverProjectPath, this.workspaceRoot)
  }
}

/** The server→client notification carrying the opened project path. */
export const CHANGE_WORKSPACE_METHOD = 'gdscript_client/changeWorkspace'

/** Client capabilities advertised at initialize (no dynamic registration). */
const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  workspace: { workspaceFolders: true, configuration: true },
  textDocument: {
    synchronization: { dynamicRegistration: false },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    definition: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
  },
} as const

/** Case- and separator-insensitive path comparison form. */
function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
}

/** Render an unknown failure for the LSP_UNAVAILABLE message. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- endpoint failures are always Error instances; the String() fallback covers a non-Error throw. */
  return error instanceof Error ? error.message : String(error)
}
