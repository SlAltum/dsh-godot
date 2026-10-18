/**
 * Protocol framing: encoding rules, reply narrowing, and the incremental line
 * decoder (partial chunks, CRLF, blank lines, and the overflow caps).
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_LINE_CHARS, EGO_PROTOCOL_VERSION, LineDecoder, encodeCommand, parseReply } from '../src/protocol.ts'

describe('encodeCommand', () => {
  it('emits one newline-terminated JSON line', () => {
    const line = encodeCommand(7, 'click', { x: 10, y: 20 })
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({ x: 10, y: 20, id: 7, cmd: 'click' })
  })

  it('keeps id and cmd authoritative over parameters', () => {
    const parsed = JSON.parse(encodeCommand(1, 'state', { id: 99, cmd: 'hijack' })) as Record<string, unknown>
    expect(parsed.id).toBe(1)
    expect(parsed.cmd).toBe('state')
  })

  it('rejects an invalid id', () => {
    expect(() => encodeCommand(0, 'ping')).toThrow(/positive integer/)
    expect(() => encodeCommand(1.5, 'ping')).toThrow(/positive integer/)
  })

  it('rejects an empty command name', () => {
    expect(() => encodeCommand(1, '')).toThrow(/non-empty/)
  })
})

describe('parseReply', () => {
  it('narrows an event', () => {
    const reply = parseReply({ event: 'hello', token: 't', protocol: 1 })
    expect(reply).toMatchObject({ kind: 'event', event: 'hello' })
  })

  it('narrows a success reply', () => {
    const reply = parseReply({ id: 3, ok: true, pong: true })
    expect(reply).toMatchObject({ kind: 'ok', id: 3 })
    if (reply?.kind !== 'ok') throw new Error('expected ok reply')
    expect(reply.payload.pong).toBe(true)
  })

  it('narrows an error reply', () => {
    expect(parseReply({ id: 4, ok: false, code: 'REJECTED', message: 'nope' }))
      .toMatchObject({ kind: 'error', id: 4, code: 'REJECTED', message: 'nope' })
  })

  it('returns undefined for anything else', () => {
    expect(parseReply(null)).toBeUndefined()
    expect(parseReply([])).toBeUndefined()
    expect(parseReply('text')).toBeUndefined()
    expect(parseReply({ ok: true })).toBeUndefined()
    expect(parseReply({ id: -1, ok: true })).toBeUndefined()
    expect(parseReply({ id: 1, ok: false, code: 'X' })).toBeUndefined()
    expect(parseReply({ event: '' })).toBeUndefined()
  })
})

describe('LineDecoder', () => {
  it('emits complete lines only, across chunk boundaries', () => {
    const decoder = new LineDecoder()
    expect(decoder.push('{"a"')).toEqual([])
    expect(decoder.push(':1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}'])
    expect(decoder.push('tail')).toEqual([])
    expect(decoder.push('\n')).toEqual(['tail'])
  })

  it('normalizes CRLF and drops blank lines', () => {
    const decoder = new LineDecoder()
    expect(decoder.push('one\r\n\r\ntwo\r\n')).toEqual(['one', 'two'])
  })

  it('flags and discards an over-long line', () => {
    const decoder = new LineDecoder(8)
    expect(decoder.push('x'.repeat(20) + '\n')).toEqual([])
    expect(decoder.overflow).toBe(true)
    expect(decoder.push('more\n')).toEqual([])
  })

  it('flags an over-long buffered tail without a newline', () => {
    const decoder = new LineDecoder(8)
    expect(decoder.push('y'.repeat(9))).toEqual([])
    expect(decoder.overflow).toBe(true)
  })

  it('reset clears the buffer and the overflow flag', () => {
    const decoder = new LineDecoder(4)
    decoder.push('abcdefgh')
    expect(decoder.overflow).toBe(true)
    decoder.reset()
    expect(decoder.overflow).toBe(false)
    expect(decoder.push('ok\n')).toEqual(['ok'])
  })

  it('exposes the default cap and the protocol version', () => {
    expect(DEFAULT_MAX_LINE_CHARS).toBeGreaterThan(1_000_000)
    expect(EGO_PROTOCOL_VERSION).toBe(1)
  })
})
