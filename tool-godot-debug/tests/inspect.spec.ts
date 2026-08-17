/**
 * Phase 5 expansion tests: the pure selection/parsing/id-normalization
 * functions, plus expandObjects against a DebugController + FakeGame replaying
 * the T5.0 recording — success, unmatched-id timeout skip, budget exhaustion,
 * disconnect propagation and cancellation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DebugController } from '../src/controller.ts'
import { expandObjects, normalizeId, parseInspectProps, selectExpandableIds } from '../src/inspect.ts'
import { NodePath, ObjectId, RID } from '../src/variants.ts'
import type { DecodedVariant } from '../src/variant-decoder.ts'
import { FakeGame } from './fixtures/fake-game.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bin = readFileSync(join(here, 'fixtures', 't5-inspect.bin'))
const manifest = JSON.parse(readFileSync(join(here, 'fixtures', 't5-inspect.json'), 'utf8')) as {
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
  it('strips Members/Constants prefixes, keeps other prefixes, skips usage=128', () => {
    const props = [
      ['Members/counter', 2, 0, '', 4100, 20],
      ['Node/path', 22, 0, '', 6, new NodePath(['root', 'Main'], [], true)],
      ['Constants/MAX', 2, 0, '', 64, 100],
      ['category', 21, 0, '', 128, null], // usage=128: grouping element, skipped
      ['plain', 4, 0, '', 0, 'hello'],
    ] as unknown as DecodedVariant[]
    const { rows, truncated } = parseInspectProps(props, 10, renderOptions)
    expect(truncated).toBe(false)
    expect(rows).toEqual([
      { name: 'counter', value: '20' },
      { name: 'Node/path', value: 'NodePath(/root/Main)' },
      { name: 'MAX', value: '100' },
      { name: 'plain', value: "'hello'" },
    ])
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
      render: renderOptions,
      idleTimeoutMs: 500,
      budgetMs: 10_000,
      signal: new AbortController().signal,
    })
    expect(result.expandedObjects).toBe(0)
    expect(result.expansionTruncated).toBe(false)
  })
})
