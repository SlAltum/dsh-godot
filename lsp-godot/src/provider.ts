/**
 * The Godot GDScript LSP provider registered on `ctx.lsp`. One query =
 * canonicalize workspace → read source → pooled connection (attach/spawn) →
 * capability negotiation → transient didOpen → request → normalize (with
 * Godot hover cleaning and URI normalization) → didClose. `goToImplementation`
 * is rejected by capability negotiation (Godot never advertises it, T0 fact).
 * @module @deepseek-ai/dsh-lsp-godot/provider
 */

import { LspError, LspProviderId } from '@deepseek-ai/dsh-lsp'
import type { LspOperation, LspProvider, LspProviderQuery, LspQueryResult } from '@deepseek-ai/dsh-lsp'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { canonicalizeWorkspace, readHostSource } from '@deepseek-ai/dsh-lsp-stdio'
import type { HostSource, HostWorkspace } from '@deepseek-ai/dsh-lsp-stdio/src/host.ts'
import { normalizeHover, normalizeLocations, requestMethod, supportsOperation, supportsTransientOpen } from '@deepseek-ai/dsh-lsp-stdio'
import type { ResolvedGodotLspConfig, GodotLspConfig } from './config.ts'
import type { GodotLspConnection } from './connection.ts'
import { GodotEndpointError } from './endpoint.ts'
import { hoverClean } from './hover-clean.ts'
import { ConnectionPool } from './pool.ts'
import { normalizeGodotUri } from './uri.ts'

/** Connection establishment for one workspace; the provider passes the canonical workspace context. */
export type GodotConnect = (
  workspaceKey: string,
  workspace: HostWorkspace,
  signal: AbortSignal,
) => Promise<GodotLspConnection>

/**
 * The `ctx.lsp` provider for GDScript. Connections are pooled per canonical
 * workspace; queries serialize per workspace so transient document lifecycles
 * never interleave.
 */
export class GodotLspProvider implements LspProvider {
  readonly id: LspProviderId = LspProviderId('godot')
  readonly extensionToLanguage = { '.gd': 'gdscript' } as const
  private readonly pool: ConnectionPool<GodotLspConnection>
  private readonly config: ResolvedGodotLspConfig
  private readonly lifetime = new AbortController()

  /**
   * @param fs - the filesystem provider sharing the host's execution world.
   * @param config - the plugin configuration (defaults filled by the schema).
   * @param connect - establishes one connection for a workspace (attach/spawn/auto).
   */
  constructor(
    private readonly fs: FileSystem,
    config: GodotLspConfig,
    private readonly connect: GodotConnect,
  ) {
    // The schema fills every default; the caller's typed input stays optional.
    this.config = config as ResolvedGodotLspConfig
    /* v8 ignore start -- the provider always passes the per-query create closure; the pool factory is the default path only. */
    this.pool = new ConnectionPool(() => Promise.reject(new Error('lsp-godot: connection creation requires the per-query workspace context')))
    /* v8 ignore stop */
  }

  /** Close every pooled connection and reject new queries (fiber disposal). */
  disposeAll(): Promise<void> {
    this.lifetime.abort(new Error('lsp-godot provider is disposed'))
    return this.pool.disposeAll()
  }

  /**
   * Run one semantic query against the workspace's Godot LSP connection.
   * @param request - the seam's resolved provider query.
   * @param signal - optional cancellation fused with provider disposal.
   * @returns the normalized locations or hover result.
   */
  async query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult> {
    const querySignal = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    const workspace = await canonicalizeWorkspace(this.fs, request.workspaceRoot, querySignal)
    const source = await readHostSource(this.fs, request.filePath, workspace, this.config.maxDocumentBytes, querySignal)
    return this.pool.withConnection(
      workspace.target.targetKey,
      querySignal,
      connection => this.runQuery(connection, request, source, workspace, querySignal),
      createSignal => this.connect(workspace.target.targetKey, workspace, createSignal),
    )
  }

  /** One serialized open→request→close lifecycle on a live connection. */
  private async runQuery(
    connection: GodotLspConnection,
    request: LspProviderQuery,
    source: HostSource,
    workspace: HostWorkspace,
    signal: AbortSignal,
  ): Promise<LspQueryResult> {
    if (!connection.matchesWorkspace()) {
      // The server serves a different project; results would be misleading.
      connection.close()
      throw new LspError(
        'Godot LSP project does not match the query workspace; open the matching project in Godot or use spawn mode',
        'LSP_UNAVAILABLE',
      )
    }
    if (!supportsOperation(connection.capabilities, request.operation)) {
      throw new LspError(`Godot LSP server does not support ${request.operation}`, 'LSP_UNSUPPORTED_OPERATION')
    }
    // Godot 4.7 advertises textDocumentSync { change: 1, openClose: true }
    // (T0 fact, corrected recording); the transient-open check gates the
    // didOpen lifecycle like any other server.
    if (!supportsTransientOpen(connection.capabilities.textDocumentSync)) {
      throw new LspError('Godot LSP server does not support transient document open', 'LSP_UNSUPPORTED_OPERATION')
    }
    const uri = source.fileUrl
    connection.endpoint.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: request.languageId, version: 1, text: source.text },
    })
    try {
      const params = {
        textDocument: { uri },
        position: request.position,
        // findReferences always includes declarations: impact analysis never
        // omits the defining site (seam contract).
        ...(request.operation === 'findReferences' ? { context: { includeDeclaration: true } } : {}),
      }
      let payload: unknown
      try {
        payload = await connection.endpoint.request(requestMethod(request.operation), params, signal)
      } catch (error) {
        /* v8 ignore start -- endpoint.request rejects only with GodotEndpointError; the pass-through branch is unreachable. */
        if (error instanceof GodotEndpointError) {
          throw new LspError(`Godot LSP request failed: ${error.message}`, 'LSP_UNAVAILABLE')
        }
        throw error
        /* v8 ignore stop */
      }
      return normalizeResult(request.operation, payload, workspace.fileUrl)
    } finally {
      // Skip didClose when the connection already died (its teardown rejects
      // the request); a best-effort close otherwise.
      if (!connection.dead) {
        try {
          connection.endpoint.notify('textDocument/didClose', { textDocument: { uri } })
        } catch {
          /* v8 ignore next -- notify is fire-and-forget; teardown owns a failed close. */
        }
      }
    }
  }
}

/** Normalize one raw operation payload into the seam's closed result union. */
function normalizeResult(operation: LspOperation, payload: unknown, workspaceFileUrl: string): LspQueryResult {
  if (operation === 'hover') {
    const hover = normalizeHover(payload)
    return { kind: 'hover', hover: hover === null ? null : { ...hover, contents: hoverClean(hover.contents) } }
  }
  return {
    kind: 'locations',
    locations: normalizeLocations(payload).map(location => ({ ...location, uri: normalizeGodotUri(location.uri) })),
    resolvedWorkspaceUri: workspaceFileUrl,
  }
}
