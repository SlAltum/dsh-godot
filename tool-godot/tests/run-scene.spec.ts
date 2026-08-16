/**
 * Unit tests for `godot_run_scene`: argument parsing, argv construction,
 * rendering, and card presentation.
 */

import { describe, expect, it } from 'vitest'
import { buildRunSceneCommand, parseRunSceneArgs, presentRunSceneCall, renderRunSceneOutput } from '@deepseek-ai/dsh-tool-godot'
import type { RunSceneResult } from '@deepseek-ai/dsh-tool-godot'

describe('parseRunSceneArgs', () => {
  it('defaults path/frames to absent and args to empty', () => {
    expect(parseRunSceneArgs({ scene: 'res://main.tscn' })).toEqual({ scene: 'res://main.tscn', args: [] })
  })

  it('keeps explicit path, frames, and args', () => {
    expect(parseRunSceneArgs({ scene: 's.tscn', path: 'proj', frames: 5, args: ['--x', 'y'] })).toEqual({
      scene: 's.tscn',
      path: 'proj',
      frames: 5,
      args: ['--x', 'y'],
    })
  })

  it('rejects a blank scene, a non-positive frames, and a blank path', () => {
    expect(() => parseRunSceneArgs({ scene: '  ' })).toThrow('scene must be a non-empty string')
    expect(() => parseRunSceneArgs({ scene: 's', frames: 0 })).toThrow('frames must be a positive integer')
    expect(() => parseRunSceneArgs({ scene: 's', frames: 1.5 })).toThrow('frames must be a positive integer')
    expect(() => parseRunSceneArgs({ scene: 's', path: ' ' })).toThrow('path must be a non-empty string')
  })
})

describe('buildRunSceneCommand', () => {
  it('builds the plain argv without frames or user args', () => {
    expect(buildRunSceneCommand('C:\\proj', 'res://main.tscn')).toEqual(['--headless', '--path', 'C:\\proj', 'res://main.tscn'])
  })

  it('adds --quit-after with frames', () => {
    expect(buildRunSceneCommand('C:\\proj', 'res://main.tscn', 60)).toEqual([
      '--headless',
      '--path',
      'C:\\proj',
      '--quit-after',
      '60',
      'res://main.tscn',
    ])
  })

  it('passes user args after --', () => {
    expect(buildRunSceneCommand('C:\\proj', 'res://main.tscn', 60, ['--a', 'b'])).toEqual([
      '--headless',
      '--path',
      'C:\\proj',
      '--quit-after',
      '60',
      'res://main.tscn',
      '--',
      '--a',
      'b',
    ])
  })
})

describe('renderRunSceneOutput', () => {
  const base: RunSceneResult = {
    projectRoot: 'C:\\proj',
    scene: 'res://main.tscn',
    exitCode: 0,
    output: 'hello\n',
    stderr: '',
    ok: true,
    stdoutTruncated: false,
    stderrTruncated: false,
  }

  it('renders the exit code and output', () => {
    const text = renderRunSceneOutput(base)
    expect(text).toContain('exited with code 0')
    expect(text).toContain('hello')
  })

  it('renders a signal kill, stderr tail, and truncation notes', () => {
    const text = renderRunSceneOutput({ ...base, signal: 'SIGTERM', stderr: 'boom', stdoutTruncated: true, stderrTruncated: true })
    expect(text).toContain('exited with signal SIGTERM')
    expect(text).toContain('(stdout truncated) (stderr truncated)')
    expect(text).toContain('stderr:\nboom')
  })

  it('renders the no-output placeholder', () => {
    expect(renderRunSceneOutput({ ...base, output: '' })).toContain('(no output)')
  })
})

describe('presentRunSceneCall', () => {
  it('titles with the scene and optional path/frames', () => {
    expect(presentRunSceneCall({ scene: 'res://main.tscn' })).toEqual({ card: 'generic', title: 'Run Godot scene res://main.tscn' })
    expect(presentRunSceneCall({ scene: 's.tscn', path: 'proj', frames: 5 })).toEqual({
      card: 'generic',
      title: 'Run Godot scene s.tscn in proj (5 frames)',
    })
  })
})
