/**
 * Smoke tests against a REAL godot executable, self-skipping when none is
 * installed or runnable (mirroring the pwsh-local hasPwsh pattern). These
 * verify the tools against the actual CLI contract, not the fake stub; CI
 * hosts without godot skip the whole suite.
 */

import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodot from '@deepseek-ai/dsh-tool-godot'

const hasGodot = (() => {
  try {
    const probe = spawnSync('godot', ['--version'], { timeout: 15_000, encoding: 'utf8' })
    return probe.status === 0
  } catch {
    return false
  }
})()

const testToolSignal = new AbortController().signal

let dir: string
let ctx: Context
let callCounter = 0

function call(name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`smoke-${++callCounter}`),
    name,
    arguments: args,
    agent: { session: { header: { id: 'session-smoke', cwd: dir } } } as never,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe.skipIf(!hasGodot)('real godot smoke (skipped without a godot binary)', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-godot-smoke-'))
    await mkdir(join(dir, 'scripts'), { recursive: true })
    await writeFile(join(dir, 'project.godot'), 'config_version=5\n\n[application]\n\nconfig/name="Smoke"\n')
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(ToolGodot)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('validates a clean project as ok', async () => {
    await writeFile(join(dir, 'scripts', 'clean.gd'), 'extends Node\n\nfunc _ready():\n\tprint("ok")\n')
    const result = await call('godot_validate', {})
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('passed')
  })

  it('reports real parse errors in a broken script', async () => {
    await writeFile(join(dir, 'scripts', 'broken.gd'), 'extends Node\n\nfunc _ready():\n\tvar x = (\n')
    const result = await call('godot_validate', {})
    expect(result.isError).toBe(false)
    const output = text(result)
    expect(output).toContain('broken.gd')
    expect(output).toContain('[error]')
  })
})
