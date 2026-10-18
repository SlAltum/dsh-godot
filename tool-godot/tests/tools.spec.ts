/**
 * Integration tests: the REAL local subprocess service plus the fake
 * godot/gdformat CLI stub, exercised through `ctx.tools.execute()`. The stub
 * is a node script driven by `fake-godot-input.json` in the session cwd, so
 * every spawn path — validation, scene runs, formatting, editor scripts —
 * runs on every platform without a godot install. This suite carries the
 * coverage gate for the five tools' execute paths and the plugin config
 * validation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodot from '@deepseek-ai/dsh-tool-godot'

const FAKE = fileURLToPath(new URL('./fixtures/fake-godot.mjs', import.meta.url))
const testToolSignal = new AbortController().signal

let dir: string
let ctx: Context

let callCounter = 0
function call(name: string, args: unknown, agentObj?: object) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`it-${++callCounter}`),
    name,
    arguments: args,
    ...(agentObj ? { agent: agentObj as never } : {}),
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

/** The fixture workspace as a session cwd, so relative paths resolve inside `dir`. */
const agent = () => ({ session: { header: { id: 'session-godot', cwd: dir } } })

/** Drive the fake godot/gdformat stub for the next spawn in `dir`. */
async function fakeInput(input: {
  stdout?: string
  stderr?: string
  exit?: number
  gdformatOutput?: string
  delayMs?: number
  calls?: Array<{ stdout?: string; stderr?: string; exit?: number; gdformatOutput?: string; delayMs?: number }>
}): Promise<void> {
  await writeFile(join(dir, 'fake-godot-input.json'), JSON.stringify(input))
}

/** Build a minimal Godot project fixture. */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-godot-tools-'))
  await mkdir(join(root, 'scripts'), { recursive: true })
  await mkdir(join(root, 'scenes'), { recursive: true })
  await writeFile(join(root, 'project.godot'), [
    '; Engine configuration file.',
    'config_version=5',
    '',
    '[application]',
    '',
    'config/name="Fixture Game"',
    'run/main_scene="res://scenes/main.tscn"',
    '[autoload]',
    '',
    'Game="*res://scripts/game.gd"',
  ].join('\n'))
  await writeFile(join(root, 'scripts', 'main.gd'), 'extends Node\n\nfunc _ready():\n\tprint("hello")\n')
  await writeFile(join(root, 'scenes', 'main.tscn'), [
    '[gd_scene load_steps=2 format=3 uid="uid://abc"]',
    '',
    '[ext_resource type="Script" path="res://scripts/main.gd" id="1_x"]',
    '',
    '[node name="Main" type="Node"]',
    'script = ExtResource("1_x")',
    '',
    '[node name="Child" type="Node2D" parent="."]',
  ].join('\n'))
  return root
}

async function boot(overrides?: Record<string, unknown>): Promise<Context> {
  const context = new Context()
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  await context.plugin(LocalSubprocessRuntime)
  await context.plugin(ToolGodot, {
    executable: process.execPath,
    executableArgs: [FAKE],
    gdformatExecutable: process.execPath,
    gdformatArgs: [FAKE],
    ...overrides,
  })
  return context
}

describe('godot tools over the real subprocess service + the fake godot stub', () => {
  beforeEach(async () => {
    dir = await fixture()
    ctx = await boot()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('plugin config validation', () => {
    for (const [key, bad] of [
      ['stdoutMaxBytes', 0],
      ['stderrMaxBytes', 0],
      ['validateMaxErrors', 0],
      ['graceMs', 0],
      ['timeoutMs', 0],
    ] as const) {
      it(`rejects a ${key} of 0 at load time`, async () => {
        await expect(boot({ [key]: bad })).rejects.toThrow(/invalid config/)
      })
    }

    it('rejects a graceMs above the timer delay cap', async () => {
      await expect(boot({ graceMs: MAX_TIMER_DELAY_MS + 1 })).rejects.toThrow(/invalid config/)
    })
  })

  describe('godot_validate', () => {
    it('reports a clean project validation as ok', async () => {
      await fakeInput({})
      const result = await call('godot_validate', {}, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('passed')
      expect(result.meta).toMatchObject({ ok: true })
    })

    it('parses script errors into structured issues', async () => {
      await fakeInput({
        stderr: 'ERROR: Parse Error: Unexpected token\n   at: res://scripts/main.gd:12:5\nWARNING: Unused variable\n   at: res://scripts/main.gd:3:1\n',
      })
      const result = await call('godot_validate', {}, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('scripts/main.gd:12:5 [error] Parse Error: Unexpected token')
      const meta = result.meta as { ok: boolean; issues: Array<{ kind: string; path?: string; line?: number }> }
      expect(meta.ok).toBe(false)
      expect(meta.issues[0]).toMatchObject({ kind: 'error', path: 'scripts/main.gd', line: 12 })
      expect(meta.issues[1]).toMatchObject({ kind: 'warning', path: 'scripts/main.gd', line: 3 })
    })

    it('keeps warnings-only and location-less issues as domain outcomes', async () => {
      await fakeInput({ stderr: 'WARNING: Unused variable\n   at: res://scripts/main.gd:3:1\nERROR: Lost cause\n' })
      const result = await call('godot_validate', {}, agent())
      expect(result.isError).toBe(false)
      const output = text(result)
      expect(output).toContain('scripts/main.gd:3:1 [warning] Unused variable')
      // The location-less error keeps its message and renders without a path prefix.
      expect(output).toContain(' [error] Lost cause')
      expect(result.meta).toMatchObject({ ok: false })
    })

    it('treats a warnings-only run as ok', async () => {
      await fakeInput({ stderr: 'WARNING: Unused variable\n   at: res://scripts/main.gd:3:1\n' })
      const result = await call('godot_validate', {}, agent())
      expect(result.isError).toBe(false)
      expect(result.meta).toMatchObject({ ok: true })
      expect(text(result)).toContain('passed')
    })

    it('runs the GDScript sweep after the import pass in project mode', async () => {
      // Invocation 1 is the editor import pass (clean), invocation 2 the sweep;
      // the sweep's own RID-leak teardown chatter must not become an issue.
      await fakeInput({
        calls: [
          {},
          {
            exit: 1,
            stdout: "ERROR: 6 RID allocations of type 'Viewport' were leaked at exit.\n",
            stderr: 'SCRIPT ERROR: Parse Error: Expected grouping expression.\n   at: GDScript::reload (res://scripts/broken.gd:4)\n',
          },
        ],
      })
      const result = await call('godot_validate', {}, agent())
      expect(result.isError).toBe(false)
      const output = text(result)
      expect(output).toContain('failed (exit 1)')
      expect(output).toContain('scripts/broken.gd:4 [error] Parse Error: Expected grouping expression.')
      expect(output).not.toContain('leaked at exit')
    })

    it('surfaces the engine output of a failed run that parsed no issue', async () => {
      await fakeInput({ calls: [{ exit: 3221225477, stderr: 'editor settings could not be saved\n' }, {}] })
      const result = await call('godot_validate', {}, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('failed (exit 3221225477)')
      expect(text(result)).toContain('No issues reported.\neditor settings could not be saved')
    })

    it('validates a single file in file mode', async () => {
      await fakeInput({ stderr: 'ERROR: Bad\n   at: res://scripts/main.gd:1:1\n' })
      const result = await call('godot_validate', { path: join(dir, 'scripts', 'main.gd'), mode: 'file' }, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('Godot file validation at')
    })

    it('rejects file mode without a path', async () => {
      const result = await call('godot_validate', { mode: 'file' }, agent())
      expect(result.isError).toBe(true)
    })

    it('validates with an absolute project path and no session cwd', async () => {
      // The fake reads its input from the spawn cwd (the process cwd without
      // an agent) and, finding none, exits 0 silently: a clean pass.
      const result = await call('godot_validate', { path: dir })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('passed')
    })

    it('rejects a blank path', async () => {
      const result = await call('godot_validate', { path: ' ' }, agent())
      expect(result.isError).toBe(true)
    })

    it('classifies a missing executable as GODOT_UNAVAILABLE', async () => {
      const context = await boot({ executable: 'no-such-binary-xyz-123' })
      const result = await context.tools.execute({
        signal: testToolSignal,
        callId: ToolCallId('it-godot-unavailable'),
        name: 'godot_validate',
        arguments: {},
        agent: agent() as never,
      })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { name: 'GodotError', code: 'GODOT_UNAVAILABLE' } })
    })

    it('a pre-aborted registry call is ABORTED_BEFORE_DISPATCH', async () => {
      const controller = new AbortController()
      controller.abort()
      const result = await ctx.tools.execute({
        callId: ToolCallId('it-preaborted'),
        name: 'godot_validate',
        arguments: {},
        signal: controller.signal,
      })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } })
    })
  })

  describe('godot_run_scene', () => {
    it('runs a scene and returns the captured output', async () => {
      await fakeInput({ stdout: 'hello from scene\n' })
      const result = await call('godot_run_scene', { scene: 'res://scenes/main.tscn', frames: 5, args: ['--fast'] }, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('hello from scene')
      expect(text(result)).toContain('exited with code 0')
    })

    it('reports a non-zero exit as a domain outcome', async () => {
      await fakeInput({ exit: 2, stderr: 'boom\n' })
      const result = await call('godot_run_scene', { scene: 'res://scenes/main.tscn' }, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('exited with code 2')
      expect(text(result)).toContain('stderr:\nboom')
    })

    it('rejects a blank scene', async () => {
      const result = await call('godot_run_scene', { scene: ' ' }, agent())
      expect(result.isError).toBe(true)
    })

    it('runs with an explicit project path and no session cwd', async () => {
      const result = await call('godot_run_scene', { scene: 'res://scenes/main.tscn', path: dir })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('exited with code 0')
      expect(text(result)).toContain('(no output)')
    })
  })

  describe('godot_inspect', () => {
    it('inspects a project root', async () => {
      const result = await call('godot_inspect', { path: dir }, agent())
      expect(result.isError).toBe(false)
      const output = text(result)
      expect(output).toContain('Godot project at')
      expect(output).toContain('Name: Fixture Game')
      expect(output).toContain('Main scene: res://scenes/main.tscn')
      expect(output).toContain('Game = res://scripts/game.gd')
    })

    it('inspects a scene file', async () => {
      const result = await call('godot_inspect', { path: 'scenes/main.tscn' }, agent())
      expect(result.isError).toBe(false)
      const output = text(result)
      expect(output).toContain('Godot scene at')
      expect(output).toContain('1_x: Script res://scripts/main.gd')
      expect(output).toContain('Main type=Node')
      expect(output).toContain('Child type=Node2D parent=.')
    })

    it('classifies a missing target as GODOT_PARSE_ERROR', async () => {
      const result = await call('godot_inspect', { path: 'no-such' }, agent())
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'GODOT_PARSE_ERROR' } })
    })

    it('classifies an unsupported file type as GODOT_PARSE_ERROR', async () => {
      await writeFile(join(dir, 'notes.txt'), 'hello')
      const result = await call('godot_inspect', { path: 'notes.txt' }, agent())
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'GODOT_PARSE_ERROR' } })
    })

    it('inspects an absolute scene path with no session cwd', async () => {
      const result = await call('godot_inspect', { path: join(dir, 'scenes', 'main.tscn') })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('Main type=Node')
    })

    it('inspects a resource file', async () => {
      await writeFile(join(dir, 'scripts', 'data.tres'), [
        '[gd_resource type="Resource" load_steps=2 format=3]',
        '',
        '[ext_resource type="Script" path="res://scripts/main.gd" id="1_x"]',
        '',
        '[resource]',
        'script = ExtResource("1_x")',
      ].join('\n'))
      const result = await call('godot_inspect', { path: 'scripts/data.tres' }, agent())
      expect(result.isError).toBe(false)
      const output = text(result)
      expect(output).toContain('Godot resource at')
      expect(output).toContain('1_x: Script res://scripts/main.gd')
      expect(output).toContain('Sections: gd_resource, resource')
    })
  })

  describe('godot_format', () => {
    it('returns the formatted text and diff metadata when changed', async () => {
      await writeFile(join(dir, 'scripts', 'fmt.gd'), 'var a=1\n')
      await fakeInput({ gdformatOutput: 'var a = 1\n' })
      const result = await call('godot_format', { file: 'scripts/fmt.gd' }, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('(changed)')
      expect(result.meta).toMatchObject({ path: join('scripts', 'fmt.gd'), oldText: 'var a=1\n', newText: 'var a = 1\n' })
    })

    it('reports already-formatted files unchanged', async () => {
      await writeFile(join(dir, 'scripts', 'ok.gd'), 'var a = 1\n')
      await fakeInput({})
      const result = await call('godot_format', { file: 'scripts/ok.gd' }, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('already formatted')
    })

    it('classifies a missing file as GODOT_PARSE_ERROR', async () => {
      const result = await call('godot_format', { file: 'no-such.gd' }, agent())
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'GODOT_PARSE_ERROR' } })
    })

    it('classifies a formatter crash as GODOT_FORMAT_UNAVAILABLE', async () => {
      await writeFile(join(dir, 'scripts', 'crash.gd'), 'var a = 1\n')
      await fakeInput({ stderr: 'Traceback (most recent call last):\n  File "gdformat", line 1\n', exit: 1 })
      const result = await call('godot_format', { file: 'scripts/crash.gd' }, agent())
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'GODOT_FORMAT_UNAVAILABLE' } })
    })

    it('classifies a formatter rejection of the file as GODOT_PARSE_ERROR', async () => {
      await writeFile(join(dir, 'scripts', 'bad.gd'), 'var a = 1\n')
      await fakeInput({ stderr: 'Parse error: unexpected token\n', exit: 1 })
      const result = await call('godot_format', { file: 'scripts/bad.gd' }, agent())
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'GODOT_PARSE_ERROR' } })
    })

    it('formats an absolute path with no session cwd', async () => {
      await writeFile(join(dir, 'scripts', 'abs.gd'), 'var a = 1\n')
      // The fake reads its input from the spawn cwd (the process cwd without
      // an agent) and, finding none, leaves the temp copy untouched.
      const result = await call('godot_format', { file: join(dir, 'scripts', 'abs.gd') })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('already formatted')
    })
  })

  describe('godot_editor_script', () => {
    it('runs an EditorScript and returns its output', async () => {
      await fakeInput({ stdout: '{"ok":true,"count":3}\n' })
      const result = await call('godot_editor_script', { script: 'res://tools/check.gd', args: ['--deep'] }, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('{"ok":true,"count":3}')
      expect(text(result)).toContain('exited with code 0')
    })

    it('reports a non-zero exit as a domain outcome', async () => {
      await fakeInput({ exit: 4, stdout: 'check failed\n' })
      const result = await call('godot_editor_script', { script: 'res://tools/check.gd' }, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('exited with code 4')
    })

    it('surfaces the engine stderr when the run fails', async () => {
      await fakeInput({ exit: 1, stderr: 'ERROR: Failed to load script "res://tools/check.gd"\n' })
      const result = await call('godot_editor_script', { script: 'res://tools/check.gd' }, agent())
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('exited with code 1')
      expect(text(result)).toContain('stderr:\nERROR: Failed to load script')
    })

    it('rejects a non-res script path', async () => {
      const result = await call('godot_editor_script', { script: 'tools/check.gd' }, agent())
      expect(result.isError).toBe(true)
    })

    it('runs with an explicit project path and no session cwd', async () => {
      const result = await call('godot_editor_script', { script: 'res://tools/check.gd', path: dir })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('exited with code 0')
      expect(text(result)).toContain('(no output)')
    })
  })
})
