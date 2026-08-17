/**
 * Phase 6 edit tests: the pure parse/target/value functions, plus applyEdits
 * against a DebugController + FakeGame replaying the T6.0 recording —
 * success with per-edit verification, parse/target failures, timeout skip,
 * budget exhaustion, disconnect propagation and cancellation. The fixture
 * request order mirrors the product pipeline: expand self/player, then the
 * four typed edits verified by re-inspect, then stop-B expansion (see
 * .context/t6/facts.md).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DebugController } from '../src/controller.ts'
import { applyEdits, findEditTarget, findPropValue, parseEditValue, valueEquals } from '../src/edit.ts'
import { expandObjects } from '../src/inspect.ts'
import { ObjectId, RID } from '../src/variants.ts'
import type { DecodedVariant } from '../src/variant-decoder.ts'
import { FakeGame } from './fixtures/fake-game.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bin = readFileSync(join(here, 'fixtures', 't6-edit.bin'))
const manifest = JSON.parse(readFileSync(join(here, 'fixtures', 't6-edit.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}

const SELF_ID = 27028096474n
const PLAYER_ID = 27061650910n

/** The t6 stop's object vars (self/player ObjectId, r_id RID, dead null). */
function objectVars(): DecodedVariant[][] {
  return [
    ['_delta', 0, 3, 0.00625, ''],
    ['self', 1, 24, new ObjectId(SELF_ID), 'Node'],
    ['counter', 1, 2, 20, ''],
    ['player', 1, 24, new ObjectId(PLAYER_ID), 'Node'],
    ['r_id', 1, 23, new RID(94489280512n), ''],
    ['dead', 1, 24, null, ''],
  ]
}

describe('parseEditValue', () => {
  it('parses int with engine-style truncation', () => {
    expect(parseEditValue('int', '42')).toBe(42)
    expect(parseEditValue('int', '12.5')).toBe(12) // engine truncates (T6.0 fact 4)
    expect(parseEditValue('int', '-3')).toBe(-3)
    expect(parseEditValue('int', 'abc')).toBeNull()
    expect(parseEditValue('int', '')).toBeNull() // empty input is not 0
  })

  it('parses float strictly', () => {
    expect(parseEditValue('float', '2.5')).toBe(2.5)
    expect(parseEditValue('float', '-0.25')).toBe(-0.25)
    expect(parseEditValue('float', 'nan')).toBeNull()
    expect(parseEditValue('float', '')).toBeNull()
  })

  it('parses bool with the source-plugin forms', () => {
    expect(parseEditValue('bool', 'true')).toBe(true)
    expect(parseEditValue('bool', '1')).toBe(true)
    expect(parseEditValue('bool', 'false')).toBe(false)
    expect(parseEditValue('bool', '0')).toBe(false)
    expect(parseEditValue('bool', 'yes')).toBeNull()
  })

  it('passes strings through and defaults the type to string', () => {
    expect(parseEditValue('string', 'hello')).toBe('hello')
    expect(parseEditValue(undefined, 'hello')).toBe('hello')
    expect(parseEditValue(undefined, '42')).toBe('42') // not coerced
  })
})

describe('findEditTarget', () => {
  it('finds a top-level ObjectId by bare or Members/ name', () => {
    expect(findEditTarget(objectVars(), 'self')).toBe(SELF_ID)
    expect(findEditTarget(objectVars(), 'Members/self')).toBe(SELF_ID)
    expect(findEditTarget(objectVars(), 'player')).toBe(PLAYER_ID)
  })

  it('returns null for scalars, RIDs, nulls and missing names', () => {
    expect(findEditTarget(objectVars(), 'counter')).toBeNull() // scalar
    expect(findEditTarget(objectVars(), 'r_id')).toBeNull() // RID excluded
    expect(findEditTarget(objectVars(), 'dead')).toBeNull() // freed → null
    expect(findEditTarget(objectVars(), 'ghost')).toBeNull()
  })
})

describe('valueEquals', () => {
  it('compares numbers, strings and booleans strictly', () => {
    expect(valueEquals(42, 42)).toBe(true)
    expect(valueEquals(42, 43)).toBe(false)
    expect(valueEquals('changed', 'changed')).toBe(true)
    expect(valueEquals('changed', 'other')).toBe(false)
    expect(valueEquals(true, true)).toBe(true)
    expect(valueEquals(true, false)).toBe(false)
    expect(valueEquals(12, 12)).toBe(true) // truncated int matches engine
  })

  it('tolerates float32 wire precision for non-binary-exact values', () => {
    // A request of 0.1 is encoded as float32 on the wire and comes back as
    // 0.10000000149011612; strict equality would misreport the write (T6.0
    // fact 3 measured exact float32 round-trips for 2.5 — this case covers
    // the precision-loss path).
    expect(valueEquals(0.10000000149011612, 0.1)).toBe(true)
    expect(valueEquals(12.300000190734863, 12.3)).toBe(true)
    expect(valueEquals(12.4, 12.3)).toBe(false) // beyond tolerance
    expect(valueEquals('0.1', 0.1)).toBe(false) // string vs number
    expect(valueEquals(null, 0.1)).toBe(false) // null vs number
  })
})

describe('findPropValue', () => {
  it('matches bare and Members/-prefixed property names', () => {
    const props = [
      ['Members/counter', 2, 0, '', 4100, 42],
      ['Node/path', 22, 0, '', 6, null],
    ] as unknown as DecodedVariant[]
    expect(findPropValue(props, 'counter')).toBe(42)
    expect(findPropValue(props, 'Members/counter')).toBe(42)
    expect(findPropValue(props, 'Node/path')).toBe(null)
    expect(findPropValue(props, 'missing')).toBeUndefined()
    expect(findPropValue(undefined, 'counter')).toBeUndefined()
  })
})

describe('applyEdits', () => {
  let controller: DebugController
  let game: FakeGame

  beforeEach(() => {
    controller = new DebugController({ maxMessageBytes: 16_000_000, maxOutputBytes: 1_000_000 })
    game = new FakeGame(bin, manifest.frames)
  })

  afterEach(async () => {
    await game.dispose()
    await controller.dispose()
  })

  /** Connect the fake game and wait for set_pid. */
  async function connectGame(): Promise<void> {
    await controller.listen(0)
    await game.connect(controller.port)
    await controller.waitForSetPid(5_000)
  }

  it('applies the four typed edits and verifies each against the engine', async () => {
    await connectGame()
    // The t6 fixture is the full product pipeline; the first two inspect
    // requests belong to the expansion phase, so prime the controller with
    // those two responses by simulating the expansion first (expandObjects
    // consumes them), exactly like the product loop does.
    await expandObjects(objectVars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      render: { maxDepth: 3, maxVarsPerScope: 200, maxValueLength: 200 },
      idleTimeoutMs: 2_000,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })
    const result = await applyEdits(
      [
        { target: 'self', property: 'counter', value: '42', type: 'int' },
        { target: 'self', property: 'speed', value: '2.5', type: 'float' },
        { target: 'self', property: 'label_text', value: 'changed', type: 'string' },
        { target: 'self', property: 'flag', value: 'true', type: 'bool' },
      ],
      objectVars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 10_000, signal: new AbortController().signal },
    )
    expect(result.truncated).toBe(false)
    expect(result.results).toEqual([
      { target: 'self', property: 'counter', requested: 42, type: 'int', ok: true },
      { target: 'self', property: 'speed', requested: 2.5, type: 'float', ok: true },
      { target: 'self', property: 'label_text', requested: 'changed', type: 'string', ok: true },
      { target: 'self', property: 'flag', requested: true, type: 'bool', ok: true },
    ])
  })

  it('flags unparseable values and missing targets without sending', async () => {
    await connectGame()
    const result = await applyEdits(
      [
        { target: 'self', property: 'counter', value: 'abc', type: 'int' },
        { target: 'ghost', property: 'counter', value: '5', type: 'int' },
        { target: 'counter', property: 'x', value: '5', type: 'int' }, // scalar target
      ],
      objectVars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 500, budgetMs: 10_000, signal: new AbortController().signal },
    )
    expect(result.truncated).toBe(true)
    expect(result.results.map(r => r.ok)).toEqual([false, false, false])
    expect(result.results[0]!.detail).toContain('cannot parse')
    expect(result.results[1]!.detail).toContain('not an editable object')
  })

  it('caps the edit count at maxEdits and flags truncation', async () => {
    await connectGame()
    // Prime the pipeline like the product loop does (expansion first).
    await expandObjects(objectVars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      render: { maxDepth: 3, maxVarsPerScope: 200, maxValueLength: 200 },
      idleTimeoutMs: 2_000,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })
    const result = await applyEdits(
      [
        { target: 'self', property: 'counter', value: '42', type: 'int' },
        { target: 'self', property: 'speed', value: '2.5', type: 'float' },
        { target: 'self', property: 'label_text', value: 'changed', type: 'string' },
        { target: 'self', property: 'flag', value: 'true', type: 'bool' },
      ],
      objectVars(),
      controller,
      { maxEdits: 2, idleTimeoutMs: 2_000, budgetMs: 10_000, signal: new AbortController().signal },
    )
    expect(result.truncated).toBe(true)
    expect(result.results).toHaveLength(2)
    expect(result.results.every(r => r.ok)).toBe(true)
  })

  it('does nothing when maxEdits is 0', async () => {
    await connectGame()
    const result = await applyEdits(
      [{ target: 'self', property: 'counter', value: '42', type: 'int' }],
      objectVars(),
      controller,
      { maxEdits: 0, idleTimeoutMs: 2_000, budgetMs: 10_000, signal: new AbortController().signal },
    )
    expect(result.results).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('stops early when the budget is exhausted and keeps the partial result', async () => {
    await connectGame()
    const result = await applyEdits(
      [{ target: 'self', property: 'counter', value: '42', type: 'int' }],
      objectVars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 0, signal: new AbortController().signal },
    )
    expect(result.results).toEqual([])
    expect(result.truncated).toBe(true)
  })

  it('propagates a disconnect as GODOT_UNAVAILABLE', async () => {
    await connectGame()
    await game.dispose()
    await expect(applyEdits(
      [{ target: 'self', property: 'counter', value: '42', type: 'int' }],
      objectVars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 10_000, signal: new AbortController().signal },
    )).rejects.toMatchObject({ code: 'GODOT_UNAVAILABLE' })
  })

  it('propagates cancellation as GODOT_ABORTED', async () => {
    await connectGame()
    const aborter = new AbortController()
    aborter.abort()
    await expect(applyEdits(
      [{ target: 'self', property: 'counter', value: '42', type: 'int' }],
      objectVars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 10_000, signal: aborter.signal },
    )).rejects.toMatchObject({ code: 'GODOT_ABORTED' })
  })
})
