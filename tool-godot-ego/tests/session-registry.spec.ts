/**
 * The cross-restart session registry: what one host writes so the next host can
 * tell a live game from a leftover one.
 *
 * The sweep is the whole point, so every branch of the decision is pinned here:
 * a dead pid, a live pid whose bridge answers (ours), and a live pid whose port
 * is silent (a recycled pid — never signalled).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSessionRecord, sessionRecordDir, sweepSessions, writeSessionRecord,
  type SessionRecord, type SweepDeps,
} from '../src/session-registry.ts'

let dir = ''

/** One record with the fields the sweep reads. */
function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'session-a',
    ownerPid: 9001,
    workspace: '/ws',
    pid: 4242,
    port: 51820,
    projectRoot: '/ws/project',
    tempDir: join(dir, 'temp-a'),
    startedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  }
}

/** Sweep seams with per-test behaviour. */
function deps(overrides: Partial<SweepDeps> = {}): SweepDeps {
  return {
    dir,
    isAlive: (pid: number) => pid === 4242,
    isListening: async () => true,
    terminate: () => {},
    removeDir: (target: string) => rm(target, { recursive: true, force: true }),
    ...overrides,
  }
}

/** The record files currently in the registry directory. */
async function records(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.json'))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'godot-registry-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('session records', () => {
  it('round-trips one record and clears it by session id', async () => {
    await writeSessionRecord(dir, record())
    expect(await records()).toEqual(['session-a.json'])
    const stored = JSON.parse(await readFile(join(dir, 'session-a.json'), 'utf8')) as SessionRecord
    expect(stored).toMatchObject({ sessionId: 'session-a', pid: 4242, port: 51820 })

    await clearSessionRecord(dir, 'session-a')
    expect(await records()).toEqual([])
  })

  it('clears a missing record without failing', async () => {
    await expect(clearSessionRecord(dir, 'never-written')).resolves.toBeUndefined()
  })
})

describe('sweepSessions', () => {
  it('removes a dead session and its temp scripts without signalling anything', async () => {
    await mkdir(join(dir, 'temp-a'), { recursive: true })
    await writeSessionRecord(dir, record())
    const terminate = vi.fn()

    const report = await sweepSessions(deps({ isAlive: () => false, terminate }))

    expect(report).toEqual({ swept: 1, terminated: 0, kept: 0 })
    expect(terminate).not.toHaveBeenCalled()
    expect(await records()).toEqual([])
  })

  it('terminates a live game whose bridge answers, then removes the record', async () => {
    await writeSessionRecord(dir, record())
    const terminate = vi.fn()

    const report = await sweepSessions(deps({ terminate }))

    expect(report).toEqual({ swept: 1, terminated: 1, kept: 0 })
    expect(terminate).toHaveBeenCalledWith(4242)
    expect(await records()).toEqual([])
  })

  it('leaves a live pid alone when its bridge port is silent (the pid was reused)', async () => {
    await mkdir(join(dir, 'temp-a'), { recursive: true })
    await writeSessionRecord(dir, record())
    const terminate = vi.fn()

    const report = await sweepSessions(deps({ isListening: async () => false, terminate }))

    expect(report).toEqual({ swept: 1, terminated: 0, kept: 1 })
    expect(terminate).not.toHaveBeenCalled()
    expect(await records()).toEqual([])
  })

  it('leaves a session owned by another live host alone', async () => {
    await mkdir(join(dir, 'temp-a'), { recursive: true })
    await writeSessionRecord(dir, record({ ownerPid: 777 }))
    const terminate = vi.fn()

    const report = await sweepSessions(deps({ terminate, isAlive: () => true }))

    expect(report).toEqual({ swept: 0, terminated: 0, kept: 0 })
    expect(terminate).not.toHaveBeenCalled()
    expect(await records()).toEqual(['session-a.json'])
  })

  it('sweeps each record independently', async () => {
    await writeSessionRecord(dir, record({ sessionId: 'dead', pid: 1 }))
    await writeSessionRecord(dir, record({ sessionId: 'reused', pid: 2 }))
    const terminate = vi.fn()

    const report = await sweepSessions(deps({
      isAlive: (pid: number) => pid === 2,
      isListening: async () => false,
      terminate,
    }))

    expect(report).toEqual({ swept: 2, terminated: 0, kept: 1 })
    expect(terminate).not.toHaveBeenCalled()
    expect(await records()).toEqual([])
  })

  it('drops an unreadable record instead of failing the sweep', async () => {
    await writeFile(join(dir, 'broken.json'), 'not json', 'utf8')

    const report = await sweepSessions(deps())

    expect(report.swept).toBe(1)
    expect(await records()).toEqual([])
  })

  it('is a no-op on an empty or missing directory', async () => {
    expect(await sweepSessions(deps())).toEqual({ swept: 0, terminated: 0, kept: 0 })
    expect(await sweepSessions(deps({ dir: join(dir, 'absent') }))).toEqual({ swept: 0, terminated: 0, kept: 0 })
  })
})

describe('sessionRecordDir', () => {
  it('sits under the host data directory unless a deployment names one', () => {
    expect(sessionRecordDir('C:/state/godot')).toBe('C:/state/godot')
    const derived = sessionRecordDir('')
    expect(derived.endsWith(join('cache', 'godot-ego'))).toBe(true)
  })
})
