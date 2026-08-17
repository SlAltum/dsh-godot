/**
 * Abort helpers: full branch coverage for the signal-fusion utilities the
 * pool and provider rely on.
 */

import { describe, expect, it } from 'vitest'
import { abortable, abortError, throwIfAborted } from '../src/abort.ts'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('abortError', () => {
  it('returns the signal reason when it is an Error', () => {
    const reason = new Error('pool disposed')
    const controller = new AbortController()
    controller.abort(reason)
    expect(abortError(controller.signal)).toBe(reason)
  })

  it('falls back to a generic Error when the reason is not an Error', () => {
    const controller = new AbortController()
    controller.abort('some string reason')
    expect(abortError(controller.signal)).toBeInstanceOf(Error)
    expect(abortError(controller.signal).message).toBe('aborted')
  })
})

describe('throwIfAborted', () => {
  it('does nothing while the signal is not aborted', () => {
    expect(() =>{  throwIfAborted(new AbortController().signal) }).not.toThrow()
  })

  it('throws the abort error once the signal is aborted', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() =>{  throwIfAborted(controller.signal) }).toThrow('aborted')
  })
})

describe('abortable', () => {
  it('resolves with the promise value when not aborted', async () => {
    await expect(abortable(Promise.resolve(42), new AbortController().signal)).resolves.toBe(42)
  })

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(abortable(Promise.resolve(1), controller.signal)).rejects.toThrow('aborted')
  })

  it('rejects with the abort error when the signal aborts during the wait', async () => {
    const controller = new AbortController()
    const pending = abortable(sleep(100).then(() => 'done'), controller.signal)
    await sleep(10)
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
  })

  it('rejects with the underlying promise error when it fails first', async () => {
    const controller = new AbortController()
    await expect(abortable(Promise.reject(new Error('boom')), controller.signal)).rejects.toThrow('boom')
  })

  it('wraps a non-Error rejection into an Error', async () => {
    const controller = new AbortController()
    // The test intentionally rejects with a non-Error to pin the wrap behavior.
    /* oxlint-disable-next-line typescript/prefer-promise-reject-errors */
    await expect(abortable(Promise.reject('plain string'), controller.signal)).rejects.toThrow('plain string')
  })
})
