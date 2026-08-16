/**
 * Abort helpers for the connection pool: fuse caller cancellation with pool
 * disposal and throw the abort error the queue waiters observe.
 * @module @deepseek-ai/dsh-lsp-godot/abort
 */

/**
 * The error an aborted wait or run rejects with.
 * @param signal - the aborted signal carrying the reason.
 * @returns the signal's reason when it is an Error, else a generic abort error.
 */
export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted')
}

/**
 * Throw the abort error when the signal is aborted.
 * @param signal - the cancellation signal to check.
 */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

/**
 * Await `promise` but reject early when the signal aborts, discarding the
 * still-pending promise's eventual settlement.
 * @param promise - the work to await.
 * @param signal - the cancellation signal.
 * @returns the promise's value, or rejects with the abort error.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
