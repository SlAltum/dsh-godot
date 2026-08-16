/**
 * S3: per-workspace connection pool. One live connection per workspace key,
 * single-flight creation, a serialized run queue per workspace (so transient
 * open/query/close lifecycles never interleave), dead-connection eviction,
 * and quiescent disposal that awaits in-flight work. Mirrors the lsp-stdio
 * pool structure adapted to connections the provider does not always own
 * (attach: external Godot process; spawn: owned).
 */

import { describe, expect, it } from 'vitest'
import { ConnectionPool, type ConnectionHandle } from '../src/pool.ts'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** A fake handle that can be marked dead on demand. */
class FakeHandle implements ConnectionHandle {
  closed = false
  constructor(public readonly name: string) {}
  get dead(): boolean {
    return this.closed
  }
  close(): void {
    this.closed = true
  }
}

describe('ConnectionPool', () => {
  it('creates one connection per workspace on demand (single-flight)', async () => {
    const created: string[] = []
    const pool = new ConnectionPool(async (key) => {
      created.push(key)
      await sleep(10)
      return new FakeHandle(key)
    })
    const results = await Promise.all([
      pool.withConnection('a', undefined, async c => c.name),
      pool.withConnection('a', undefined, async c => c.name),
      pool.withConnection('b', undefined, async c => c.name),
    ])
    expect(results).toEqual(['a', 'a', 'b'])
    // Factory ran once per workspace despite three concurrent calls.
    expect(created.filter(k => k === 'a')).toHaveLength(1)
    expect(created.filter(k => k === 'b')).toHaveLength(1)
    await pool.disposeAll()
  })

  it('reuses a live connection across runs', async () => {
    let factoryCalls = 0
    const pool = new ConnectionPool(async () => {
      factoryCalls++
      return new FakeHandle('c')
    })
    await pool.withConnection('x', undefined, async () => {})
    await pool.withConnection('x', undefined, async () => {})
    expect(factoryCalls).toBe(1)
    await pool.disposeAll()
  })

  it('evicts a dead connection and rebuilds on the next run', async () => {
    const handles: FakeHandle[] = []
    const pool = new ConnectionPool(async () => {
      const handle = new FakeHandle(`h${handles.length}`)
      handles.push(handle)
      return handle
    })
    await pool.withConnection('x', undefined, async (c) => {
      expect((c).name).toBe('h0')
      ;(c).close() // connection dies during the run
    })
    await pool.withConnection('x', undefined, async (c) => {
      expect((c).name).toBe('h1')
    })
    expect(handles).toHaveLength(2)
    await pool.disposeAll()
  })

  it('serializes runs per workspace (no interleaving)', async () => {
    const order: string[] = []
    const pool = new ConnectionPool(async () => new FakeHandle('c'))
    const runA = pool.withConnection('w', undefined, async () => {
      order.push('a-start')
      await sleep(20)
      order.push('a-end')
    })
    const runB = pool.withConnection('w', undefined, async () => {
      order.push('b-start')
      order.push('b-end')
    })
    await Promise.all([runA, runB])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
    await pool.disposeAll()
  })

  it('lets a waiting run abort without deserializing the queue', async () => {
    const order: string[] = []
    const pool = new ConnectionPool(async () => new FakeHandle('c'))
    const release = Promise.withResolvers<undefined>()
    const first = pool.withConnection('w', undefined, async () => {
      order.push('first')
      await release.promise
    })
    const controller = new AbortController()
    const waiting = pool.withConnection('w', controller.signal, async () => {
      order.push('never')
    })
    await sleep(10)
    controller.abort()
    await expect(waiting).rejects.toThrow('aborted')
    release.resolve(undefined)
    await first
    // The queue tail survives the aborted wait; the next run still executes.
    const third = pool.withConnection('w', undefined, async () => {
      order.push('third')
    })
    await third
    expect(order).toEqual(['first', 'third'])
    await pool.disposeAll()
  })

  it('rejects runs after disposal and awaits in-flight work', async () => {
    const order: string[] = []
    const pool = new ConnectionPool(async () => new FakeHandle('c'))
    const release = Promise.withResolvers<undefined>()
    const inflight = pool.withConnection('w', undefined, async () => {
      order.push('inflight')
      await release.promise
      order.push('inflight-done')
    })
    await sleep(10)
    const disposal = pool.disposeAll()
    await expect(pool.withConnection('w', undefined, async () => {})).rejects.toThrow(/disposed/i)
    release.resolve(undefined)
    await disposal
    await inflight
    expect(order).toEqual(['inflight', 'inflight-done'])
  })

  it('disposeAll is idempotent and closes live connections', async () => {
    const handle = new FakeHandle('c')
    const pool = new ConnectionPool(async () => handle)
    await pool.withConnection('w', undefined, async () => {})
    await pool.disposeAll()
    await pool.disposeAll()
    expect(handle.closed).toBe(true)
  })
})
