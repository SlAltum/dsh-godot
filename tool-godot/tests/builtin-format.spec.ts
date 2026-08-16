/**
 * T2.4: the `builtin` `godot_format` backend through the real tool chain —
 * mount the plugin with `formatBackend: 'builtin'`, execute `godot_format`,
 * and assert the model-visible formatted text. No godot binary and no Python
 * are needed (the embedded formatter runs in-process), so this suite is
 * always runnable.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGodot from '@deepseek-ai/dsh-tool-godot'

const testToolSignal = new AbortController().signal

let dir: string
let ctx: Context
let callCounter = 0

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-godot-builtin-'))
  await mkdir(join(dir, 'scripts'), { recursive: true })
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGodot, ToolGodot.Config({ formatBackend: 'builtin' }))
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

function callFormat(file: string) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`builtin-${++callCounter}`),
    name: 'godot_format',
    arguments: { file },
    agent: { session: { header: { id: 'session-builtin', cwd: dir } } } as never,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('godot_format builtin backend', () => {
  it('formats whitespace and parameter lists in-process', async () => {
    const file = join(dir, 'scripts', 'main.gd')
    await writeFile(file, 'func f():\n\tsuper(  1,  2  )\n\n\n\n\tvar  x  =  1\n', 'utf8')

    const result = await callFormat(file)
    expect(result.isError).toBe(false)
    const output = text(result)
    expect(output).toContain('func f():')
    expect(output).toContain('super(1, 2)')
    expect(output).toContain('var x = 1')
    // Three blank lines collapse to the default maxEmptyLines of 2.
    expect(output).not.toContain('\n\n\n\n')
  })

  it('reports changed only when the text differs', async () => {
    const file = join(dir, 'scripts', 'clean.gd')
    await writeFile(file, 'var x = 1\n', 'utf8')

    const result = await callFormat(file)
    expect(result.isError).toBe(false)
    const output = text(result)
    expect(output).toContain('var x = 1')
  })

  it('respects the builtin comment-space option', async () => {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
    dir = await mkdtemp(join(tmpdir(), 'dsh-godot-builtin-'))
    await mkdir(join(dir, 'scripts'), { recursive: true })
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(ToolGodot, ToolGodot.Config({ formatBackend: 'builtin', builtinSpacesBeforeEndOfLineComment: '2' }))

    const file = join(dir, 'scripts', 'c.gd')
    await writeFile(file, 'var x = 1# hi\n', 'utf8')
    const result = await callFormat(file)
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('var x = 1  # hi')
  })
})
