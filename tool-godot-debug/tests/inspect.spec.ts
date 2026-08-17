/**
 * Phase 5/8 expansion tests: the pure selection/parsing/id-normalization
 * functions, plus expandObjects against a DebugController + FakeGame replaying
 * the T5.0/T8.0 recordings — success, unmatched-id timeout skip, budget
 * exhaustion, disconnect propagation, cancellation, and the Phase 8 nested
 * recursion (depth cap, cross-level dedup, container paths).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DebugController } from '../src/controller.ts'
import { collectNestedIds, expandObjects, normalizeId, parseInspectProps, selectExpandableIds } from '../src/inspect.ts'
import { NodePath, ObjectId, RawObject, RID, StringName } from '../src/variants.ts'
import type { DecodedVariant } from '../src/variant-decoder.ts'
import { FakeGame } from './fixtures/fake-game.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bin = readFileSync(join(here, 'fixtures', 't5-inspect.bin'))
const manifest = JSON.parse(readFileSync(join(here, 'fixtures', 't5-inspect.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}
// The Phase 8 nested-expansion recording: self (23 props) then its nested
// ObjectIds (member_a, player, arr[0], dict["k"]) — 5 inspect round-trips.
const nestedBin = readFileSync(join(here, 'fixtures', 't8-nested.bin'))
const nestedManifest = JSON.parse(readFileSync(join(here, 'fixtures', 't8-nested.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}

const renderOptions = { maxDepth: 3, maxVarsPerScope: 200, maxValueLength: 200 }
const SELF_ID = 27028096474n
const PLAYER_ID = 27061650910n

/** The t5 stop's object vars (self/player ObjectId, r_id RID, dead null). */
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

describe('selectExpandableIds', () => {
  it('selects ObjectIds in order, deduplicates, and excludes RID/null', () => {
    const vars: DecodedVariant[][] = [
      ['self', 1, 24, new ObjectId(SELF_ID), 'Node'],
      ['dup', 1, 24, new ObjectId(SELF_ID), 'Node'],
      ['player', 1, 24, new ObjectId(PLAYER_ID), 'Node'],
      ['r_id', 1, 23, new RID(94489280512n), ''],
      ['dead', 1, 24, null, ''],
      ['num', 1, 2, 7, ''],
    ]
    expect(selectExpandableIds(vars, 10)).toEqual([
      { name: 'self', id: SELF_ID },
      { name: 'player', id: PLAYER_ID },
    ])
  })

  it('caps the selection at maxObjects', () => {
    expect(selectExpandableIds(objectVars(), 1)).toEqual([{ name: 'self', id: SELF_ID }])
    expect(selectExpandableIds(objectVars(), 0)).toEqual([])
  })
})

describe('parseInspectProps', () => {
  it('strips Members/Constants, keeps baked prefixes, and category-prefixes following bare names (2.7.0 rules)', () => {
    const props = [
      ['Members/counter', 2, 0, '', 4100, 20],
      ['Node/path', 22, 0, '', 6, new NodePath(['root', 'Main'], [], true)],
      ['Constants/MAX', 2, 0, '', 64, 100],
      ['plain', 4, 0, '', 0, 'hello'], // before any marker: bare
      ['Node', 0, 0, '', 128, null], // category marker (T13.0 fact 7): names the group
      ['process_mode', 2, 0, '', 6, 0], // bare names after the marker get the prefix
      ['process_priority', 2, 0, '', 6, 0],
    ] as unknown as DecodedVariant[]
    const { rows, truncated } = parseInspectProps(props, 10, renderOptions)
    expect(truncated).toBe(false)
    expect(rows).toEqual([
      { name: 'counter', value: '20' },
      { name: 'Node/path', value: 'NodePath(/root/Main)' },
      { name: 'MAX', value: '100' },
      { name: 'plain', value: "'hello'" },
      { name: 'Node/process_mode', value: '0' },
      { name: 'Node/process_priority', value: '0' },
    ])
  })

  it('resolves ObjectId values through the repr resolver (2.7.0 __repr__)', () => {
    const props = [
      ['Members/friend', 24, 22, '', 6, new ObjectId(99n)],
    ] as unknown as DecodedVariant[]
    const { rows } = parseInspectProps(props, 10, renderOptions, id => (id === 99n ? 'Thing(hero)' : undefined))
    expect(rows).toEqual([{ name: 'friend', value: 'Thing(hero)' }])
    const { rows: without } = parseInspectProps(props, 10, renderOptions)
    expect(without).toEqual([{ name: 'friend', value: 'Object<99>' }])
  })

  it('caps rows at maxProps and flags truncation', () => {
    const props = [
      ['a', 2, 0, '', 0, 1],
      ['b', 2, 0, '', 0, 2],
      ['c', 2, 0, '', 0, 3],
    ] as unknown as DecodedVariant[]
    const { rows, truncated } = parseInspectProps(props, 2, renderOptions)
    expect(rows).toHaveLength(2)
    expect(truncated).toBe(true)
  })

  it('skips malformed tuples defensively', () => {
    const props = [
      ['ok', 2, 0, '', 0, 1],
      ['short', 2],
      'garbage',
    ] as unknown as DecodedVariant[]
    const { rows, truncated } = parseInspectProps(props, 10, renderOptions)
    expect(rows).toEqual([{ name: 'ok', value: '1' }])
    expect(truncated).toBe(true)
  })
})

describe('normalizeId', () => {
  it('passes non-negative bigints and normalizes negatives', () => {
    expect(normalizeId(SELF_ID)).toBe(SELF_ID)
    expect(normalizeId(-1n)).toBe((1n << 64n) - 1n)
    expect(normalizeId(-1)).toBe((1n << 64n) - 1n)
    expect(normalizeId(5)).toBe(5n)
    expect(normalizeId('5')).toBeNull()
    expect(normalizeId(undefined)).toBeNull()
    expect(normalizeId(null)).toBeNull()
  })
})

describe('expandObjects', () => {
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

  it('expands every selected object with class names and rendered rows', async () => {
    await connectGame()
    const result = await expandObjects(objectVars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 1,
      render: renderOptions,
      idleTimeoutMs: 2_000,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })
    expect(result.expandedObjects).toBe(2)
    expect(result.expansionTruncated).toBe(false)
    const [self, player] = result.entries
    expect(self!.name).toBe('self')
    expect(self!.id).toBe(SELF_ID.toString())
    expect(self!.className).toBe('Node')
    expect(self!.rows.length).toBe(22) // 24 props minus 2 usage=128 category markers
    expect(player!.rows.length).toBe(16) // 17 props minus 1 category marker
  })

  it('skips an object whose id never answers (timeout) and flags truncation', async () => {
    await connectGame()
    const vars: DecodedVariant[][] = [
      ['self', 1, 24, new ObjectId(SELF_ID), 'Node'],
      ['ghost', 1, 24, new ObjectId(999999n), 'Node'], // no fixture response for this id
    ]
    const result = await expandObjects(vars, controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 1,
      render: renderOptions,
      idleTimeoutMs: 150,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })
    expect(result.expandedObjects).toBe(1)
    expect(result.entries[0]!.name).toBe('self')
    expect(result.expansionTruncated).toBe(true)
  })

  it('stops early when the budget is exhausted and keeps the partial result', async () => {
    await connectGame()
    const result = await expandObjects(objectVars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 1,
      render: renderOptions,
      idleTimeoutMs: 2_000,
      budgetMs: 0, // nothing left: skip everything
      signal: new AbortController().signal,
    })
    expect(result.expandedObjects).toBe(0)
    expect(result.expansionTruncated).toBe(true)
  })

  it('propagates a disconnect as GODOT_UNAVAILABLE', async () => {
    await connectGame()
    await game.dispose()
    await expect(expandObjects(objectVars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 1,
      render: renderOptions,
      idleTimeoutMs: 2_000,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'GODOT_UNAVAILABLE' })
  })

  it('propagates cancellation as GODOT_ABORTED', async () => {
    await connectGame()
    const controller2 = new AbortController()
    controller2.abort()
    await expect(expandObjects(objectVars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 1,
      render: renderOptions,
      idleTimeoutMs: 2_000,
      budgetMs: 10_000,
      signal: controller2.signal,
    })).rejects.toMatchObject({ code: 'GODOT_ABORTED' })
  })

  it('does not consume a stale response for a different id', async () => {
    await connectGame()
    // Prime the controller's history with a REAL self response we never wait
    // for (it would be "late" in a timeout scenario).
    controller.send('scene:inspect_object', [SELF_ID])
    await new Promise((resolve) => { setTimeout(resolve, 150) })
    // Now request a ghost id: the stale self response is in `received` but its
    // id does not match, so the wait must NOT consume it and times out.
    const vars: DecodedVariant[][] = [
      ['ghost', 1, 24, new ObjectId(999999n), 'Node'],
    ]
    const result = await expandObjects(vars, controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 1,
      render: renderOptions,
      idleTimeoutMs: 150,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })
    expect(result.expandedObjects).toBe(0)
    expect(result.expansionTruncated).toBe(true)
  })

  it('never requests RID values (excluded by selection)', async () => {
    await connectGame()
    // If a RID were requested, the fixture answers `inspect:94489280512`
    // with an empty response — assert the selection simply excludes it.
    const vars: DecodedVariant[][] = [
      ['r_id', 1, 23, new RID(94489280512n), ''],
    ]
    const result = await expandObjects(vars, controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 1,
      render: renderOptions,
      idleTimeoutMs: 500,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })
    expect(result.expandedObjects).toBe(0)
    expect(result.expansionTruncated).toBe(false)
  })
})

/** Phase 8: the nested ObjectId collector (direct/array/dict, keys skipped). */
describe('collectNestedIds', () => {
  it('collects direct ObjectIds, array elements and dictionary values with paths', () => {
    // The caller passes ONE property value with its display name as the base
    // path (T8.0 fact 6): direct ObjectId, array element, dictionary value.
    const direct = new ObjectId(1n)
    expect(collectNestedIds(direct, 'player')).toEqual([{ path: 'player', id: 1n }])
    const inArray = new ObjectId(2n)
    expect(collectNestedIds([42, inArray], 'arr')).toEqual([{ path: 'arr[1]', id: 2n }])
    const inDict = new ObjectId(3n)
    expect(collectNestedIds(new Map([['k', inDict]]), 'dict')).toEqual([{ path: 'dict["k"]', id: 3n }])
  })

  it('skips RIDs, nulls and primitives', () => {
    expect(collectNestedIds(new RID(5n), 'r')).toEqual([])
    expect(collectNestedIds(null, 'n')).toEqual([])
    expect(collectNestedIds(42, 'n')).toEqual([])
    expect(collectNestedIds('s', 'n')).toEqual([])
    expect(collectNestedIds([1, 'x', null], 'arr')).toEqual([])
  })

  it('does not traverse RawObject (inline-decoded objects, T8.0 probe rule)', () => {
    const raw = new RawObject('Node')
    raw.set('member', new ObjectId(9n))
    expect(collectNestedIds(raw, 'raw')).toEqual([])
  })

  it('does not recurse into dictionary keys (source-plugin rule, T8.0 fact 1)', () => {
    const asKey = new ObjectId(7n)
    const asValue = new ObjectId(8n)
    const dict = new Map([[asKey, asValue]])
    // Key display (T13.0 fact 3): ObjectId keys render their id, not
    // `[object Object]`; key EXPANSION is deferred (T16).
    expect(collectNestedIds(dict, 'd')).toEqual([{ path: 'd["7"]', id: 8n }])
  })

  it('renders StringName dictionary keys in the &\'x\' reference form (T16)', () => {
    const snKey = new StringName('snkey')
    const value = new ObjectId(8n)
    expect(collectNestedIds(new Map([[snKey, value]]), 'dict')).toEqual([{ path: "dict[\"&'snkey'\"]", id: 8n }])
  })
})

/** Phase 8: recursive expansion against the T8.0 recording. */
describe('expandObjects nested (Phase 8)', () => {
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

  /* oxlint-disable-next-line sonarjs/no-identical-functions -- the T5 suite
     above declares the same helper; test-local duplication is intentional. */
  async function connectGame(): Promise<void> {
    await controller.listen(0)
    await game.connect(controller.port)
    await controller.waitForSetPid(5_000)
  }

  /** The t8 stop's vars: self (whose props hold member_a/player/arr/dict). */
  function nestedVars(): DecodedVariant[][] {
    return [
      ['self', 1, 24, new ObjectId(26994542042n), 'Node'],
      ['player', 1, 24, new ObjectId(27095205344n), 'Node'],
      ['counter', 1, 2, 20, ''],
    ]
  }

  it('expands nested ObjectIds up to maxDepth with location paths', async () => {
    await connectGame()
    const result = await expandObjects(nestedVars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 2,
      render: renderOptions,
      idleTimeoutMs: 2_000,
      budgetMs: 20_000,
      signal: new AbortController().signal,
    })
    // Top level: self + player. self's nested ids (member_a, player, arr[0],
    // dict["k"]) recurse; player is deduped (already reserved top-level, T8.0
    // fact 2) — the nested children are member_a, arr[0], dict["k"].
    expect(result.expandedObjects).toBe(5)
    expect(result.expansionTruncated).toBe(false)
    const self = result.entries.find(e => e.name === 'self')
    expect(self).toBeDefined()
    const names = self!.children?.map(c => c.name) ?? []
    expect(names).toEqual(['member_a', 'arr[0]', 'dict["k"]'])
    // player appears as a top-level entry but NOT as self's child (dedup).
    expect(result.entries.some(e => e.name === 'player')).toBe(true)
    expect(self!.children?.some(c => c.name === 'player')).toBe(false)
    const arr0 = self!.children?.find(c => c.name === 'arr[0]')
    expect(arr0!.className).toBe('Node')
    expect(arr0!.rows.length).toBeGreaterThan(0)
  })

  it('depth 1 behaves like Phase 5 (no recursion)', async () => {
    await connectGame()
    const result = await expandObjects(nestedVars(), controller, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 1,
      render: renderOptions,
      idleTimeoutMs: 2_000,
      budgetMs: 20_000,
      signal: new AbortController().signal,
    })
    expect(result.expandedObjects).toBe(2)
    const self = result.entries.find(e => e.name === 'self')
    expect(self!.children).toBeUndefined()
  })
})

/** Phase 13: __repr__ display-name resolution across the fetched tree. */
describe('expandObjects repr (Phase 13)', () => {
  it('resolves __repr__ members into entry heads and object references', async () => {
    // Two canned objects: `thing` declares __repr__ (T13.0 fact 1) and holds
    // a reference to `friend`, which declares its own __repr__; the reference
    // renders the target's repr even though the row renders before the child
    // is fetched (the two-phase pipeline resolves after all fetches).
    const propsBy = new Map<bigint, unknown[]>([
      [11n, [
        ['Members/__repr__', 4, 0, '', 4100, 'Thing(hero)'],
        ['Members/some_val', 4, 0, '', 4100, 'hero'],
        ['Members/friend', 24, 22, '', 6, new ObjectId(22n)],
      ]],
      [22n, [
        ['Members/__repr__', 4, 0, '', 4100, 'Friend(buddy)'],
        ['Members/name', 4, 0, '', 0, 'plain'],
      ]],
    ])
    let lastId: bigint | null = null
    const stub = {
      send(_cmd: string, params: unknown[]): void {
        lastId = params[0] as bigint
      },
      async waitForMessage(): Promise<unknown[]> {
        const id = lastId ?? 0n
        return ['scene:inspect_object', 1, [id, 'Node', propsBy.get(id) ?? []]]
      },
    }
    const vars: DecodedVariant[][] = [
      ['thing', 1, 24, new ObjectId(11n), 'RefCounted'],
    ]
    const result = await expandObjects(vars, stub as never, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 2,
      render: renderOptions,
      idleTimeoutMs: 2_000,
      budgetMs: 20_000,
      signal: new AbortController().signal,
    })
    expect(result.expandedObjects).toBe(2)
    expect(result.expansionTruncated).toBe(false)
    const thing = result.entries[0]
    expect(thing!.repr).toBe('Thing(hero)')
    // The __repr__ row itself renders as a quoted string (normal value rules).
    expect(thing!.rows).toContainEqual({ name: '__repr__', value: "'Thing(hero)'" })
    // The reference to the expanded friend renders the FRIEND's repr.
    expect(thing!.rows).toContainEqual({ name: 'friend', value: 'Friend(buddy)' })
    const friend = thing!.children?.find(c => c.name === 'friend')
    expect(friend!.repr).toBe('Friend(buddy)')
    expect(friend!.rows).toContainEqual({ name: 'name', value: "'plain'" })
  })

  it('keeps Object<id> for objects without __repr__ and for unresolvable ids', async () => {
    const propsBy = new Map<bigint, unknown[]>([
      [11n, [
        ['Members/self_ref', 24, 22, '', 6, new ObjectId(11n)], // self-reference: deduped
        ['Members/plain', 4, 0, '', 0, 'x'],
      ]],
    ])
    let lastId: bigint | null = null
    const stub = {
      send(_cmd: string, params: unknown[]): void {
        lastId = params[0] as bigint
      },
      async waitForMessage(): Promise<unknown[]> {
        const id = lastId ?? 0n
        return ['scene:inspect_object', 1, [id, 'Node', propsBy.get(id) ?? []]]
      },
    }
    const vars: DecodedVariant[][] = [['obj', 1, 24, new ObjectId(11n), 'Node']]
    const result = await expandObjects(vars, stub as never, {
      maxObjects: 10,
      maxProps: 100,
      maxDepth: 2,
      render: renderOptions,
      idleTimeoutMs: 2_000,
      budgetMs: 20_000,
      signal: new AbortController().signal,
    })
    const obj = result.entries[0]
    expect(obj!.repr).toBeUndefined()
    expect(obj!.rows).toContainEqual({ name: 'self_ref', value: 'Object<11>' })
  })
})
