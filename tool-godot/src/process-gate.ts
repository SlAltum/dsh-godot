/**
 * The process gate: how many one-shot Godot runs may be in flight at once.
 *
 * Every one-shot tool spawns its own Godot, so a fan-out of `godot_validate`
 * calls boots one editor per call — minutes of CPU and gigabytes of RAM for
 * results that arrive one at a time anyway. Runs therefore queue behind a
 * fixed number of slots: the caller keeps its own deadline while it waits, and
 * a cancelled caller leaves the queue without consuming a slot.
 * @module @deepseek-ai/dsh-tool-godot/process-gate
 */

/** Why a queued run was refused a slot. */
export interface GateRejection extends Error {
  /** `aborted` when the caller cancelled, `deadline` when the queue outlived its budget. */
  readonly reason: 'aborted' | 'deadline'
}

/** What one queued run brings with it. */
export interface GateWait {
  /** The caller's cancellation; a queued run that is aborted never starts. */
  readonly signal?: AbortSignal
  /** Absolute time the run must start by; waiting counts against it. */
  readonly deadlineAt?: number
}

/** One run's slot, released exactly once by the owner. */
export type GateRelease = () => void

/** A queued run waiting for a free slot. */
interface Waiter {
  admit(): void
  refuse(reason: 'aborted' | 'deadline'): void
}

/**
 * Counts slots per process. The gate is deliberately per plugin instance, not
 * per call: the budget is a property of the host, and every one-shot tool
 * routes through the same instance.
 */
export class ProcessGate {
  private activeCount = 0
  private readonly waiters: Waiter[] = []

  /** @param limit - how many runs may be in flight at once (at least one). */
  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('ProcessGate limit must be a positive integer')
  }

  /** Runs currently holding a slot. */
  get active(): number {
    return this.activeCount
  }

  /**
   * Take a slot, waiting when every slot is busy.
   * @param wait - the caller's cancellation and deadline.
   * @returns the release function for this slot (idempotent).
   * @throws {GateRejection} `aborted` or `deadline` while queued.
   */
  acquire(wait: GateWait = {}): Promise<GateRelease> {
    if (wait.signal?.aborted === true) return Promise.reject(rejection('aborted'))
    if (wait.deadlineAt !== undefined && wait.deadlineAt <= Date.now()) return Promise.reject(rejection('deadline'))
    if (this.activeCount < this.limit) {
      this.activeCount += 1
      return Promise.resolve(this.releaseSeat())
    }
    return new Promise<GateRelease>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let waiter!: Waiter
      const cleanup = (): void => {
        clearTimeout(timer)
        wait.signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        if (settled) return
        settled = true
        cleanup()
        this.drop(waiter)
        reject(rejection('aborted'))
      }
      waiter = {
        admit: () => {
          if (settled) return
          settled = true
          cleanup()
          // The slot is handed over, not added: the releasing owner kept the count.
          resolve(this.releaseSeat())
        },
        refuse: (reason) => {
          if (settled) return
          settled = true
          cleanup()
          this.drop(waiter)
          reject(rejection(reason))
        },
      }
      wait.signal?.addEventListener('abort', onAbort, { once: true })
      if (wait.deadlineAt !== undefined) {
        timer = setTimeout(() => { waiter.refuse('deadline') }, Math.max(0, wait.deadlineAt - Date.now()))
      }
      this.waiters.push(waiter)
    })
  }

  /** Free one slot and admit the longest waiter. */
  private releaseSeat(): GateRelease {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.waiters.shift()
      if (next === undefined) this.activeCount -= 1
      else next.admit()
    }
  }

  /** Remove one waiter that gave up before a slot was free. */
  private drop(waiter: Waiter): void {
    const index = this.waiters.indexOf(waiter)
    if (index >= 0) this.waiters.splice(index, 1)
  }
}

/** One typed rejection. */
function rejection(reason: 'aborted' | 'deadline'): GateRejection {
  const error = new Error(reason === 'aborted'
    ? 'the run was cancelled while waiting for a free Godot process slot'
    : 'the run ran out of time while waiting for a free Godot process slot') as GateRejection
  Object.defineProperty(error, 'reason', { value: reason, enumerable: true })
  return error
}
