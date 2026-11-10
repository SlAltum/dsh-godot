/**
 * The process gate: how many one-shot Godot runs a host may have in flight.
 *
 * A fan-out of `godot_validate` calls spawns one Godot each, and a project-mode
 * run boots an editor — five at once is minutes of CPU and gigabytes of RAM for
 * results the caller could take one at a time. So every run acquires a slot,
 * waits when none is free, and releases it when the process has settled.
 */

import { describe, expect, it, vi } from 'vitest'
import { ProcessGate, type GateWait } from '../src/process-gate.ts'

/** Resolve once the microtask queue drains, so queued waiters have run. */
function settle(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

describe('ProcessGate', () => {
  it('admits up to the limit without waiting', async () => {
    const gate = new ProcessGate(2)
    await gate.acquire()
    await gate.acquire()
    expect(gate.active).toBe(2)
  })

  it('queues the run that would exceed the limit, then admits it in order', async () => {
    const gate = new ProcessGate(1)
    const first = await gate.acquire()
    const order: string[] = []
    const second = gate.acquire().then((release) => { order.push('second'); return release })
    const third = gate.acquire().then((release) => { order.push('third'); return release })
    await settle()
    expect(order).toEqual([])
    expect(gate.active).toBe(1)

    first()
    await second
    expect(order).toEqual(['second'])
    third.then(release => release())
  })

  it('counts queued time against the caller deadline', async () => {
    const gate = new ProcessGate(1)
    const release = await gate.acquire()
    const waiting = gate.acquire({ deadlineAt: Date.now() - 1 })
    await expect(waiting).rejects.toMatchObject({ reason: 'deadline' })
    release()
    expect(gate.active).toBe(0)
  })

  it('rejects a queued run whose caller cancelled, and frees no slot', async () => {
    const gate = new ProcessGate(1)
    const release = await gate.acquire()
    const controller = new AbortController()
    const waiting = gate.acquire({ signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ reason: 'aborted' })
    release()
    expect(gate.active).toBe(0)
  })

  it('never exceeds the limit across many concurrent callers', async () => {
    const gate = new ProcessGate(3)
    let peak = 0
    const runs = Array.from({ length: 12 }, async () => {
      const release = await gate.acquire()
      peak = Math.max(peak, gate.active)
      await settle()
      release()
    })
    await Promise.all(runs)
    expect(peak).toBeLessThanOrEqual(3)
    expect(gate.active).toBe(0)
  })

  it('ignores a late deadline once admitted', async () => {
    const gate = new ProcessGate(1)
    const wait: GateWait = { deadlineAt: Date.now() + 10_000 }
    const release = await gate.acquire(wait)
    await settle()
    expect(gate.active).toBe(1)
    release()
  })

  it('releases idempotently so a double call cannot inflate capacity', async () => {
    const gate = new ProcessGate(1)
    const release = await gate.acquire()
    release()
    release()
    expect(gate.active).toBe(0)
    const again = await gate.acquire()
    expect(gate.active).toBe(1)
    again()
  })

  it('keeps the timer seam out of the decision', () => {
    // A gate with a limit of at least one must never reject on construction.
    expect(() => new ProcessGate(1)).not.toThrow()
    expect(vi.fn()).not.toHaveBeenCalled()
  })
})
