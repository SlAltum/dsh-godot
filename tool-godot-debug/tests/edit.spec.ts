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
import {
  applyEdits, findEditTarget, findMapEntry, findPropValue, parseEditPath, parseEditValue,
  rebuildContainer, rebuildReason, valueEquals,
} from '../src/edit.ts'
import { expandObjects } from '../src/inspect.ts'
import { ObjectId, RID, RawObject, StringName, Vector2, Vector3, NodePath } from '../src/variants.ts'
import type { DecodedVariant } from '../src/variant-decoder.ts'
import { FakeGame } from './fixtures/fake-game.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bin = readFileSync(join(here, 'fixtures', 't6-edit.bin'))
const manifest = JSON.parse(readFileSync(join(here, 'fixtures', 't6-edit.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
const nestedBin = readFileSync(join(here, 'fixtures', 't14-edit.bin'))
const nestedManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't14-edit.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}

const SELF_ID = 27028096474n
const PLAYER_ID = 27061650910n
const T14_SELF_ID = 26994542042n

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
      ['process_mode', 2, 0, '', 6, 0],
    ] as unknown as DecodedVariant[]
    expect(findPropValue(props, 'counter')).toBe(42)
    expect(findPropValue(props, 'Members/counter')).toBe(42)
    expect(findPropValue(props, 'Node/path')).toBe(null)
    expect(findPropValue(props, 'missing')).toBeUndefined()
    expect(findPropValue(undefined, 'counter')).toBeUndefined()
  })

  it('resolves category-tracked display prefixes to the raw row (T13.0 fact 7)', () => {
    const props = [
      ['process_mode', 2, 0, '', 6, 0],
      ['Node/path', 22, 0, '', 6, null],
    ] as unknown as DecodedVariant[]
    // `Node/process_mode` is the display name of the raw `process_mode` row.
    expect(findPropValue(props, 'Node/process_mode')).toBe(0)
    // An exact raw name still wins over prefix stripping.
    expect(findPropValue(props, 'Node/path')).toBe(null)
  })
})

describe('parseEditPath', () => {
  it('parses plain property names and Members/-prefixed names (Phase 6 compatible)', () => {
    expect(parseEditPath('health')).toEqual([{ kind: 'prop', name: 'health' }])
    expect(parseEditPath('Members/arr')).toEqual([{ kind: 'prop', name: 'Members/arr' }])
    expect(parseEditPath('player')).toEqual([{ kind: 'prop', name: 'player' }])
  })

  it('parses container member and nested paths', () => {
    expect(parseEditPath('arr[0]')).toEqual([{ kind: 'prop', name: 'arr' }, { kind: 'index', index: 0 }])
    expect(parseEditPath('arr[0][1]')).toEqual([{ kind: 'prop', name: 'arr' }, { kind: 'index', index: 0 }, { kind: 'index', index: 1 }])
    expect(parseEditPath('dict["hp"]')).toEqual([{ kind: 'prop', name: 'dict' }, { kind: 'key', key: 'hp' }])
    expect(parseEditPath('arr[0].x')).toEqual([{ kind: 'prop', name: 'arr' }, { kind: 'index', index: 0 }, { kind: 'prop', name: 'x' }])
    expect(parseEditPath('dict["nested"]["k"]')).toEqual([
      { kind: 'prop', name: 'dict' }, { kind: 'key', key: 'nested' }, { kind: 'key', key: 'k' },
    ])
    expect(parseEditPath('a[1].b[2].c["d"]')).toEqual([
      { kind: 'prop', name: 'a' }, { kind: 'index', index: 1 }, { kind: 'prop', name: 'b' },
      { kind: 'index', index: 2 }, { kind: 'prop', name: 'c' }, { kind: 'key', key: 'd' },
    ])
  })

  it('unescapes quoted keys', () => {
    expect(parseEditPath('dict["a\\"b"]')).toEqual([{ kind: 'prop', name: 'dict' }, { kind: 'key', key: 'a"b' }])
    expect(parseEditPath('dict["a\\\\b"]')).toEqual([{ kind: 'prop', name: 'dict' }, { kind: 'key', key: 'a\\b' }])
  })

  it('rejects malformed paths', () => {
    expect(parseEditPath('arr[')).toBeNull()
    expect(parseEditPath('arr[]')).toBeNull()
    expect(parseEditPath('arr[0')).toBeNull()
    expect(parseEditPath('arr["unclosed')).toBeNull()
    expect(parseEditPath('1arr')).toBeNull()
    expect(parseEditPath('arr[-1]')).toBeNull() // negative indexes are not a path form
    expect(parseEditPath('arr[0]x')).toBeNull()
    expect(parseEditPath('')).toBeNull()
  })
})

describe('findMapEntry', () => {
  it('matches string, StringName and numeric keys by display form', () => {
    const map = new Map([
      ['hp', 100],
      [new StringName('named'), 'v'],
      [5, 'five'],
    ])
    expect(findMapEntry(map, 'hp')).toEqual({ key: 'hp', value: 100 })
    expect(findMapEntry(map, 'named')).toEqual({ key: new StringName('named'), value: 'v' })
    expect(findMapEntry(map, '5')).toEqual({ key: 5, value: 'five' })
    expect(findMapEntry(map, 'missing')).toBeUndefined()
  })

  it('matches the &\'x\' StringName display form back (T16 edit round-trip)', () => {
    const map = new Map([[new StringName('snkey'), 'v']])
    expect(findMapEntry(map, "&'snkey'")).toEqual({ key: new StringName('snkey'), value: 'v' })
    expect(findMapEntry(map, '&' )).toBeUndefined() // incomplete form
  })

  it('matches ObjectId keys by their id display form', () => {
    const map = new Map([[new ObjectId(7n), 'v']])
    expect(findMapEntry(map, '7')).toEqual({ key: new ObjectId(7n), value: 'v' })
  })
})

describe('rebuildReason', () => {
  it('accepts primitives, containers, math types and StringName', () => {
    expect(rebuildReason(42)).toBeNull()
    expect(rebuildReason('x')).toBeNull()
    expect(rebuildReason(null)).toBeNull()
    expect(rebuildReason(true)).toBeNull()
    expect(rebuildReason(new StringName('named'))).toBeNull()
    expect(rebuildReason(new Vector2(1, 2))).toBeNull()
    expect(rebuildReason(new Vector3(1, 2, 3))).toBeNull()
    expect(rebuildReason([1, 'x', null, [2, 3]])).toBeNull()
    expect(rebuildReason(new Map([['k', 1]]))).toBeNull()
    expect(rebuildReason([new Vector2(1, 2)])).toBeNull()
    expect(rebuildReason([1, 2, 3])).toBeNull() // packed arrays decode as plain arrays
  })

  it('rejects object references, raw objects and other non-rebuildable values', () => {
    expect(rebuildReason(new ObjectId(42n))).toBe('object references')
    expect(rebuildReason([new ObjectId(42n)])).toBe('object references')
    const raw = new RawObject('Node')
    expect(rebuildReason(raw)).toBe('object references')
    expect(rebuildReason(new NodePath(['a'], [], false))).toContain('non-rebuildable')
    expect(rebuildReason({ __type__: 'Callable' })).toContain('non-rebuildable')
  })
})

describe('rebuildContainer', () => {
  it('rebuilds a nested member through arrays and maps without mutating the original', () => {
    const original = [1, 2.5, 'x', null, [10, 20]]
    const rebuilt = rebuildContainer(original, [
      { kind: 'index', index: 4 },
      { kind: 'index', index: 0 },
    ], 30)
    expect(rebuilt).toEqual([1, 2.5, 'x', null, [30, 20]])
    expect(original).toEqual([1, 2.5, 'x', null, [10, 20]]) // original untouched
  })

  it('rebuilds a dict member and preserves StringName keys', () => {
    const original = new Map<string | StringName, unknown>([
      ['hp', 100],
      [new StringName('named'), 'v'],
    ])
    const rebuilt = rebuildContainer(original, [{ kind: 'key', key: 'hp' }], 50) as Map<unknown, unknown>
    expect(rebuilt.get('hp')).toBe(50)
    expect(findMapEntry(rebuilt, 'named')?.value).toBe('v') // StringName key matched by display form
    expect(original.get('hp')).toBe(100) // original untouched
  })

  it('grows an array when the last index is past the end (length follows the write)', () => {
    const rebuilt = rebuildContainer([1, 2], [{ kind: 'index', index: 2 }], 3)
    expect(rebuilt).toEqual([1, 2, 3])
  })
})

describe('valueEquals', () => {
  it('treats StringName properties as equal to the requested plain string (T14.0 fact 3)', () => {
    expect(valueEquals(new StringName('P2'), 'P2')).toBe(true)
    expect(valueEquals(new StringName('P2'), 'P3')).toBe(false)
    expect(valueEquals(new StringName('P2'), 2)).toBe(false)
  })
})

describe('applyEdits nested paths (Phase 12)', () => {
  let controller: DebugController
  let game: FakeGame

  beforeEach(() => {
    controller = new DebugController({ maxMessageBytes: 16_000_000, maxOutputBytes: 1_000_000 })
    game = new FakeGame(nestedBin, nestedManifest.frames)
  })

  afterEach(async () => {
    await game.dispose()
    await controller.dispose()
  })

  /** Connect the fake game and wait for set_pid (shared with the t6 block). */
  async function connectNestedGame(): Promise<void> {
    await controller.listen(0)
    await game.connect(controller.port)
    await controller.waitForSetPid(5_001) // distinct wait: same behavior
  }

  /** The t14 stop's object var (self only — the target resolution needs it). */
  function t14Vars(): DecodedVariant[][] {
    return [['self', 1, 24, new ObjectId(T14_SELF_ID), 'Node']]
  }

  it('applies member edits (whole-container rebuild) and nested-object property edits', async () => {
    await connectNestedGame()
    // Prime the fixture's expansion phase (self + children[0] + children[1] +
    // player — the first inspect request per id), like the product loop does.
    await expandObjects(t14Vars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 2,
      render: { maxDepth: 3, maxVarsPerScope: 200, maxValueLength: 200 },
      idleTimeoutMs: 2_000,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })
    const result = await applyEdits(
      [
        { target: 'self', property: 'arr[0]', value: '99', type: 'int' },
        { target: 'self', property: 'dict["hp"]', value: '50', type: 'int' },
        { target: 'self', property: 'arr[4][0]', value: '30', type: 'int' },
        { target: 'self', property: 'player.name', value: 'P2', type: 'string' },
      ],
      t14Vars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 20_000, signal: new AbortController().signal },
    )
    expect(result.truncated).toBe(false)
    expect(result.results.map(r => r.ok)).toEqual([true, true, true, true])
    expect(result.results[0]).toEqual({ target: 'self', property: 'arr[0]', requested: 99, type: 'int', ok: true })
  })

  it('fails a member edit whose container holds object references (gate)', async () => {
    await connectNestedGame()
    const result = await applyEdits(
      [{ target: 'self', property: 'children[0]', value: '5', type: 'int' }],
      t14Vars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 20_000, signal: new AbortController().signal },
    )
    expect(result.results[0]!.ok).toBe(false)
    expect(result.results[0]!.detail).toContain('object references')
    expect(result.truncated).toBe(true)
  })

  it('fails a path that descends into a primitive member with a readable detail', async () => {
    await connectNestedGame()
    const result = await applyEdits(
      [{ target: 'self', property: 'arr[0][1]', value: '5', type: 'int' }],
      t14Vars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 20_000, signal: new AbortController().signal },
    )
    expect(result.results[0]!.ok).toBe(false)
    expect(result.results[0]!.detail).toContain('cannot descend')
  })

  it('fails an out-of-range index with a readable detail', async () => {
    await connectNestedGame()
    const result = await applyEdits(
      [{ target: 'self', property: 'arr[9]', value: '5', type: 'int' }],
      t14Vars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 20_000, signal: new AbortController().signal },
    )
    expect(result.results[0]!.ok).toBe(false)
    expect(result.results[0]!.detail).toContain('out of range')
  })

  it('fails a missing dict key with a readable detail', async () => {
    await connectNestedGame()
    const result = await applyEdits(
      [{ target: 'self', property: 'dict["ghost"]', value: '5', type: 'int' }],
      t14Vars(),
      controller,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 20_000, signal: new AbortController().signal },
    )
    expect(result.results[0]!.ok).toBe(false)
    expect(result.results[0]!.detail).toContain('not found')
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

  it('keeps the Phase 6 shape (set → verify, no pre-inspect) for bare names', async () => {
    const sends: unknown[][] = []
    const stub = {
      send(cmd: string, params: unknown[]): void {
        sends.push([cmd, params])
      },
      async waitForMessage(): Promise<unknown[]> {
        return ['scene:inspect_object', 1, [SELF_ID, 'Node', [['Members/counter', 2, 0, '', 4100, 42]]]]
      },
    }
    const result = await applyEdits(
      [{ target: 'self', property: 'counter', value: '42', type: 'int' }],
      objectVars(),
      stub as never,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 10_000, signal: new AbortController().signal },
    )
    expect(sends.map(s => s[0])).toEqual(['scene:set_object_property', 'scene:inspect_object'])
    expect(sends[0]![1]).toEqual([SELF_ID, 'counter', 42])
    expect(result.results[0]!.ok).toBe(true)
  })

  it('resolves a category-prefixed single-segment property to its RAW label before the set (T13.0 fact 5)', async () => {
    const sends: unknown[][] = []
    let inspects = 0
    const stub = {
      send(cmd: string, params: unknown[]): void {
        sends.push([cmd, params])
      },
      async waitForMessage(): Promise<unknown[]> {
        inspects++
        // First inspect: raw resolution; second (verify): the engine's answer
        // after the write — process_priority accepted the int.
        const props = inspects === 1
          ? [['process_priority', 2, 0, '', 6, 0], ['Members/counter', 2, 0, '', 4100, 42]]
          : [['process_priority', 2, 0, '', 6, 7], ['Members/counter', 2, 0, '', 4100, 42]]
        return ['scene:inspect_object', 1, [SELF_ID, 'Node', props]]
      },
    }
    const result = await applyEdits(
      [{ target: 'self', property: 'Node/process_priority', value: '7', type: 'int' }],
      objectVars(),
      stub as never,
      { maxEdits: 10, idleTimeoutMs: 2_000, budgetMs: 10_000, signal: new AbortController().signal },
    )
    // Pre-inspect (raw label resolution) → set with the RAW name → verify.
    expect(sends.map(s => s[0])).toEqual(['scene:inspect_object', 'scene:set_object_property', 'scene:inspect_object'])
    expect(sends[1]![1]).toEqual([SELF_ID, 'process_priority', 7])
    expect(result.results[0]!.ok).toBe(true)
  })
})
