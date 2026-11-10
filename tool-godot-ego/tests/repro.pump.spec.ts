/**
 * Repro hunt for the wedged bridge: an MJPEG-style `shot` pump (what the watch
 * panel does at 5 Hz) plus large `shot` requests on the same channel.
 *
 * Opt-in: `DSH_TEST_GODOT=<godot exe>`. On a stall it prints the game's own
 * trace (bridge `recv` / `run` / `done` / `send` / `SLOW` lines) so the last
 * command before the silence is visible.
 */

import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import * as ToolGodotEgo from '../src/index.ts'
import type { EgoSessionHandle } from '../src/session-service.ts'

const GODOT = process.env.DSH_TEST_GODOT
const PROJECT = fileURLToPath(new URL('./fixtures/gomoku', import.meta.url))

/** One tool call's settled result. */
function settle(batch: { results: readonly { result: ToolExecutionResult }[] }): ToolExecutionResult {
  const result = batch.results[0]?.result
  if (result === undefined) throw new Error('the tool batch settled no result')
  return result
}

describe.skipIf(GODOT === undefined)('REAL repro: bridge pump + large shot', () => {
  it('keeps answering while a 5 Hz shot pump runs', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(TimeoutPolicy)
    await ctx.plugin(ToolGodotEgo, Config({
      executable: GODOT as string,
      requestTimeoutMs: 10_000,
      importTimeoutMs: 120_000,
      trace: true,
    }))
    let seq = 0
    const session = () => (ctx.get('godot.egoSessions') as { list(): readonly EgoSessionHandle[] }).list()[0] as EgoSessionHandle
    const call = (name: string, args: unknown) => ctx.tools.execute({
      signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: ToolCallId(`pump-${++seq}`), name, arguments: JSON.stringify(args) }],
      agent: { session: { header: { cwd: PROJECT } } } as never,
    }).then(settle)

    const play = await call('godot_play', { path: PROJECT })
    expect(play.isError).toBe(false)
    const game = session()

    // The watch panel's stream: one small JPEG every 200 ms on the same channel.
    let pumpErrors = 0
    const pump = setInterval(() => {
      void game.request('shot', { format: 'jpg', maxWidth: 640, quality: 0.7 }).catch(() => { pumpErrors += 1 })
    }, 200)

    try {
      for (let round = 1; round <= 4; round += 1) {
        const shot = await game.request('shot', { format: 'png', maxWidth: 1280 })
        expect(shot.payload.bytes).toBeGreaterThan(0)
      }
      expect(pumpErrors).toBe(0)
    } finally {
      clearInterval(pump)
      const logs = game.logs?.(0, 8192)
      if (process.env.DSH_REPRO_LOGS === '1') {
        console.log('--- game stdout ---\n' + (logs?.stdout ?? ''))
        console.log('--- game stderr ---\n' + (logs?.stderr ?? ''))
      }
      await call('godot_stop', {})
    }
  }, 120_000)
})
