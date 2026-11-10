/**
 * LSP wire types the Godot provider reads from the `initialize` response.
 *
 * These describe the protocol, not a DSH implementation. `dsh-lsp-stdio`
 * already defines them, but exports the interfaces from `src/protocol.ts`,
 * a path the published package does not ship, so a provider that installs it
 * from the registry cannot import them. The fields below are exactly the ones
 * this provider inspects; `HostWorkspace` and `HostSource` are derived from the
 * package's public functions so they keep tracking the installed version.
 * @module @deepseek-ai/dsh-lsp-godot/lsp-wire-types
 */

import type { canonicalizeWorkspace, readHostSource } from '@deepseek-ai/dsh-lsp-stdio'

/** The legacy enum form of `textDocumentSync` (`0` None, `1` Full, `2` Incremental). */
export type WireTextDocumentSyncKind = 0 | 1 | 2

/** The options form of `textDocumentSync` (`{ openClose, change }`). */
export interface WireTextDocumentSyncOptions {
  readonly openClose?: boolean
  readonly change?: WireTextDocumentSyncKind
}

/** A `ServerCapabilities.provider` slot: a boolean or an options object (both mean "supported"). */
export type WireProviderCapability = boolean | Record<string, unknown> | undefined

/** The `ServerCapabilities` fields this provider inspects. */
export interface WireServerCapabilities {
  readonly positionEncoding?: string
  readonly textDocumentSync?: WireTextDocumentSyncKind | WireTextDocumentSyncOptions
  readonly definitionProvider?: WireProviderCapability
  readonly referencesProvider?: WireProviderCapability
  readonly implementationProvider?: WireProviderCapability
  readonly hoverProvider?: WireProviderCapability
}

/** The canonical workspace handle the stdio host returns. */
export type HostWorkspace = Awaited<ReturnType<typeof canonicalizeWorkspace>>

/** One host source document the stdio host returns. */
export type HostSource = Awaited<ReturnType<typeof readHostSource>>
