/**
 * Godot LSP URI normalization (plan T1.3/S1): Godot returns `file:` URIs with
 * URL-encoded path segments (`file:///D%3A/...`), while DSH's fs providers
 * emit WHATWG `pathToFileURL` form (`file:///D:/...`). The provider must
 * normalize Godot URIs to the fs form or tool-lsp's workspace-relative
 * rendering cannot match them. Fixtures are the real URIs recorded in the T0
 * transcript (replayed from `tests/fixtures/t0-responses.json`).
 */

import { describe, expect, it } from 'vitest'
import { normalizeGodotUri } from '../src/uri.ts'

/** Real Godot 4.7 definition result URI (T0 transcript), project path anonymized. */
const REAL_GODOT_URI = 'file:///D%3A/project/player.gd'
/** The same path in DSH fs-local `pathToFileURL` form (independent source of truth). */
const DSH_FS_URI = 'file:///D:/project/player.gd'

describe('normalizeGodotUri', () => {
  it('decodes URL-encoded drive letters to the DSH fs form (real T0 URI)', () => {
    expect(normalizeGodotUri(REAL_GODOT_URI)).toBe(DSH_FS_URI)
  })

  it('normalizes drive letters in any position (C:, D:), keeping %20 spaces encoded', () => {
    expect(normalizeGodotUri('file:///C%3A/Users/me/test.gd')).toBe('file:///C:/Users/me/test.gd')
    expect(normalizeGodotUri('file:///D%3A/a%20b/x.gd')).toBe('file:///D:/a%20b/x.gd')
  })

  it('round-trips non-ASCII path segments (zh directory) to the same encoding', () => {
    expect(normalizeGodotUri('file:///D%3A/%E8%BD%AF%E4%BB%B6/godot/x.gd')).toBe('file:///D:/%E8%BD%AF%E4%BB%B6/godot/x.gd')
  })

  it('leaves already-canonical file URIs unchanged', () => {
    expect(normalizeGodotUri(DSH_FS_URI)).toBe(DSH_FS_URI)
  })

  it('leaves non-file URIs unchanged', () => {
    expect(normalizeGodotUri('https://example.com/x.gd')).toBe('https://example.com/x.gd')
  })

  it('leaves malformed URIs unchanged', () => {
    expect(normalizeGodotUri('not-a-uri')).toBe('not-a-uri')
    expect(normalizeGodotUri('file:///relative/path.gd')).toBe('file:///relative/path.gd')
  })

  it('leaves the empty string unchanged', () => {
    expect(normalizeGodotUri('')).toBe('')
  })
})
