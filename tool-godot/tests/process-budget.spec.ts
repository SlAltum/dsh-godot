/**
 * `runGodot` under a host-wide slot budget: a fan-out queues instead of booting
 * one Godot per call, and the queue wait is charged to the caller's deadline.
 *
 * The seam is a fake `ctx.subprocess` so concurrency is observed directly: how
 * many spawns are open at the same moment is the number the gate owns.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { runGodot } from '@deepseek-ai/dsh-tool-godot'
import { ProcessGate } from '../src/process-gate.ts'

const CAPS = { stdoutMaxBytes: 65_536, stderrMaxBytes: 65_536, graceMs: 1_000 }
const EXECUTABLE = { executable: 'godot', args: [] as string[] }

/** A collected stream stub, read the way `runGodot` reads it. */
function stream(text: string) {
  return { readFrom: () => ({ text, lossy: false, nextOffset: text.length }) }
}

/**
 * A subprocess seam that settles every spawn after `holdMs` and records the
 * peak number of open spawns.
 */
function seam(holdMs: number): { ctx: Context, peak: () => number, spawns: () => number } {
  let open = 0
  let peak = 0
  let spawns = 0
  const ctx = {
    subprocess: {
      spawn: () => {
        open += 1
        spawns += 1
        peak = Math.max(peak, open)
        const done = new Promise(resolve => {
          setTimeout(() => {
            open -= 1
            resolve({ exitCode: 0, signal: null })
          }, holdMs)
        })
        return { done, terminate: vi.fn(), collected: { stdout: stream('ok'), stderr: stream('') } }
      },
    },
  } as unknown as Context
  return { ctx, peak: () => peak, spawns: () => spawns }
}

/** One call site, shaped like the tools. */
function exec() {
  return { agent: { session: { header: { cwd: process.cwd() } } }, signal: new AbortController().signal }
}

describe('runGodot process budget', () => {
  it('never exceeds the gate limit under a fan-out, and runs every call', async () => {
    const fake = seam(20)
    const caps = { ...CAPS, gate: new ProcessGate(2) }
    const runs = Array.from({ length: 6 }, () => runGodot(fake.ctx, exec(), 'godot_validate', EXECUTABLE, ['--version'], caps))

    const results = await Promise.all(runs)

    expect(results.every(run => run.exitCode === 0)).toBe(true)
    expect(fake.spawns()).toBe(6)
    expect(fake.peak()).toBe(2)
  })

  it('queues a call whose deadline expires while it waits', async () => {
    const fake = seam(200)
    const gate = new ProcessGate(1)
    const caps = { ...CAPS, gate }
    const holder = runGodot(fake.ctx, exec(), 'godot_validate', EXECUTABLE, ['--version'], caps)
    // Let the first call take the only slot before the second one asks for it.
    await new Promise(resolve => { setTimeout(resolve, 10) })

    const queued = runGodot(fake.ctx, exec(), 'godot_run_scene', EXECUTABLE, ['--version'], caps, 30)

    await expect(queued).rejects.toMatchObject({ code: 'GODOT_ABORTED' })
    await holder
    expect(fake.spawns()).toBe(1)
  })

  it('runs without a gate when the caller owns no budget', async () => {
    const fake = seam(5)
    const results = await Promise.all(Array.from({ length: 3 }, () =>
      runGodot(fake.ctx, exec(), 'godot_validate', EXECUTABLE, ['--version'], CAPS)))
    expect(results.every(run => run.exitCode === 0)).toBe(true)
    expect(fake.peak()).toBe(3)
  })
})
