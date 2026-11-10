/**
 * The route is wired through `ctx.inject(['webServer'])`, which the unit test
 * cannot see: this file mounts the real plugin in a real Context and checks
 * that the endpoints appear exactly when a web server is mounted.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { Config } from '../src/index.ts'
import * as ToolGodotDebug from '../src/index.ts'

/** A host with the services the debugger row needs, plus an optional web server. */
async function host(withWebServer: boolean): Promise<{ ctx: Context, routes: { path: string }[] }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(TimeoutPolicy)
  const routes: { path: string }[] = []
  if (withWebServer) {
    ctx.provide('webServer', {
      register: (route: { path: string }) => { routes.push(route); return () => {} },
    })
  }
  await ctx.plugin(ToolGodotDebug, Config({}))
  return { ctx, routes }
}

describe('debug session route wiring', () => {
  it('registers the session endpoints when a web server is mounted', async () => {
    const { ctx, routes } = await host(true)
    expect(routes.map(route => route.path)).toContain('/api/godot/debug')
    await ctx.fiber.dispose()
  })

  it('mounts without a web server and still registers the tools', async () => {
    const { ctx, routes } = await host(false)
    expect(routes).toEqual([])
    // The panel is chrome; the session service and the tools do not depend on it.
    expect(ctx.get('godot.debugSession')).toBeDefined()
    await ctx.fiber.dispose()
  })
})
