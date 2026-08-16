/**
 * The `godot` settings section layered over the tool plugin's composition
 * entry: GUI-written values (executable paths, caps) become authoritative
 * for the next tool call without a reload, and fall back to the composition
 * entry when the settings provider detaches.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { GODOT_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-tool-godot'
import * as ToolGodot from '@deepseek-ai/dsh-tool-godot'

const FAKE = fileURLToPath(new URL('./fixtures/fake-godot.mjs', import.meta.url))
const testToolSignal = new AbortController().signal

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Boot the real godot tool stack with the fake executable and an optional settings provider. */
async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-godot-settings-'))
  await writeFile(join(dir, 'project.godot'), 'config_version=5\n')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(ToolGodot, { executable: process.execPath, executableArgs: [FAKE] })
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber, dir }
}

let callCounter = 0

/** Run one `godot_validate` against the booted context. */
function validate(ctx: Context, dir: string) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`settings-${++callCounter}`),
    name: 'godot_validate',
    arguments: { path: dir },
    agent: { session: { header: { id: 'session-settings', cwd: dir } } } as never,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('godot settings section', () => {
  afterEach(async () => {
    // Every bench tears its own fibers down inline; nothing to clean here.
  })

  it('applies a settings-written executable to the next call', async () => {
    const bench = await boot()
    try {
      // Composition entry is the fake node stub: a clean pass.
      const before = await validate(bench.ctx, bench.dir)
      expect(before.isError).toBe(false)
      expect(text(before)).toContain('passed')

      // The settings section wins: a bogus executable fails the next call.
      await bench.ctx.settings.update(GODOT_SETTINGS_NAMESPACE, { executable: 'no-such-godot-xyz' })
      const broken = await validate(bench.ctx, bench.dir)
      expect(broken.isError).toBe(true)
      expect(broken.error).toMatchObject({ info: { code: 'GODOT_UNAVAILABLE' } })

      // Writing the fake back restores service without any reload.
      await bench.ctx.settings.update(GODOT_SETTINGS_NAMESPACE, { executable: process.execPath, executableArgs: [FAKE] })
      const restored = await validate(bench.ctx, bench.dir)
      expect(restored.isError).toBe(false)
      expect(text(restored)).toContain('passed')
    } finally {
      await bench.ctx.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('refuses a stored value the constructor would have rejected', async () => {
    const bench = await boot()
    try {
      await expect(bench.ctx.settings.update(GODOT_SETTINGS_NAMESPACE, { timeoutMs: 0 }))
        .rejects.toThrow(/timeoutMs must be a positive integer/)
      await expect(bench.ctx.settings.update(GODOT_SETTINGS_NAMESPACE, { graceMs: Number.MAX_SAFE_INTEGER }))
        .rejects.toThrow(/graceMs must be no greater than/)
      // The rejected writes left the authoritative config unchanged.
      const result = await validate(bench.ctx, bench.dir)
      expect(result.isError).toBe(false)
    } finally {
      await bench.ctx.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    try {
      await bench.ctx.settings.update(GODOT_SETTINGS_NAMESPACE, { executable: 'no-such-godot-xyz' })
      expect((await validate(bench.ctx, bench.dir)).isError).toBe(true)

      await bench.settingsFiber.dispose()

      const result = await validate(bench.ctx, bench.dir)
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('passed')
    } finally {
      await bench.ctx.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-godot-settings-none-'))
    await writeFile(join(dir, 'project.godot'), 'config_version=5\n')
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(ToolGodot, { executable: process.execPath, executableArgs: [FAKE] }).await()

      const result = await validate(ctx, dir)
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('passed')
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    try {
      expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('godot')

      await bench.pluginFiber.dispose()

      expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('godot')
    } finally {
      await bench.ctx.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('attaches the namespace when the settings provider mounts later', async () => {
    // The composed Loader tree activates entries concurrently, so the
    // settings provider can register after this plugin's apply ran. The
    // event-driven attach must still register the namespace and make it
    // authoritative for the next call.
    const dir = await mkdtemp(join(tmpdir(), 'dsh-godot-settings-late-'))
    await writeFile(join(dir, 'project.godot'), 'config_version=5\n')
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalSubprocessRuntime)
      // ToolGodot first; the settings provider is mounted afterwards.
      await ctx.plugin(ToolGodot, { executable: process.execPath, executableArgs: [FAKE] }).await()

      const settingsFiber = ctx.plugin(MemorySettings)
      await settingsFiber.await()

      await vi.waitFor(() => {
        expect(ctx.settings.describe().map(row => String(row.ns))).toContain('godot')
      })

      // The late-attached section is authoritative: a bogus executable fails
      // the next call, proving the source switched away from the composition.
      await ctx.settings.update(GODOT_SETTINGS_NAMESPACE, { executable: 'no-such-godot-xyz' })
      const result = await validate(ctx, dir)
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'GODOT_UNAVAILABLE' } })
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
