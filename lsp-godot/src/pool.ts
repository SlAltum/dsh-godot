/**
 * Per-workspace connection pool for the Godot LSP provider. One live
 * connection per canonical workspace key; creation is single-flight; runs
 * serialize through a per-workspace tail so transient open/query/close
 * lifecycles never interleave; a dead connection is evicted and rebuilt on
 * the next run; disposal rejects new runs, closes every connection, and
 * awaits in-flight work to quiescence.
 * @module @deepseek-ai/dsh-lsp-godot/pool
 */

import { abortable, throwIfAborted } from './abort.ts'

/** A pooled connection the provider can close and inspect for liveness. */
export interface ConnectionHandle {
  /** True once the connection can no longer serve queries. */
  readonly dead: boolean
  /** Permanently close the connection (idempotent). */
  close(): void
}

/** A synchronous liveness probe for factory-created handles. */
type Factory<T extends ConnectionHandle> = (workspaceKey: string, signal: AbortSignal) => Promise<T>

/**
 * One run's error result, used to decide eviction: a dead connection after a
 * failed run is evicted; a live one is kept.
 */
export class ConnectionPool<T extends ConnectionHandle> {
  private readonly connections = new Map<string, T>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly lifetime = new AbortController()
  private disposed = false

  constructor(private readonly factory: Factory<T>) {}

  /**
   * Run one operation against the workspace's connection, creating it on
   * demand (single-flight through the per-workspace serialized queue) and
   * serializing behind prior runs of the same workspace.
   * @param workspaceKey - the canonical workspace identity.
   * @param signal - optional cancellation; aborts the queue wait and the run.
   * @param run - the operation; receives the live connection.
   * @param create - optional per-call creator that captures caller context
   * (for example, the canonical workspace) for connection establishment; falls back
   * to the pool factory when absent.
   * @returns the run's result.
   */
  withConnection<TResult>(
    workspaceKey: string,
    signal: AbortSignal | undefined,
    run: (connection: T) => Promise<TResult>,
    create?: (signal: AbortSignal) => Promise<T>,
  ): Promise<TResult> {
    if (this.disposed) return Promise.reject(new Error('lsp-godot connection pool is disposed'))
    const querySignal = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    return this.enqueue(workspaceKey, querySignal, async () => {
      throwIfAborted(querySignal)
      const connection = await this.connectionFor(workspaceKey, querySignal, create)
      throwIfAborted(querySignal)
      try {
        return await run(connection)
      } catch (error) {
        // A dead connection is evicted so the next run rebuilds; a live
        // connection keeps serving (the failure was the query's, not the
        // transport's).
        if (connection.dead) this.evictIfCurrent(workspaceKey, connection)
        throw error
      }
    })
  }

  /**
   * Dispose the pool: reject new runs, close every connection, and await all
   * in-flight runs to quiescence. Idempotent.
   */
  async disposeAll(): Promise<void> {
    this.disposed = true
    this.lifetime.abort(new Error('lsp-godot connection pool is disposed'))
    const live = [...this.connections.values()]
    const draining = [...this.queues.values()]
    this.connections.clear()
    for (const connection of live) connection.close()
    await Promise.allSettled(draining)
    this.queues.clear()
  }

  /** Serialize one run behind the workspace tail, abortably. */
  private enqueue<TResult>(
    workspaceKey: string,
    signal: AbortSignal,
    run: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.queues.get(workspaceKey) ?? Promise.resolve()
    const result = abortable(previous, signal).then(run)
    // The tail follows the actual prior work even when this caller aborts its
    // wait; it never rejects, so later runs serialize without inheriting an
    // earlier outcome.
    const tail = previous.then(() => result).then(() => undefined, () => undefined)
    this.queues.set(workspaceKey, tail)
    void tail.then(() => {
      if (this.queues.get(workspaceKey) === tail) this.queues.delete(workspaceKey)
    })
    return result
  }

  /** Return or single-flight-create the workspace's live connection. */
  private async connectionFor(workspaceKey: string, signal: AbortSignal, create?: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const existing = this.connections.get(workspaceKey)
    if (existing !== undefined && !existing.dead) return existing
    const created = create === undefined ? await this.factory(workspaceKey, signal) : await create(signal)
    throwIfAborted(signal)
    /* v8 ignore start -- serialization prevents concurrent connectionFor for one key; the preference guards a future parallel factory. */
    // Another waiter may have published a fresh connection while the connection was built;
    // prefer the published one and close the duplicate.
    const published = this.connections.get(workspaceKey)
    if (published !== undefined && !published.dead) {
      created.close()
      return published
    }
    /* v8 ignore stop */
    this.connections.set(workspaceKey, created)
    return created
  }

  /** Drop the slot iff it still holds this connection. */
  private evictIfCurrent(workspaceKey: string, connection: T): void {
    /* v8 ignore next -- serialized runs mean the slot can only hold this connection when eviction runs. */
    if (this.connections.get(workspaceKey) === connection) this.connections.delete(workspaceKey)
  }
}

export { abortError, throwIfAborted } from './abort.ts'
