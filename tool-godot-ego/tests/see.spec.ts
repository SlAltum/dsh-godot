/**
 * `godot_see`: tiered frame delivery through the attachment store, the vision
 * route gate, the deployment limits, and the temp-file fallback.
 */

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { GameSessionRegistry } from '../src/session-service.ts'
import type { EgoSessionHandle } from '../src/session-service.ts'
import { seeTool } from '../src/see.ts'

const exec = {
  agent: {
    session: {
      header: { cwd: '/ws' },
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
    },
    options: {},
  },
  signal: new AbortController().signal,
}

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { force: true })))
})

/** Base64 of a tiny payload; the content does not matter to the tool. */
const DATA = Buffer.from('fake-image-bytes').toString('base64')

interface SessionOptions {
  readonly data?: string
  readonly frame?: number
  readonly width?: number
  readonly height?: number
  readonly bytes?: number
  /** Engine-reported mean pixel difference against the previous capture (-1 = none). */
  readonly meanDiff?: number
}

function sessionWith(options: SessionOptions = {}): EgoSessionHandle & { request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async () => ({
    kind: 'ok' as const,
    id: 1,
    payload: {
      data: options.data ?? DATA,
      frame: options.frame ?? 7,
      size: [options.width ?? 320, options.height ?? 200],
      bytes: options.bytes ?? Buffer.byteLength(DATA, 'base64'),
      meanDiff: options.meanDiff ?? -1,
    },
  }))
  const session: EgoSessionHandle & { request: ReturnType<typeof vi.fn> } = {
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request,
  }
  return session
}

async function registryWith(session: EgoSessionHandle): Promise<GameSessionRegistry> {
  const registry = new GameSessionRegistry(async () => session)
  await registry.ensure('/ws', {})
  return registry
}

async function registryWithRequest(request: EgoSessionHandle['request']): Promise<GameSessionRegistry> {
  const registry = new GameSessionRegistry(async () => ({
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request,
  }))
  await registry.ensure('/ws', {})
  return registry
}

function contextWith(options: {
  attachments?: unknown
  llm?: unknown
} = {}): Context {
  return {
    get: (name: string) => {
      if (name === 'attachments') return options.attachments
      if (name === 'llm') return options.llm
      return undefined
    },
  } as unknown as Context
}

function attachmentStore(options: {
  mediaTypes?: string[]
  maxImageBytes?: number
} = {}) {
  return {
    imageLimits: {
      mediaTypes: options.mediaTypes ?? ['image/png', 'image/jpeg', 'image/webp'],
      maxImageBytes: options.maxImageBytes ?? 1_000_000,
      maxMessageImageBytes: 2_000_000,
      maxImageDimension: 8192,
      maxImagePixels: 64_000_000,
    },
    saveImage: vi.fn(async (input: { data: Uint8Array; mediaType: string; name: string }) => ({
      attachmentId: 'att-1',
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 320,
      height: 200,
      name: input.name,
    })),
  }
}

const visionLlm = (inputModalities: string[] | undefined) => ({
  resolveModelInfo: async () => ({ inputModalities }),
})

describe('godot_see', () => {
  it('attaches the frame when store, vision route, and limits all allow it', async () => {
    const session = sessionWith()
    const store = attachmentStore()
    const tool = seeTool(contextWith({ attachments: store, llm: visionLlm(['image']) }), await registryWith(session), resolveConfig({}))
    await tool.execute({}, exec as never) // first capture seeds the frame cache
    const value = await tool.execute({ format: 'png', quality: 0.9, maxWidth: 640, target: 'Main/Btn' }, exec as never)
    expect(value).toMatchObject({ frame: 7, width: 320, height: 200, image: { attachmentId: 'att-1', mediaType: 'image/png' } })
    expect(store.saveImage).toHaveBeenCalledTimes(2)
    expect(session.request).toHaveBeenCalledWith('shot', { format: 'webp', maxWidth: 1280 }, exec.signal)
    const blocks = tool.output.render({}, value)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'text' })
    expect(blocks[1]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-1' } })
  })

  it('skips an unchanged frame only when asked, judged by pixels', async () => {
    // Frame numbers always advance; only the pixel difference can say the
    // picture did not change. The engine reports it as `meanDiff`.
    const session = sessionWith({ frame: 3, meanDiff: 0 })
    const store = attachmentStore()
    const tool = seeTool(contextWith({ attachments: store, llm: visionLlm(['image']) }), await registryWith(session), resolveConfig({}))
    const first = await tool.execute({}, exec as never)
    expect(first.changed).toBe(false)
    expect(first.meanDiff).toBe(0)
    const skipped = await tool.execute({ ifUnchanged: 'skip' }, exec as never)
    expect(skipped.note).toContain('unchanged')
    expect(skipped.image).toBeUndefined()
    const resent = await tool.execute({}, exec as never)
    expect(resent.image).toBeDefined()
  })

  it('reports a changed frame even when the frame number repeats', async () => {
    const session = sessionWith({ frame: 9, meanDiff: 12.5 })
    const tool = seeTool(contextWith({ attachments: attachmentStore(), llm: visionLlm(['image']) }), await registryWith(session), resolveConfig({}))
    const value = await tool.execute({ ifUnchanged: 'skip' }, exec as never)
    expect(value).toMatchObject({ changed: true, meanDiff: 12.5 })
    expect(value.image).toBeDefined()
    expect(value.note).toBeUndefined()
  })

  it('falls back to a temp file for each refusal reason', async () => {
    const base = resolveConfig({})
    const cases: Array<{ ctx: Context; reason: RegExp }> = [
      { ctx: contextWith({}), reason: /no attachment store/ },
      { ctx: contextWith({ attachments: attachmentStore(), llm: visionLlm(['text']) }), reason: /does not declare image input/ },
      { ctx: contextWith({ attachments: attachmentStore({ mediaTypes: ['image/png'] }), llm: visionLlm(['image']) }), reason: /not accepted/ },
      { ctx: contextWith({ attachments: attachmentStore({ maxImageBytes: 1 }), llm: visionLlm(['image']) }), reason: /byte limit/ },
    ]
    for (const { ctx, reason } of cases) {
      const tool = seeTool(ctx, await registryWith(sessionWith()), base)
      const value = await tool.execute({}, exec as never)
      expect(value.note).toMatch(reason)
      expect(value.path).toBeDefined()
      temporary.push(value.path as string)
      expect(existsSync(value.path as string)).toBe(true)
      const blocks = tool.output.render({}, value)
      expect(blocks).toHaveLength(1)
    }
  })

  it('treats an unresolvable route as not image-capable', async () => {
    const tool = seeTool(contextWith({ attachments: attachmentStore() }), await registryWith(sessionWith()), resolveConfig({}))
    const value = await tool.execute({}, { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal } as never)
    expect(value.note).toMatch(/does not declare image input/)
    temporary.push(value.path as string)
  })

  it('uses the process cwd when the agent is absent', async () => {
    const registry = new GameSessionRegistry(async () => sessionWith())
    await registry.ensure(process.cwd(), {})
    const tool = seeTool(contextWith({ attachments: attachmentStore() }), registry, resolveConfig({}))
    const value = await tool.execute({}, { agent: undefined, signal: new AbortController().signal } as never)
    expect(value.note).toMatch(/does not declare image input/)
    temporary.push(value.path as string)
  })

  it('tolerates a malformed shot payload', async () => {
    const request = vi.fn(async () => ({
      kind: 'ok' as const,
      id: 1,
      payload: { size: 'x', bytes: 'y', frame: 'z', data: 5 },
    }))
    const tool = seeTool(contextWith({}), await registryWithRequest(request), resolveConfig({}))
    const value = await tool.execute({}, exec as never)
    expect(value).toMatchObject({ frame: 0, width: 0, height: 0, bytes: 0 })
    expect(value.path).toBeDefined()
    temporary.push(value.path as string)
  })

  it('rejects when no session is running', async () => {
    const tool = seeTool(contextWith({}), new GameSessionRegistry(async () => sessionWith()), resolveConfig({}))
    await expect(tool.execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
