/**
 * The `tool-godot` entry through a real profile patch and Loader: a settings
 * write reaches the next tool call without remounting, and the schema refuses
 * values the resolved caps would misbehave on.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Hmr from '@deepseek-ai/dsh-hmr'
import Settings from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as ToolGodot from '@deepseek-ai/dsh-tool-godot'

const FAKE = fileURLToPath(new URL('./fixtures/fake-godot.mjs', import.meta.url))
const testToolSignal = new AbortController().signal
const ENTRY = 'tool-godot'

/** Boot a real profile whose `tool-godot` entry points at the fake executable. */
async function bootGodot(): Promise<{ ctx: Context; dir: string }> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'godot-settings-')))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'system-prompt', name: 'cordis:systemPrompt' },
    { id: 'tools', name: 'cordis:tools' },
    { id: 'subprocess', name: 'cordis:localSubprocess' },
    { id: ENTRY, name: 'cordis:godot', config: { executable: process.execPath, executableArgs: [FAKE] } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (context) => {
    context.provide('profileContext', profile)
    context.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(context.loader.builtins, {
      editor: ConfigEditor, settings: Settings, systemPrompt: SystemPrompt,
      tools: ToolRuntime, localSubprocess: LocalSubprocessRuntime, godot: ToolGodot,
    })
  })
  onTestFinished(async () => { await ctx.fiber.dispose(); rmSync(home, { recursive: true, force: true }) })
  await ctx.plugin(Timer)
  const hmr = ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  await hmr.await()
  await ctx.hmr.runExclusive(async () => {})
  return { ctx, dir }
}

/** The entry fiber the live-Config write must leave in place. */
function entryFiber(ctx: Context): unknown {
  return [...ctx.loader.entries()].find(entry => entry.options.id === ENTRY)?.fiber
}

let callCounter = 0

/** Run one `godot_validate` against the booted context. */
function validate(ctx: Context, dir: string) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`settings-${++callCounter}`),
    name: 'godot_validate',
    arguments: { path: dir },
    agent: { session: { header: { id: 'session-settings', cwd: dir } } } as never,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

it('applies a settings-written executable to the next call without remounting', async () => {
  const { ctx, dir } = await bootGodot()
  const fiber = entryFiber(ctx)
  expect(text(await validate(ctx, dir))).toContain('passed')

  // The live reference wins: a bogus executable fails the next call.
  await ctx.settings.update(ENTRY, { executable: 'no-such-godot-xyz' })
  const broken = await validate(ctx, dir)
  expect(broken.isError).toBe(true)
  expect(broken.error).toMatchObject({ info: { code: 'GODOT_UNAVAILABLE' } })
  expect(entryFiber(ctx)).toBe(fiber)

  // Writing the fake back restores service without any remount.
  await ctx.settings.update(ENTRY, { executable: process.execPath })
  expect(text(await validate(ctx, dir))).toContain('passed')
  expect(entryFiber(ctx)).toBe(fiber)
})

it('refuses non-volatile and schema-invalid writes', async () => {
  const { ctx, dir } = await bootGodot()
  await expect(ctx.settings.update(ENTRY, { executableArgs: [] })).rejects.toThrow()
  await expect(ctx.settings.update(ENTRY, { timeoutMs: 0 })).rejects.toThrow()
  // The rejected writes left the authoritative config unchanged.
  expect(text(await validate(ctx, dir))).toContain('passed')
})
