/**
 * Opt-in real smoke for the embedded Gomoku fixture.
 *
 * Gated by `DSH_TEST_GODOT` like the main smoke. It proves the fixture is a
 * normal clickable project: godot_find locates a board intersection,
 * godot_click places a stone, and godot_node/status observe the result.
 */

import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import * as ToolGodotEgo from '../src/index.ts'

const GODOT = process.env.DSH_TEST_GODOT
const PROJECT = fileURLToPath(new URL('./fixtures/gomoku', import.meta.url))

describe.skipIf(GODOT === undefined)('REAL smoke: Gomoku fixture', () => {
  it('starts the fixture, places a stone, reads it back, and resets', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(TimeoutPolicy)
    await ctx.plugin(ToolGodotEgo, Config({
      executable: GODOT,
      requestTimeoutMs: 20_000,
      importTimeoutMs: 120_000,
    }))
    let seq = 0
    const call = (name: string, args: unknown) => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: `gomoku-${++seq}` as never,
      name,
      arguments: args,
      agent: { session: { header: { cwd: PROJECT } } } as never,
    })
    const textOf = (result: { content: { type: string; text?: string }[] }) =>
      result.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('\n')

    try {
      const play = await call('godot_play', { path: PROJECT })
      expect(play.isError).toBe(false)

      const find = await call('godot_find', { name: 'Cell_07_07' })
      expect(find.isError).toBe(false)
      expect(textOf(find)).toContain('Cell_07_07')

      const cell = (row: number, col: number) =>
        `Main/BoardHits/Cell_${String(row).padStart(2, '0')}_${String(col).padStart(2, '0')}`
      for (const [row, col] of [[7, 7], [5, 5], [7, 8], [5, 6], [7, 9], [5, 7], [7, 10], [5, 8], [7, 11]] as const) {
        const click = await call('godot_click', { target: cell(row, col) })
        expect(click.isError).toBe(false)
      }

      const board = await call('godot_node', { path: '/root/Main', props: ['_moves', '_current', '_finished'] })
      expect(board.isError).toBe(false)
      expect(textOf(board)).toContain('_moves = 9')
      expect(textOf(board)).toContain('_finished = true')

      const name = await call('godot_node', { path: '/root/Main/StatusName', props: ['text'] })
      expect(textOf(name)).toContain('Black')
      const accent = await call('godot_node', { path: '/root/Main/StatusAccent', props: ['text'] })
      expect(textOf(accent)).toContain('wins')

      const reset = await call('godot_click', { target: 'Main/NewGame' })
      expect(reset.isError).toBe(false)
      const cleared = await call('godot_node', { path: '/root/Main', props: ['_moves', '_finished'] })
      expect(textOf(cleared)).toContain('_moves = 0')
      expect(textOf(cleared)).toContain('_finished = false')
    } finally {
      await call('godot_stop', {})
    }
  })
})
