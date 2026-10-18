/**
 * Unit tests for `godot_editor_script`: argument parsing, argv construction,
 * bootstrap generation, JSON detection, rendering, and card presentation.
 */

import { describe, expect, it } from 'vitest'
import {
  buildEditorScriptBootstrap,
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
  it('points --script at the written bootstrap, not the EditorScript', () => {
    expect(buildEditorScriptCommand('C:\\proj', 'C:\\tmp\\boot.gd')).toEqual([
      '--headless',
      '--editor',
      '--path',
      'C:\\proj',
      '--script',
      'C:\\tmp\\boot.gd',
    ])
  })

  it('passes user args after --', () => {
    expect(buildEditorScriptCommand('C:\\proj', 'C:\\tmp\\boot.gd', ['--a', 'b'])).toEqual([
      '--headless',
      '--editor',
      '--path',
      'C:\\proj',
      '--script',
      'C:\\tmp\\boot.gd',
      '--',
      '--a',
      'b',
    ])
  })
})

describe('buildEditorScriptBootstrap', () => {
  it('embeds the target path and runs its _run()', () => {
    const source = buildEditorScriptBootstrap('res://tools/check.gd')
    expect(source.startsWith('extends SceneTree\n')).toBe(true)
    expect(source).toContain('var target := "res://tools/check.gd"')
    expect(source).toContain('if instance.has_method("run"):')
    expect(source).toContain('instance.call("_run")')
    expect(source).toContain('\tquit(0)')
  })

  it('escapes quotes and backslashes in the embedded path', () => {
    expect(buildEditorScriptBootstrap('res://a"b\\c.gd')).toContain('var target := "res://a\\"b\\\\c.gd"')
  })
})

describe('tryParseJson', () => {
  it('parses object and array output', () => {
    expect(tryParseJson('{"ok":true}')).toEqual({ ok: true })
    expect(tryParseJson('  [1, 2]  ')).toEqual([1, 2])
  })

  it('returns undefined for empty or non-JSON output', () => {
    expect(tryParseJson('')).toBeUndefined()
    expect(tryParseJson('hello world')).toBeUndefined()
    expect(tryParseJson('{oops')).toBeUndefined()
  })

  it('finds the JSON line past the engine banner', () => {
    expect(tryParseJson('Godot Engine v4.7.2\n[ 0% ] scanning\n{"ok":true}\n')).toEqual({ ok: true })
  })

  it('walks back past trailing text and unparseable JSON lines', () => {
    expect(tryParseJson('{"count":3}\ntrailing text\n')).toEqual({ count: 3 })
    expect(tryParseJson('banner\n[1,2]\n')).toEqual([1, 2])
    expect(tryParseJson('banner\n{broken}\n')).toBeUndefined()
  })
})

describe('renderEditorScriptOutput', () => {
  const base: EditorScriptResult = {
    projectRoot: 'C:\\proj',
    script: 'res://tools/check.gd',
    exitCode: 0,
    output: '{"ok":true}',
    stderr: '',
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

  it('surfaces the engine stderr of a failed run', () => {
    const text = renderEditorScriptOutput({
      ...base,
      ok: false,
      exitCode: 1,
      output: '',
      stderr: 'ERROR: Failed to load script "res://tools/check.gd"\n',
    })
    expect(text).toContain('exited with code 1')
    expect(text).toContain('stderr:\nERROR: Failed to load script')
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
