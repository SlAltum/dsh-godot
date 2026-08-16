/**
 * FrameAssembler: turns TCP chunks into complete `[u32 LE len][payload]`
 * frames. Unlike the source plugin's split_buffers, a chunk shorter than the
 * 4-byte length prefix is held, never read (the plugin read UInt32LE on a
 * short tail and threw ERR_OUT_OF_RANGE — plan M11).
 */

import { describe, expect, it } from 'vitest'
import { FrameAssembler } from '../src/frames.ts'
import { VariantEncoder } from '../src/variant-encoder.ts'

function frame(msg: unknown[]): Buffer {
  return new VariantEncoder().encodeMessage(msg)
}

describe('FrameAssembler', () => {
  it('emits one frame per complete chunk', () => {
    const a = new FrameAssembler()
    const out = a.push(frame(['set_pid', 1, [42]]))
    expect(out.length).toBe(1)
    const first = out[0]
    expect(first).toBeDefined()
    expect(first?.length).toBe(frame(['set_pid', 1, [42]]).length - 4)
  })

  it('reassembles a frame split mid-payload', () => {
    const a = new FrameAssembler()
    const f = frame(['stack_dump', 1, [6]])
    const half = Math.floor(f.length / 2)
    expect(a.push(f.subarray(0, half))).toEqual([])
    const out = a.push(f.subarray(half))
    expect(out.length).toBe(1)
  })

  it('reassembles a frame split inside the 4-byte length prefix', () => {
    const a = new FrameAssembler()
    const f = frame(['continue', 1, []])
    expect(a.push(f.subarray(0, 2))).toEqual([])
    expect(a.push(f.subarray(2))).toEqual([f.subarray(4)])
  })

  it('emits multiple frames from one sticky chunk', () => {
    const a = new FrameAssembler()
    const out = a.push(Buffer.concat([frame(['set_pid', 1, [1]]), frame(['continue', 1, []])]))
    expect(out.length).toBe(2)
  })

  it('holds a trailing partial frame until the next chunk', () => {
    const a = new FrameAssembler()
    const f = frame(['debug_enter', 1, [true, 'Breakpoint', true, 1]])
    const out1 = a.push(Buffer.concat([frame(['set_pid', 1, [1]]), f.subarray(0, 10)]))
    expect(out1.length).toBe(1)
    const out2 = a.push(f.subarray(10))
    expect(out2.length).toBe(1)
  })

  it('tracks the total buffered bytes for the message cap', () => {
    const a = new FrameAssembler()
    const f = frame(['x', 1, []])
    a.push(f.subarray(0, 2))
    expect(a.buffered).toBe(2)
    a.push(f.subarray(2))
    expect(a.buffered).toBe(0)
  })
})
