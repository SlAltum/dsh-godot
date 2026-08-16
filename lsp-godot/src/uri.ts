/**
 * Godot LSP URI normalization. Godot returns `file:` URIs with URL-encoded
 * path segments (`file:///D%3A/...`); DSH fs providers emit WHATWG
 * `pathToFileURL` form (`file:///D:/...`). Locations are normalized to the fs
 * form so `tool-lsp`'s workspace-relative rendering can match them against
 * the provider's canonical workspace URI (T0 fact 7, `.context/t0/facts.md`).
 * @module @deepseek-ai/dsh-lsp-godot/uri
 */

import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Normalize a Godot LSP `file:` URI to the DSH fs `fileUrl` form. Non-`file:`
 * URIs, malformed URIs, and relative file URIs pass through unchanged.
 * @param uri - the URI verbatim from Godot.
 * @returns the normalized URI (unchanged when not a valid absolute `file:` URI).
 */
export function normalizeGodotUri(uri: string): string {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return uri
  }
  if (parsed.protocol !== 'file:') return uri
  try {
    return pathToFileURL(fileURLToPath(parsed)).href
  } catch {
    // Relative or otherwise unrepresentable file URLs stay verbatim.
    return uri
  }
}
