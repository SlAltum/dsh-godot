/**
 * `godot_play` process side: spawn spec construction, the one-time import
 * pass, temp-script lifetime, and the tool projection. The game process is a
 * fake handle and the bridge is the in-process fake, so no Godot is needed.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { createPlayFactory, buildSpawnSpec, ensureImported, playTool, startSession } from '../src/play.ts'
import { GameSessionRegistry } from '../src/session-service.ts'
import type { EgoPlayOptions } from '../src/session-service.ts'
import { attachFakeBridge } from './fixtures/fake-bridge.ts'
import type { FakeBridge } from './fixtures/fake-bridge.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** A handle whose process outcome the test controls. */
function makeHandle(options: { exitCode?: number | null; stderrText?: string } = {}) {
  let settles = false
  let terminate = 0
  let resolveDone!: (outcome: SubprocessOutcome) => void
  let rejectDone!: (error: unknown) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  const handle: SubprocessHandle = {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: options.stderrText === undefined ? {} : {
      stderr: { readFrom: () => ({ text: options.stderrText as string, nextOffset: options.stderrText.length, lossy: false }) },
    },
    done,
    terminate: () => { terminate += 1 },
    waitForExit: () => Promise.resolve(true),
  }
  return {
    handle,
    get terminated(): number { return terminate },
    settleNow(): void {
      if (settles) return
      settles = true
      resolveDone({ exitCode: options.exitCode ?? 0, signal: null })
    },
    fail(error: unknown): void {
      if (settles) return
      settles = true
      rejectDone(error)
    },
  }
}

/** A project directory; `imported` decides whether `.godot` already exists. */
async function makeProject(imported: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ego-play-'))
  tempDirs.push(root)
  await writeFile(join(root, 'project.godot'), 'config_version=5\n', 'utf8')
  if (imported) await mkdir(join(root, '.godot'))
  return root
}

describe('buildSpawnSpec', () => {
  const base = {
    executable: { executable: 'godot', args: ['--wrapper'] },
    projectRoot: 'C:/project',
    bootPath: 'C:/tmp/boot.gd',
    bridgePath: 'C:/tmp/bridge.gd',
    port: 1234,
    token: 'tok',
    allowEval: false,
    offscreen: false,
    maxFps: 60,
    fixedFps: 0,
    graceMs: 5000,
  } as const

  it('builds the windowed argv and the env handshake', () => {
    const spec = buildSpawnSpec({ ...base })
    expect(spec.argv).toEqual([
      'godot', '--wrapper',
      '--path', 'C:/project',
      '--script', 'C:/tmp/boot.gd',
      '--windowed',
      '--resolution', '1280x720',
      '--max-fps', '60',
    ])
    expect(spec.cwd).toBe('C:/project')
    expect(spec.env).toEqual({
      DSH_EGO_PORT: '1234',
      DSH_EGO_TOKEN: 'tok',
      DSH_EGO_BRIDGE: 'C:/tmp/bridge.gd',
      DSH_EGO_SCENE: '',
      DSH_EGO_ALLOW_EVAL: '0',
    })
  })

  it('passes a scene override through the environment', () => {
    const spec = buildSpawnSpec({ ...base, scene: 'res://levels/test.tscn' })
    expect(spec.env?.DSH_EGO_SCENE).toBe('res://levels/test.tscn')
    expect(spec.argv.join(' ')).not.toContain('res://levels/test.tscn')
  })

  it('adds the off-screen position and prefers fixed fps', () => {
    const spec = buildSpawnSpec({ ...base, offscreen: true, fixedFps: 30, allowEval: true })
    expect(spec.argv).toContain('--position')
    expect(spec.argv).toContain('-32000,-32000')
    expect(spec.argv).toContain('--fixed-fps')
    expect(spec.argv).not.toContain('--max-fps')
    expect(spec.env?.DSH_EGO_ALLOW_EVAL).toBe('1')
  })

  it('omits the frame flags at zero', () => {
    const spec = buildSpawnSpec({ ...base, maxFps: 0 })
    expect(spec.argv).not.toContain('--max-fps')
    expect(spec.argv).not.toContain('--fixed-fps')
  })
})

describe('ensureImported', () => {
  it('skips the import when the .godot cache exists', async () => {
    const root = await makeProject(true)
    const spawned: SubprocessSpawnSpec[] = []
    const ctx = {
      subprocess: {
        spawn: (spec: SubprocessSpawnSpec) => { spawned.push(spec); return makeHandle().handle },
      },
    } as unknown as Context
    await expect(ensureImported(ctx, { executable: 'godot', args: [] }, root, 1000, 100)).resolves.toBe(false)
    expect(spawned).toHaveLength(0)
  })

  it('runs the import pass when the cache is missing', async () => {
    const root = await makeProject(false)
    const calls: SubprocessSpawnSpec[] = []
    const ctx = {
      subprocess: {
        spawn: (spec: SubprocessSpawnSpec) => {
          calls.push(spec)
          const h = makeHandle({ exitCode: 0 })
          queueMicrotask(() => { h.settleNow() })
          return h.handle
        },
      },
    } as unknown as Context
    await expect(ensureImported(ctx, { executable: 'godot', args: [] }, root, 1000, 100)).resolves.toBe(true)
    expect(calls[0]?.argv).toEqual(['godot', '--headless', '--editor', '--path', root, '--import'])
  })

  it('reports a non-zero import with its stderr tail', async () => {
    const root = await makeProject(false)
    const ctx = {
      subprocess: {
        spawn: () => {
          const h = makeHandle({ exitCode: 3, stderrText: 'scene import failed' })
          queueMicrotask(() => { h.settleNow() })
          return h.handle
        },
      },
    } as unknown as Context
    await expect(ensureImported(ctx, { executable: 'godot', args: [] }, root, 1000, 100))
      .rejects.toMatchObject({ code: 'GODOT_EGO_NOT_IMPORTED' })
    await expect(ensureImported(ctx, { executable: 'godot', args: [] }, root, 1000, 100))
      .rejects.toThrow(/scene import failed/)
  })

  it('reports a non-zero import without a stderr tail', async () => {
    const root = await makeProject(false)
    const ctx = {
      subprocess: {
        spawn: () => {
          const h = makeHandle({ exitCode: 1 })
          queueMicrotask(() => { h.settleNow() })
          return h.handle
        },
      },
    } as unknown as Context
    await expect(ensureImported(ctx, { executable: 'godot', args: [] }, root, 1000, 100))
      .rejects.toThrow(/code 1$/)
  })

  it('times out and terminates the import pass', async () => {
    const root = await makeProject(false)
    let terminated = 0
    const h = makeHandle()
    const ctx = {
      subprocess: {
        spawn: () => {
          return {
            ...h.handle,
            terminate: () => { terminated += 1 },
          }
        },
      },
    } as unknown as Context
    await expect(ensureImported(ctx, { executable: 'godot', args: [] }, root, 30, 100))
      .rejects.toMatchObject({ code: 'GODOT_EGO_TIMEOUT' })
    expect(terminated).toBe(1)
  })

  it('reports a spawn failure and a rejected process promise', async () => {
    const root = await makeProject(false)
    const throwing = { subprocess: { spawn: () => { throw new Error('spawn EPERM') } } } as unknown as Context
    await expect(ensureImported(throwing, { executable: 'godot', args: [] }, root, 1000, 100))
      .rejects.toMatchObject({ code: 'GODOT_EGO_NOT_IMPORTED' })

    const rejecting = {
      subprocess: {
        spawn: () => {
          const h = makeHandle()
          queueMicrotask(() => { h.fail(new Error('exec failed')) })
          return h.handle
        },
      },
    } as unknown as Context
    await expect(ensureImported(rejecting, { executable: 'godot', args: [] }, root, 1000, 100))
      .rejects.toMatchObject({ code: 'GODOT_EGO_NOT_IMPORTED' })
  })
})

describe('startSession', () => {
  it('launches the game, reports the handshake, and removes its temp scripts on dispose', async () => {
    const root = await makeProject(true)
    const calls: SubprocessSpawnSpec[] = []
    let bridge: FakeBridge | undefined
    const ctx = {
      subprocess: {
        spawn: (spec: SubprocessSpawnSpec) => {
          calls.push(spec)
          const port = Number(spec.env?.DSH_EGO_PORT)
          const token = String(spec.env?.DSH_EGO_TOKEN)
          bridge = attachFakeBridge(port, {
            token,
            pid: 4321,
            reply: command => (command.cmd === 'quit' || command.cmd === 'ping' ? { ok: true } : undefined),
          })
          return makeHandle({ exitCode: 0 }).handle
        },
      },
    } as unknown as Context
    const config = resolveConfig({})
    const handle = await createPlayFactory(ctx, config)(root, { offscreen: true, maxFps: 30, scene: 'res://levels/test.tscn' })

    expect(handle.imported).toBe(false)
    expect(handle.projectRoot).toBe(root)
    expect(handle.pid).toBe(4321)
    expect(handle.snapshot?.()).toMatchObject({ sessionId: handle.sessionId, state: 'ready', pid: 4321 })
    const spec = calls[0] as SubprocessSpawnSpec
    expect(spec.argv).toContain('--position')
    expect(spec.argv).toContain('--max-fps')
    expect(spec.env?.DSH_EGO_SCENE).toBe('res://levels/test.tscn')
    const scriptDir = dirname(String(spec.env?.DSH_EGO_BRIDGE))
    expect(existsSync(join(scriptDir, 'bridge.gd'))).toBe(true)
    await expect(handle.request('ping')).resolves.toMatchObject({ kind: 'ok' })
    expect(handle.logs?.()).toEqual({ stdout: '', stderr: '', nextOffset: 0 })

    const stopped = await handle.stop?.()
    expect(stopped).toEqual({ exitCode: null, signal: null })
    expect(existsSync(scriptDir)).toBe(false)
    await handle.dispose()
    expect(existsSync(scriptDir)).toBe(false)
    expect(bridge).toBeDefined()
  })

  it('removes the temp scripts when the launch fails', async () => {
    const root = await makeProject(true)
    const scripts: string[] = []
    const ctx = {
      subprocess: {
        spawn: (spec: SubprocessSpawnSpec) => {
          scripts.push(dirname(String(spec.env?.DSH_EGO_BRIDGE)))
          const port = Number(spec.env?.DSH_EGO_PORT)
          attachFakeBridge(port, { token: 'wrong-token' })
          return makeHandle().handle
        },
      },
    } as unknown as Context
    await expect(startSession(ctx, resolveConfig({ requestTimeoutMs: 100 }), root, {}))
      .rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    expect(scripts.length).toBe(1)
    expect(existsSync(scripts[0] as string)).toBe(false)
  })
})

describe('playTool', () => {
  it('projects the ensure result and renders it', async () => {
    const registry = new GameSessionRegistry(async workspace => ({
      sessionId: 'sess-1',
      workspace,
      pid: 7,
      dispose: async () => {},
    }))
    const tool = playTool(registry)
    const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }
    const value = await tool.execute({ offscreen: true, restart: true }, exec as never)
    expect(value).toEqual({ sessionId: 'sess-1', pid: 7, created: true, running: true })
    const rendered = tool.output.render({}, value)
    expect(rendered[0]).toMatchObject({ type: 'text' })
    if (rendered[0]?.type !== 'text') throw new Error('expected a text block')
    expect(rendered[0].text).toContain('session sess-1 is running')
    expect(rendered[0].text).toContain('pid 7')

    const reused = await tool.execute({}, exec as never)
    expect(reused.created).toBe(false)
    const reusedRender = tool.output.render({}, reused)
    if (reusedRender[0]?.type !== 'text') throw new Error('expected a text block')
    expect(reusedRender[0].text).toContain('reused')
    const explicit = await tool.execute({ path: '/ws', maxFps: 30, fixedFps: 0 }, exec as never)
    expect(explicit.sessionId).toBe('sess-1')
  })

  it('omits the pid when the session does not report one', async () => {
    const registry = new GameSessionRegistry(async workspace => ({
      sessionId: 'sess-2',
      workspace,
      pid: null,
      dispose: async () => {},
    }))
    const tool = playTool(registry)
    const exec = { agent: undefined, signal: new AbortController().signal }
    const value = await tool.execute({}, exec as never)
    expect(value).not.toHaveProperty('pid')
    const rendered = tool.output.render({}, value)
    if (rendered[0]?.type !== 'text') throw new Error('expected a text block')
    expect(rendered[0].text).not.toContain('pid')
  })

  it('forwards the scene override to the session factory', async () => {
    const seen: EgoPlayOptions[] = []
    const registry = new GameSessionRegistry(async (workspace, options) => {
      seen.push(options)
      return { sessionId: 'sess-3', workspace, pid: null, dispose: async () => {} }
    })
    const tool = playTool(registry)
    const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }
    await tool.execute({ scene: 'res://levels/test.tscn' }, exec as never)
    expect(seen[0]).toMatchObject({ scene: 'res://levels/test.tscn' })
  })
})
