/**
 * Unit tests for `godot_editor_script`: argument parsing, argv construction,
 * JSON detection, rendering, and card presentation.
 */

import { describe, expect, it } from 'vitest'
import {
  buildEditorScriptCommand,
  parseEditorScriptArgs,
  presentEditorScriptCall,
  renderEditorScriptOutput,
  tryParseJson,
} from '@deepseek-ai/dsh-tool-godot'
import type { EditorScriptResult } from '@deepseek-ai/dsh-tool-godot'

describe('parseEditorScriptArgs', () => {
  it('keeps the script and defaults args to empty', () => {
    expect(parseEditorScriptArgs({ script: 'res://tools/check.gd' })).toEqual({ script: 'res://tools/check.gd', args: [] })
  })

  it('keeps an explicit path and args', () => {
    expect(parseEditorScriptArgs({ script: 'res://tools/check.gd', path: 'proj', args: ['--a'] })).toEqual({
      script: 'res://tools/check.gd',
      path: 'proj',
      args: ['--a'],
    })
  })

  it('rejects a blank script, a non-res path, and a blank path', () => {
    expect(() => parseEditorScriptArgs({ script: '  ' })).toThrow('script must be a non-empty string')
    expect(() => parseEditorScriptArgs({ script: 'tools/check.gd' })).toThrow('script must be a res:// path')
    expect(() => parseEditorScriptArgs({ script: 'res://a.gd', path: ' ' })).toThrow('path must be a non-empty string')
  })
})

describe('buildEditorScriptCommand', () => {
  it('builds the plain argv without user args', () => {
    expect(buildEditorScriptCommand('C:\\proj', 'res://tools/check.gd')).toEqual([
      '--headless',
      '--editor',
      '--path',
      'C:\\proj',
      '--script',
      'res://tools/check.gd',
    ])
  })

  it('passes user args after --', () => {
    expect(buildEditorScriptCommand('C:\\proj', 'res://tools/check.gd', ['--a', 'b'])).toEqual([
      '--headless',
      '--editor',
      '--path',
      'C:\\proj',
      '--script',
      'res://tools/check.gd',
      '--',
      '--a',
      'b',
    ])
  })
})

describe('tryParseJson', () => {
  it('parses object and array JSON output', () => {
    expect(tryParseJson('{"ok":true}')).toEqual({ ok: true })
    expect(tryParseJson('  [1, 2]  ')).toEqual([1, 2])
  })

  it('returns undefined for non-JSON output', () => {
    expect(tryParseJson('')).toBeUndefined()
    expect(tryParseJson('hello world')).toBeUndefined()
    expect(tryParseJson('{oops')).toBeUndefined()
  })
})

describe('renderEditorScriptOutput', () => {
  const base: EditorScriptResult = {
    projectRoot: 'C:\\proj',
    script: 'res://tools/check.gd',
    exitCode: 0,
    output: '{"ok":true}',
    ok: true,
    stdoutTruncated: false,
    stderrTruncated: false,
  }

  it('renders the exit code and output', () => {
    const text = renderEditorScriptOutput(base)
    expect(text).toContain('exited with code 0')
    expect(text).toContain('{"ok":true}')
  })

  it('renders a signal kill and truncation notes', () => {
    const text = renderEditorScriptOutput({ ...base, signal: 'SIGKILL', stdoutTruncated: true, stderrTruncated: true })
    expect(text).toContain('exited with signal SIGKILL')
    expect(text).toContain('(stdout truncated) (stderr truncated)')
  })

  it('renders the no-output placeholder', () => {
    expect(renderEditorScriptOutput({ ...base, output: '' })).toContain('(no output)')
  })
})

describe('presentEditorScriptCall', () => {
  it('titles with the script and optional path', () => {
    expect(presentEditorScriptCall({ script: 'res://tools/check.gd' })).toEqual({
      card: 'generic',
      title: 'Run Godot EditorScript res://tools/check.gd',
    })
    expect(presentEditorScriptCall({ script: 'res://tools/check.gd', path: 'proj' })).toEqual({
      card: 'generic',
      title: 'Run Godot EditorScript res://tools/check.gd in proj',
    })
  })
})
