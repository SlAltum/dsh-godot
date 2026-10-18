/**
 * Spatiotemporal composability invariants (plan §3.4, task A7):
 *
 * 1. recovery exactness — disposal is idempotent, leaves no sessions, and runs
 *    one inverse per created session;
 * 2. ordering — the sweep runs in reverse creation order and a failing
 *    inverse does not stop the rest;
 * 3. resolution coherence — a failed creation leaves no entry, and a
 *    concurrent `ensure` creates exactly one session;
 * 4. confluence — after disposal a fresh registry behaves like a new one;
 * 5. reactive replacement — disposing the plugin fiber disposes its sessions
 *    and unprovides the service.
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import type { EgoConfig } from '../src/config.ts'
import { apply, applyWith } from '../src/index.ts'
import { GameSessionRegistry } from '../src/session-service.ts'
import type { EgoSessionFactory, EgoSessionHandle } from '../src/session-service.ts'

/** A handle whose inverse appends its id to `log` (and may throw). */
function handle(
  sessionId: string,
  workspace: string,
  log: string[],
  fail = false,
): EgoSessionHandle {
  return {
    sessionId,
    workspace,
    pid: 100,
    dispose: async () => {
      log.push(sessionId)
      if (fail) throw new Error(`dispose failed: ${sessionId}`)
    },
    request: async () => ({ kind: 'ok', id: 1, payload: {} }),
  }
}

/** A factory handing out deterministic ids and recording creations. */
function factoryOf(log: string[], ids: readonly string[], failFirst = false): EgoSessionFactory {
  let call = 0
  return async (workspace) => {
    if (failFirst && call === 0) {
      call += 1
      throw new Error('creation failed')
    }
    const id = ids[call] ?? `s${call}`
    call += 1
    return handle(id, workspace, log)
  }
}

describe('GameSessionRegistry', () => {
  it('creates once under concurrent ensure (resolution coherence)', async () => {
    const log: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    const registry = new GameSessionRegistry(async (workspace) => {
      calls += 1
      await gate
      return handle('s1', workspace, log)
    })

    const first = registry.ensure('/ws', {})
    const second = registry.ensure('/ws', {})
    release()
    const [a, b] = await Promise.all([first, second])

    expect(calls).toBe(1)
    expect(a.created).toBe(true)
    expect(b.created).toBe(false)
    expect(a.sessionId).toBe('s1')
    expect(registry.list()).toHaveLength(1)
  })

  it('reuses an existing session and replaces it on restart', async () => {
    const log: string[] = []
    const registry = new GameSessionRegistry(factoryOf(log, ['s1', 's2']))

    const first = await registry.ensure('/ws', {})
    const reused = await registry.ensure('/ws', {})
    expect(first.created).toBe(true)
    expect(reused.created).toBe(false)
    expect(reused.sessionId).toBe('s1')

    const replaced = await registry.ensure('/ws', { restart: true })
    expect(replaced.created).toBe(true)
    expect(replaced.sessionId).toBe('s2')
    // The old session's inverse ran BEFORE the replacement was created.
    expect(log).toEqual(['s1'])
    expect(registry.get('/ws')?.sessionId).toBe('s2')
  })

  it('leaves no entry when creation fails, and recovers afterwards', async () => {
    const log: string[] = []
    const registry = new GameSessionRegistry(factoryOf(log, ['s1'], true))

    await expect(registry.ensure('/ws', {})).rejects.toThrow('creation failed')
    expect(registry.get('/ws')).toBeUndefined()
    expect(registry.list()).toHaveLength(0)

    const recovered = await registry.ensure('/ws', {})
    expect(recovered.created).toBe(true)
  })

  it('disposes in reverse creation order and isolates failures', async () => {
    const log: string[] = []
    const registry = new GameSessionRegistry(async workspace => handle(workspace, workspace, log, workspace === 'a'))
    await registry.ensure('a', {})
    await registry.ensure('b', {})

    await registry.disposeAll()

    expect(log).toEqual(['b', 'a'])
    expect(registry.disposed).toBe(true)
    expect(registry.list()).toHaveLength(0)
    expect(registry.disposeFailures.map(f => f.workspace)).toEqual(['a'])
  })

  it('is idempotent and rejects use after disposal', async () => {
    const log: string[] = []
    const registry = new GameSessionRegistry(factoryOf(log, ['s1']))
    await registry.ensure('/ws', {})

    await registry.disposeAll()
    await registry.disposeAll()
    expect(log).toEqual(['s1'])
    expect(registry.get('/ws')).toBeUndefined()
    await expect(registry.ensure('/ws', {})).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
  })
})

describe('plugin composition', () => {
  it('provides the registry and disposes sessions when the fiber goes away', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    const log: string[] = []
    const factory: EgoSessionFactory = async workspace => handle('s1', workspace, log)
    const plugin = {
      name: 'tool-godot-ego-test',
      inject: ['subprocess'],
      apply: (child: Context, config: EgoConfig) => { applyWith(child, config, { factory }) },
    }
    await ctx.plugin(plugin as never, Config({}))

    const registry = ctx.get('godot.egoSessions') as GameSessionRegistry | undefined
    expect(registry).toBeInstanceOf(GameSessionRegistry)
    const started = await registry!.ensure('/ws', {})
    expect(started.created).toBe(true)

    await ctx.fiber.dispose()

    expect(log).toEqual(['s1'])
    expect(ctx.get('godot.egoSessions')).toBeUndefined()
  })
})

describe('plugin entry (default wiring)', () => {
  it('validates config and provides the registry with the default factory', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    apply(ctx)
    expect(ctx.get('godot.egoSessions')).toBeInstanceOf(GameSessionRegistry)
    await ctx.fiber.dispose()
    expect(ctx.get('godot.egoSessions')).toBeUndefined()
  })

  it('unloads and disposes sessions when a required provider goes away', async () => {
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const log: string[] = []
    const factory: EgoSessionFactory = async workspace => handle('s1', workspace, log)
    const plugin = {
      name: 'tool-godot-ego-test',
      inject: ['subprocess'],
      apply: (child: Context, config: EgoConfig) => { applyWith(child, config, { factory }) },
    }
    await ctx.plugin(plugin as never, Config({}))
    const registry = ctx.get('godot.egoSessions') as GameSessionRegistry
    await registry.ensure('/ws', {})

    // Reactive coeffect: the provider disappears, so the dependent unloads and
    // its sessions' inverses run.
    await subprocessFiber.dispose()

    expect(log).toEqual(['s1'])
    expect(ctx.get('godot.egoSessions')).toBeUndefined()
  })
})

describe('disposal racing creation', () => {
  it('disposes the late session and rejects the caller', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const log: string[] = []
    const registry = new GameSessionRegistry(async (workspace) => {
      await gate
      return handle('s1', workspace, log)
    })
    const pending = registry.ensure('/ws', {})
    await registry.disposeAll()
    expect(registry.disposed).toBe(true)
    release()
    await expect(pending).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    expect(log).toEqual(['s1'])
  })

  it('restart on an empty workspace still creates a session', async () => {
    const log: string[] = []
    const registry = new GameSessionRegistry(factoryOf(log, ['s1']))
    const started = await registry.ensure('/ws', { restart: true })
    expect(started.created).toBe(true)
    expect(registry.get('/ws')?.sessionId).toBe('s1')
  })
})

describe('plugin tool registration', () => {
  it('registers godot_play and runs it through the tool runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(TimeoutPolicy)
    const factory: EgoSessionFactory = async workspace => ({
      sessionId: 's-tool',
      workspace,
      pid: 5,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })
    const plugin = {
      name: 'tool-godot-ego-tools',
      inject: ['subprocess'],
      apply: (child: Context, config: EgoConfig) => { applyWith(child, config, { factory }) },
    }
    await ctx.plugin(plugin as never, Config({}))

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'tool-1' as never,
      name: 'godot_play',
      arguments: {},
      agent: { session: { header: { cwd: '/ws' } } } as never,
    })
    expect(result.isError).toBe(false)
    const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(text).toContain('session s-tool is running')
    await ctx.fiber.dispose()
  })

  it('registers the viewer route when a web server is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    let registered = 0
    ctx.provide('webServer', { register: () => { registered += 1; return () => {} } } as never)
    const factory: EgoSessionFactory = async workspace => ({
      sessionId: 's-view',
      workspace,
      pid: 3,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })
    const plugin = {
      name: 'tool-godot-ego-view',
      inject: ['subprocess'],
      apply: (child: Context, config: EgoConfig) => { applyWith(child, config, { factory }) },
    }
    await ctx.plugin(plugin as never, Config({}))
    expect(registered).toBe(3)
    await ctx.fiber.dispose()
  })

  it('registers godot_eval only when allowEval is on', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(TimeoutPolicy)
    const factory: EgoSessionFactory = async workspace => ({
      sessionId: 's-eval',
      workspace,
      pid: 2,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: { value: 3, type: 'int' } }),
    })
    const plugin = {
      name: 'tool-godot-ego-eval',
      inject: ['subprocess'],
      apply: (child: Context, config: EgoConfig) => { applyWith(child, config, { factory }) },
    }
    await ctx.plugin(plugin as never, Config({ allowEval: true }))
    const registry = ctx.get('godot.egoSessions') as GameSessionRegistry
    await registry.ensure('/ws', {})
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'tool-2' as never,
      name: 'godot_eval',
      arguments: { expression: '1 + 2' },
      agent: { session: { header: { cwd: '/ws' } } } as never,
    })
    expect(result.isError).toBe(false)
    await ctx.fiber.dispose()
  })
})
