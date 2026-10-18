/**
 * C1 real smoke: the whole tool chain against a real Godot project.
 *
 * Gated by `DSH_TEST_GODOT` (the Godot executable path) so CI without an
 * engine skips it. It proves the shipped wiring — plugin mount, play, see,
 * state, node, logs, status, scene, actions, find, diff, wait_for, hover,
 * scroll, type, drag, click, stop, disposal — rather than the raw bridge.
 */

import { existsSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { afterAll, describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import * as ToolGodotEgo from '../src/index.ts'

const GODOT = process.env.DSH_TEST_GODOT
const PROJECT = 'D:/source_code/deepseek-harness/packages/godot/.context/ego-godot-spike'

describe.skipIf(GODOT === undefined).concurrent('REAL smoke: godot tool chain', () => {
  let seq = 0
  afterAll(() => { /* the engine process is owned by the session and disposed below */ })

  it('plays, observes, reads, operates, logs, and stops a real project', async () => {
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
    const call = (name: string, args: unknown) => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: `smoke-${++seq}` as never,
      name,
      arguments: args,
      agent: { session: { header: { cwd: PROJECT } } } as never,
    })
    const textOf = (result: { content: { type: string; text?: string }[] }) =>
      result.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('\n')
    try {
      expect(existsSync(PROJECT)).toBe(true)
      const play = await call('godot_play', { path: PROJECT })
      expect(play.isError).toBe(false)
      const played = play.value as { sessionId: string; running: boolean }
      expect(played.running).toBe(true)

      const see = await call('godot_see', {})
      expect(see.isError).toBe(false)
      expect(textOf(see)).toContain('frame')

      const state = await call('godot_state', {})
      expect(state.isError).toBe(false)
      expect(textOf(state)).toContain('Main')

      const node = await call('godot_node', { path: 'Btn', props: ['text'] })
      expect(node.isError).toBe(false)
      expect(textOf(node)).toContain('A0')

      const logs = await call('godot_logs', {})
      expect(logs.isError).toBe(false)

      const status = await call('godot_status', {})
      expect(status.isError).toBe(false)
      expect(textOf(status)).toContain('· ready')

      const scene = await call('godot_scene', {})
      expect(scene.isError).toBe(false)
      expect(textOf(scene)).toContain('res://main.tscn')

      const actions = await call('godot_actions', {})
      expect(actions.isError).toBe(false)

      const find = await call('godot_find', { class: 'Button' })
      expect(find.isError).toBe(false)
      expect(textOf(find)).toContain('Controls match')

      const diff = await call('godot_diff', {})
      expect(diff.isError).toBe(false)
      expect(textOf(diff)).toContain('mean')

      const waitFor = await call('godot_wait_for', { property: 'paused', equals: false })
      expect(waitFor.isError).toBe(false)

      const hover = await call('godot_hover', { x: 160, y: 120 })
      expect(hover.isError).toBe(false)

      const scroll = await call('godot_scroll', { x: 160, y: 120, delta: 1 })
      expect(scroll.isError).toBe(false)

      const type = await call('godot_type', { text: 'hi' })
      expect(type.isError).toBe(false)

      const drag = await call('godot_drag', { from: [100, 100], to: [200, 200], steps: 3 })
      expect(drag.isError).toBe(false)

      const checkOn = await call('godot_check', { target: 'Options' })
      expect(checkOn.isError).toBe(false)
      expect(checkOn.value).toMatchObject({ checked: true, changed: true })
      const checkOff = await call('godot_check', { target: 'Options', checked: false })
      expect(checkOff.isError).toBe(false)
      expect(checkOff.value).toMatchObject({ checked: false })

      const fill = await call('godot_fill', { target: 'NameInput', text: 'hello' })
      expect(fill.isError).toBe(false)
      expect(textOf(fill)).toContain('hello')
      const refill = await call('godot_fill', { target: 'NameInput', text: 'world' })
      expect(refill.isError).toBe(false)
      const filled = await call('godot_node', { path: 'NameInput', props: ['text'] })
      expect(filled.isError).toBe(false)
      expect(textOf(filled)).toContain('world')
      expect(textOf(filled)).not.toContain('helloworld')

      const appears = await call('godot_wait_for', { path: 'Btn', exists: true })
      expect(appears.isError).toBe(false)
      const absent = await call('godot_wait_for', { path: 'Missing', exists: false })
      expect(absent.isError).toBe(false)

      const hoverTarget = await call('godot_hover', { target: 'Btn' })
      expect(hoverTarget.isError).toBe(false)
      const scrollTarget = await call('godot_scroll', { target: 'Btn', delta: 1 })
      expect(scrollTarget.isError).toBe(false)

      const click = await call('godot_click', { x: 160, y: 120 })
      expect(click.isError).toBe(false)

      const stop = await call('godot_stop', {})
      expect(stop.isError).toBe(false)
      expect(stop.value).toMatchObject({ stopped: true })
    } finally {
      await ctx.fiber.dispose()
    }
  }, 120_000)
})
