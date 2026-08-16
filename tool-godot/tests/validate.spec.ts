/**
 * Unit tests for `godot_validate`: argument parsing, argv construction, the
 * Godot diagnostics parser, rendering, and card presentation.
 */

import { describe, expect, it } from 'vitest'
import {
  buildValidateCommand,
  parseGodotDiagnostics,
  parseValidateArgs,
  presentValidateCall,
  presentValidateResult,
  renderValidateOutput,
  stripAnsi,
} from '@deepseek-ai/dsh-tool-godot'
import type { ValidateResult } from '@deepseek-ai/dsh-tool-godot'

describe('parseValidateArgs', () => {
  it('defaults to project mode and keeps an explicit path', () => {
    expect(parseValidateArgs({})).toEqual({ mode: 'project' })
    expect(parseValidateArgs({ path: 'proj', mode: 'file' })).toEqual({ path: 'proj', mode: 'file' })
  })

  it('rejects a blank path', () => {
    expect(() => parseValidateArgs({ path: '  ' })).toThrow('path must be a non-empty string')
  })
})

describe('buildValidateCommand', () => {
  it('builds the project-mode headless editor argv', () => {
    expect(buildValidateCommand('project', 'C:\\proj', '')).toEqual(['--headless', '--editor', '--path', 'C:\\proj', '--quit'])
  })

  it('builds the file-mode check-only argv', () => {
    expect(buildValidateCommand('file', 'C:\\proj', 'C:\\proj\\main.gd')).toEqual([
      '--headless',
      '--check-only',
      '--script',
      'C:\\proj\\main.gd',
      '--path',
      'C:\\proj',
    ])
  })
})

describe('stripAnsi', () => {
  it('strips ANSI CSI sequences', () => {
    expect(stripAnsi('\u001b[31mERROR: x\u001b[0m')).toBe('ERROR: x')
  })

  it('passes plain text through unchanged', () => {
    expect(stripAnsi('ERROR: x')).toBe('ERROR: x')
  })
})

describe('parseGodotDiagnostics', () => {
  it('parses an ERROR with a path:line:column location', () => {
    const issues = parseGodotDiagnostics('ERROR: Parse Error: Unexpected token\n   at: res://scripts/main.gd:12:5\n')
    expect(issues).toEqual([{ kind: 'error', message: 'Parse Error: Unexpected token', path: 'res://scripts/main.gd', line: 12, column: 5 }])
  })

  it('parses an ERROR with a path:line location', () => {
    const issues = parseGodotDiagnostics('SCRIPT ERROR: Invalid access\n   at: res://scripts/main.gd:7\n')
    expect(issues).toEqual([{ kind: 'error', message: 'Invalid access', path: 'res://scripts/main.gd', line: 7 }])
  })

  it('parses a WARNING', () => {
    const issues = parseGodotDiagnostics('WARNING: Unused variable\n   at: res://scripts/main.gd:3:1\n')
    expect(issues).toEqual([{ kind: 'warning', message: 'Unused variable', path: 'res://scripts/main.gd', line: 3, column: 1 }])
  })

  it('keeps an issue without a location and ignores a stray at: line', () => {
    // The at: line precedes any issue (no pending), so it is ignored; the
    // ERROR after it has no location line and keeps only its message.
    const issues = parseGodotDiagnostics('   at: res://scripts/main.gd:1:1\nERROR: Lost cause\n')
    expect(issues).toEqual([{ kind: 'error', message: 'Lost cause' }])
  })

  it('parses multiple issues in order with ANSI stripped', () => {
    const issues = parseGodotDiagnostics(
      '\u001b[31mERROR: One\u001b[0m\n   at: res://a.gd:1:1\nWARNING: Two\n   at: res://a.gd:2:2\nERROR: Three\n',
    )
    expect(issues).toEqual([
      { kind: 'error', message: 'One', path: 'res://a.gd', line: 1, column: 1 },
      { kind: 'warning', message: 'Two', path: 'res://a.gd', line: 2, column: 2 },
      { kind: 'error', message: 'Three' },
    ])
  })

  it('ignores blank and unrelated lines', () => {
    expect(parseGodotDiagnostics('\n\nGodot Engine v4.7\n\n')).toEqual([])
  })
})

describe('renderValidateOutput', () => {
  const base: ValidateResult = {
    projectRoot: 'C:\\proj',
    mode: 'project',
    ok: true,
    issues: [],
    exitCode: 0,
    issuesTruncated: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  }

  it('renders a clean pass', () => {
    expect(renderValidateOutput(base)).toContain('passed')
    expect(renderValidateOutput(base)).toContain('No issues reported.')
  })

  it('renders issues with locations and truncation notes', () => {
    const value: ValidateResult = {
      ...base,
      ok: false,
      exitCode: 1,
      issues: [
        { kind: 'error', message: 'Unexpected token', path: 'scripts/main.gd', line: 12, column: 5 },
        { kind: 'warning', message: 'Unused', path: 'scripts/main.gd' },
      ],
      issuesTruncated: true,
      stdoutTruncated: true,
      stderrTruncated: true,
    }
    const text = renderValidateOutput(value)
    expect(text).toContain('failed (exit 1)')
    expect(text).toContain('scripts/main.gd:12:5 [error] Unexpected token')
    expect(text).toContain('scripts/main.gd [warning] Unused')
    expect(text).toContain('(showing the first 2 issues) (stdout truncated) (stderr truncated)')
  })

  it('renders a killed run', () => {
    expect(
      renderValidateOutput({
        projectRoot: 'C:\\proj',
        mode: 'project',
        ok: false,
        issues: [],
        issuesTruncated: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
    ).toContain('(exit killed)')
  })
})

describe('presentValidateCall', () => {
  it('titles with the mode and target', () => {
    expect(presentValidateCall({})).toEqual({ card: 'generic', title: 'Validate Godot project workspace' })
    expect(presentValidateCall({ path: 'C:\\proj', mode: 'file' })).toEqual({
      card: 'generic',
      title: 'Validate Godot file C:\\proj',
    })
  })
})

describe('presentValidateResult', () => {
  it('returns undefined for an errored result', () => {
    expect(presentValidateResult({}, { isError: true } as never)).toBeUndefined()
  })

  it('returns undefined for malformed metadata', () => {
    expect(presentValidateResult({}, { isError: false, meta: null } as never)).toBeUndefined()
    expect(presentValidateResult({}, { isError: false, meta: { ok: 'no' } } as never)).toBeUndefined()
  })

  it('returns a card from valid metadata', () => {
    const result = {
      isError: false,
      meta: {
        ok: false,
        issuesTruncated: false,
        issues: [
          { kind: 'error', message: 'Unexpected token', path: 'scripts/main.gd', line: 12, column: 5 },
          { kind: 'warning', message: 'Unused', path: 'scripts/main.gd' },
        ],
      },
    } as never
    const view = presentValidateResult({}, result)
    const textBlock = (view?.content?.[0] as { text?: string } | undefined)?.text
    expect(view?.card).toBe('generic')
    expect(view?.title).toBe('Godot validation failed')
    expect(textBlock).toContain('scripts/main.gd:12:5 [error] Unexpected token')
  })

  it('returns a card for an empty issue list', () => {
    const result = { isError: false, meta: { ok: true, issuesTruncated: false, issues: [] } } as never
    const view = presentValidateResult({}, result)
    expect(view?.title).toBe('Godot validation passed')
  })

  it('drops malformed entries from replayed issue metadata', () => {
    const result = {
      isError: false,
      meta: {
        ok: false,
        issuesTruncated: false,
        issues: [null, 'junk', { kind: 'error' }, { message: 'no-kind' }, { kind: 'error', message: 'Survivor' }],
      },
    } as never
    const view = presentValidateResult({}, result)
    const textBlock = (view?.content?.[0] as { text?: string } | undefined)?.text
    expect(textBlock).toContain('Survivor')
    expect(textBlock).not.toContain('no-kind')
  })

  it('marks truncated issue lists in the card', () => {
    const result = {
      isError: false,
      meta: {
        ok: false,
        issuesTruncated: true,
        issues: [{ kind: 'error', message: 'Too many', path: 'a.gd', line: 1 }],
      },
    } as never
    const view = presentValidateResult({}, result)
    const textBlock = (view?.content?.[0] as { text?: string } | undefined)?.text
    expect(textBlock).toContain('(showing the first 1 issues)')
  })
})
