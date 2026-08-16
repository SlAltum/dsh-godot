/**
 * Unit tests for `godot_format` and the presentation projections: argument
 * parsing, argv construction, UTF-8 capping, meta projection, diff-card
 * narrowing, and card presentation.
 */

import { describe, expect, it } from 'vitest'
import {
  buildFormatCommand,
  capUtf8,
  formatMeta,
  formatViewFromMeta,
  parseFormatArgs,
  presentFormatCall,
  presentFormatResult,
} from '@deepseek-ai/dsh-tool-godot'
import type { FormatResult } from '@deepseek-ai/dsh-tool-godot'

describe('parseFormatArgs', () => {
  it('accepts a non-blank file', () => {
    expect(parseFormatArgs({ file: 'scripts/main.gd' })).toEqual({ file: 'scripts/main.gd' })
  })

  it('rejects a blank file', () => {
    expect(() => parseFormatArgs({ file: '  ' })).toThrow('file must be a non-empty string')
  })
})

describe('buildFormatCommand', () => {
  it('targets the temporary copy', () => {
    expect(buildFormatCommand('C:\\tmp\\x.gd')).toEqual(['C:\\tmp\\x.gd'])
  })
})

describe('capUtf8', () => {
  it('passes text under the cap through unchanged', () => {
    expect(capUtf8('hello', 100)).toEqual({ text: 'hello', truncated: false })
  })

  it('cuts ASCII text at the byte cap', () => {
    expect(capUtf8('hello world', 5)).toEqual({ text: 'hello', truncated: true })
  })

  it('never splits a multi-byte character', () => {
    // '😀' is 4 UTF-8 bytes; a 5-byte budget must cut before it, not inside.
    expect(capUtf8('ab😀cd', 5)).toEqual({ text: 'ab', truncated: true })
  })
})

describe('formatMeta', () => {
  const value: FormatResult = { file: 'scripts/main.gd', formatted: 'new text', original: 'old text', changed: true }

  it('projects path, oldText, and newText', () => {
    expect(formatMeta(value)).toEqual({ path: 'scripts/main.gd', oldText: 'old text', newText: 'new text' })
  })

  it('caps both sides at the meta budget', () => {
    const big: FormatResult = { file: 'big.gd', formatted: 'y'.repeat(100_000), original: 'x'.repeat(100_000), changed: true }
    const meta = formatMeta(big)
    expect(meta.oldText.length).toBeLessThan(70_000)
    expect(meta.newText.length).toBeLessThan(70_000)
  })
})

describe('formatViewFromMeta', () => {
  it('narrows valid metadata to a diff card', () => {
    const view = formatViewFromMeta({ path: 'scripts/main.gd', oldText: 'old', newText: 'new' })
    expect(view).toEqual({
      card: 'diff',
      title: 'Format scripts/main.gd',
      diffs: [{ path: 'scripts/main.gd', oldText: 'old', newText: 'new' }],
    })
  })

  it('returns undefined for malformed metadata', () => {
    expect(formatViewFromMeta(undefined)).toBeUndefined()
    expect(formatViewFromMeta(null)).toBeUndefined()
    expect(formatViewFromMeta('text')).toBeUndefined()
    expect(formatViewFromMeta([])).toBeUndefined()
    expect(formatViewFromMeta({ path: 3, oldText: 'a', newText: 'b' })).toBeUndefined()
    expect(formatViewFromMeta({ path: 'a', oldText: 3, newText: 'b' })).toBeUndefined()
    expect(formatViewFromMeta({ path: 'a', oldText: 'x', newText: 3 })).toBeUndefined()
  })
})

describe('presentFormatCall', () => {
  it('titles with the file', () => {
    expect(presentFormatCall({ file: 'scripts/main.gd' })).toEqual({ card: 'generic', title: 'Format GDScript scripts/main.gd' })
  })
})

describe('presentFormatResult', () => {
  it('returns undefined for an errored result', () => {
    expect(presentFormatResult({ file: 'a.gd' }, { isError: true } as never)).toBeUndefined()
  })

  it('returns a diff card from valid metadata', () => {
    const result = { isError: false, meta: { path: 'a.gd', oldText: 'old', newText: 'new' } } as never
    expect(presentFormatResult({ file: 'a.gd' }, result)?.card).toBe('diff')
  })
})
