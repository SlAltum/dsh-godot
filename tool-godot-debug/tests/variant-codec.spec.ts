/**
 * Variant codec tests. The decode expectations are anchored to the T3.0
 * real-Godot fixture (`t3-breakpoints.bin` + manifest): the expected values
 * come from the observed event timeline, not from this codec's own math, so a
 * regression in either direction disagrees with a known-good recording. The
 * encode tests cover the fixed source-plugin bugs (utf8 string length,
 * undefined frames, f64 array branch) plus round-trips.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VariantDecoder } from '../src/variant-decoder.ts'
import { VariantEncoder } from '../src/variant-encoder.ts'
import { ObjectId, StringName, Vector2, Vector2i, Vector3, Vector3i, Vector4, Vector4i, Color } from '../src/variants.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bin = readFileSync(join(here, 'fixtures', 't3-breakpoints.bin'))
const manifest = JSON.parse(readFileSync(join(here, 'fixtures', 't3-breakpoints.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}

/** Split the fixture stream into payload frames by [u32 LE len][payload]. */
function payloads(): Buffer[] {
  const out: Buffer[] = []
  let off = 0
  while (off + 4 <= bin.length) {
    const len = bin.readUInt32LE(off)
    out.push(bin.subarray(off + 4, off + 4 + len))
    off += 4 + len
  }
  return out
}

describe('decode real Godot frames (T3.0 fixture)', () => {
  const decoder = new VariantDecoder()
  const frames = payloads()

  it('splits the fixture into 20 frames matching the manifest', () => {
    expect(frames.length).toBe(manifest.frames.length)
    expect(bin.length).toBe((manifest as { totalBytes?: number }).totalBytes)
  })

  it('decodes set_pid as [command, threadId, [pid]]', () => {
    const msg = decoder.decodeMessage(frames[0]!)
    expect(msg[0]).toBe('set_pid')
    expect(msg[1]).toBe(1)
    const params = msg[2]
    expect(Array.isArray(params)).toBe(true)
    expect(typeof (params as unknown[])[0]).toBe('number')
  })

  it('decodes the banner output as a PackedStringArray plus an int array', () => {
    const msg = decoder.decodeMessage(frames[1]!)
    expect(msg[0]).toBe('output')
    expect(Array.isArray(msg[2])).toBe(true)
    const [lines, flags] = msg[2] as [string[], number[]]
    expect(typeof lines[0]).toBe('string')
    expect(lines[0]).toContain('Godot Engine v4.7')
    expect(flags).toEqual([0])
  })

  it('decodes debug_enter with the Breakpoint reason and flag', () => {
    const msg = decoder.decodeMessage(frames[3]!)
    expect(msg[0]).toBe('debug_enter')
    expect(msg[2]).toEqual([true, 'Breakpoint', true, 1])
  })

  it('decodes stack_dump frame triplets (params[0] = total items)', () => {
    const msg = decoder.decodeMessage(frames[5]!)
    expect(msg[0]).toBe('stack_dump')
    expect(msg[2]).toEqual([6, 'res://player.gd', 10, 'run', 'res://main.gd', 7, '_ready'])
  })

  it('decodes stack_frame_vars with the remaining count', () => {
    const msg = decoder.decodeMessage(frames[6]!)
    expect(msg[0]).toBe('stack_frame_vars')
    expect(msg[2]).toEqual([4])
  })

  it('decodes stack_frame_var values with typed objects (ObjectId/StringName/Vector2)', () => {
    const self = decoder.decodeMessage(frames[7]!)[2] as [string, number, number, ObjectId, string]
    expect(self[0]).toBe('self')
    expect(self[1]).toBe(1)
    expect(self[2]).toBe(24)
    expect(self[3]).toBeInstanceOf(ObjectId)
    expect(self[4]).toBe('Player')

    const counter = decoder.decodeMessage(frames[8]!)[2] as [string, number, number, number, string]
    expect(counter).toEqual(['counter', 1, 2, 1, ''])

    const nameTag = decoder.decodeMessage(frames[9]!)[2] as [string, number, number, StringName, string]
    expect(nameTag[0]).toBe('name_tag')
    expect(nameTag[2]).toBe(21)
    expect(nameTag[3]).toBeInstanceOf(StringName)
    expect(nameTag[3].value).toBe('hero')

    const target = decoder.decodeMessage(frames[10]!)[2] as [string, number, number, Vector2, string]
    expect(target[0]).toBe('target')
    expect(target[2]).toBe(5)
    expect(target[3]).toBeInstanceOf(Vector2)
    expect(target[3].x).toBe(10)
    expect(target[3].y).toBe(20)
  })

  it('decodes every frame in the fixture without error', () => {
    for (const [i, payload] of frames.entries()) {
      expect(() => decoder.decodeMessage(payload), `frame ${i}`).not.toThrow()
    }
  })
})

describe('encode', () => {
  const encoder = new VariantEncoder()
  const decoder = new VariantDecoder()

  it('round-trips primitives, arrays and dictionaries', () => {
    const cases: unknown[] = ['get_stack_dump', 1, true, -42, 3.5, ['a', 1, [true]], new Map([['k', 'v']]), null]
    for (const value of cases) {
      const encoded = encoder.encodeVariant(value)
      const decoded = decoder.decodeVariant(encoded)
      expect(decoded, String(value)).toEqual(value)
    }
  })

  it('encodes a full command message as a single ARRAY frame with a correct length prefix', () => {
    const buf = encoder.encodeMessage(['get_stack_dump', 1, []])
    expect(buf.readUInt32LE(0)).toBe(buf.length - 4) // length prefix = payload bytes
    const msg = decoder.decodeMessage(buf.subarray(4))
    expect(msg).toEqual(['get_stack_dump', 1, []])
  })

  it('encodes non-ASCII strings with byte-accurate lengths (source-plugin bug fix)', () => {
    const s = 'res://中文路径/角色.gd'
    const encoded = encoder.encodeVariant(s)
    // The decoder must recover the exact string: a UTF-16 length prefix would
    // truncate mid-character and desync the frame.
    expect(decoder.decodeVariant(encoded)).toBe(s)
    // Frame padding must stay 4-byte aligned from the length-prefix start.
    const buf = encoder.encodeMessage(['breakpoint', 1, [s, 10, true]])
    expect((buf.length - 4) % 4).toBe(0)
    const msg = decoder.decodeMessage(buf.subarray(4))
    const params = msg[2]
    expect(Array.isArray(params)).toBe(true)
    expect((params as unknown[])[0]).toBe(s)
  })

  it('throws on undefined instead of emitting a size-mismatched frame (source-plugin bug fix)', () => {
    expect(() => encoder.encodeVariant(undefined)).toThrow(/undefined/)
    expect(() => encoder.encodeMessage(['x', undefined, []])).toThrow(/undefined/)
  })

  it('encodes integers beyond 32 bits as 64-bit variants', () => {
    const big = 2 ** 33
    const encoded = encoder.encodeVariant(big)
    expect(decoder.decodeVariant(encoded)).toBe(BigInt(big))
  })

  it('encodes negative integers without unsigned overflow', () => {
    const encoded = encoder.encodeVariant(-7)
    expect(decoder.decodeVariant(encoded)).toBe(-7)
  })

  it('round-trips bigints as INT64 (Phase 5: scene:inspect_object ids)', () => {
    const id = 27028096474n
    const encoded = encoder.encodeVariant(id)
    expect(decoder.decodeVariant(encoded)).toBe(id)
    // A full command frame carrying the bigint must not overflow its buffer
    // (regression: sizeVariant sized bigints as 8 bytes, the write overflowed).
    const frame = encoder.encodeMessage(['scene:inspect_object', 1, [id]])
    expect(decoder.decodeMessage(frame.subarray(4))).toEqual(['scene:inspect_object', 1, [id]])
  })

  it('round-trips the math types the container rebuilds need (Phase 12)', () => {
    const cases: [unknown, Record<string, number>][] = [
      [new Vector2(1.5, -2.25), { x: 1.5, y: -2.25 }],
      [new Vector2i(1, 2), { x: 1, y: 2 }],
      [new Vector3(1, 2, 3), { x: 1, y: 2, z: 3 }],
      [new Vector3i(1, 2, 3), { x: 1, y: 2, z: 3 }],
      [new Vector4(1, 2, 3, 4), { x: 1, y: 2, z: 3, w: 4 }],
      [new Vector4i(1, 2, 3, 4), { x: 1, y: 2, z: 3, w: 4 }],
      [new Color(0.1, 0.2, 0.3, 1), { r: 0.1, g: 0.2, b: 0.3, a: 1 }],
    ]
    for (const [value, fields] of cases) {
      const encoded = encoder.encodeVariant(value)
      const decoded = decoder.decodeVariant(encoded) as unknown as Record<string, number>
      expect(decoded.constructor.name).toBe((value as object).constructor.name)
      for (const [key, expected] of Object.entries(fields)) {
        expect(decoded[key]).toBeCloseTo(expected, 4) // float32 wire
      }
    }
  })

  it('round-trips a container holding math types (Phase 12 rebuilds)', () => {
    const container: unknown[] = [1, new Vector2(9, 9), new StringName('named'), [2, 3]]
    const encoded = encoder.encodeVariant(container)
    const decoded = decoder.decodeVariant(encoded) as unknown[]
    expect(decoded).toHaveLength(4)
    expect(decoded[0]).toBe(1)
    expect((decoded[1] as Vector2).x).toBeCloseTo(9, 4)
    expect((decoded[1] as Vector2).y).toBeCloseTo(9, 4)
    expect(decoded[2]).toEqual(new StringName('named'))
    expect(decoded[3]).toEqual([2, 3])
  })
})

describe('decode edge cases', () => {
  const decoder = new VariantDecoder()

  it('decodes PackedFloat64Array with 64-bit values (source-plugin bug fix)', () => {
    // Frame payload: one variant, type 33 (PACKED_FLOAT64_ARRAY), 2 doubles.
    const payload = Buffer.alloc(4 + 4 + 16)
    payload.writeUInt32LE(33, 0)
    payload.writeUInt32LE(2, 4)
    payload.writeDoubleLE(1.5, 8)
    payload.writeDoubleLE(-2.25, 16)
    const msg = decoder.decodeVariant(payload)
    expect(msg).toEqual([1.5, -2.25])
  })

  it('rejects a truncated payload', () => {
    expect(() => decoder.decodeVariant(Buffer.from([2, 0, 0, 0]))).toThrow()
  })

  it('decodes null as null', () => {
    expect(decoder.decodeVariant(Buffer.from([0, 0, 0, 0]))).toBeNull()
  })
})
