/**
 * The structured card view (T20): builds the JSON-safe, byte-bounded DebugView
 * from the execute-normalized run result. Coverage: full-detail stop selection
 * (attach `break` empty-stack alignment), null-carrier normalization, JSON
 * round-trip (lossless boundary — the view must never carry bigints),
 * truncation flags, and the two-stage byte budget cuts.
 */

import { describe, expect, it } from 'vitest'
import { structuredDebugView, VIEW_MAX_BYTES } from '../src/debug-view.ts'
import type { SceneTreeViewNode } from '../src/scene-tree.ts'
import type { StructuredDebugInput } from '../src/debug-view.ts'
import type { GodotRuntimeError } from '../src/controller.ts'
import type { ExpandedEntry } from '../src/inspect.ts'
import type { RenderScopes, SnapshotFrame } from '../src/snapshot.ts'
import type { DebugStop } from '../src/tool.ts'

/** One fixture stop with optional frames/scopes. */
function stop(
  _index: number,
  frames: SnapshotFrame[],
  scopes?: RenderScopes,
  threadId = 1,
  reason = '',
): DebugStop {
  return {
    isUserBreakpoint: frames.length === 0,
    reason,
    threadId,
    snapshot: {
      frames,
      scopes: scopes ?? { locals: [], members: [], globals: [] },
      scopeTruncated: { locals: false, members: false, globals: false },
    },
  }
}

/** Rendered scope fixture: `count` rows of `name = value` in `locals`. */
function scopesWith(locals: { name: string; value: string }[]): RenderScopes {
  return { locals, members: [], globals: [] }
}

const FRAME_MAIN: SnapshotFrame = { file: 'res://main.gd', line: 12, func: '_ready' }
const FRAME_PLAYER: SnapshotFrame = { file: 'res://player.gd', line: 8, func: '_physics_process' }

function runtimeError(file: string, line: number, error: string, warning = false): GodotRuntimeError {
  return { hr: 0, min: 0, sec: 0, msec: 0, file, func: '_process', line, error, desc: '', warning, stack: [] }
}

function nestedEntry(name: string, id: string): ExpandedEntry {
  return {
    name,
    id,
    className: 'Node2D',
    repr: 'Player',
    rows: [{ name: 'position', value: '(10, 20)' }],
    children: [{ name: 'arr[0]', id: '42', className: 'RefCounted', rows: [] }],
  }
}

type InputOverrides = Partial<Omit<StructuredDebugInput, 'sceneTrees' | 'expansion' | 'edits' | 'exit'>> & {
  sceneTrees?: StructuredDebugInput['sceneTrees'] | undefined
  expansion?: StructuredDebugInput['expansion'] | undefined
  edits?: StructuredDebugInput['edits'] | undefined
  exit?: StructuredDebugInput['exit'] | undefined
}

/** The canonical fixture input: two frame-bearing stops + every carrier.
 *  An override of `undefined` omits the carrier (absent, not empty). */
function input(overrides: InputOverrides = {}): StructuredDebugInput {
  const base: StructuredDebugInput = {
    stops: [
      stop(0, [FRAME_MAIN], scopesWith([{ name: 'counter', value: '779' }]), 1, ''),
      stop(1, [FRAME_PLAYER], scopesWith([{ name: 'speed', value: '300' }]), 7, 'error'),
    ],
    output: ['counter=779'],
    errors: [runtimeError('res://main.gd', 12, 'the error', false)],
    detached: false,
    expansion: { stopIndex: 0, expandedObjects: 2, entries: [nestedEntry('player', '7')] },
    edits: { stopIndex: 0, results: [{ target: 'counter', property: 'value', requested: 779, type: 'int', ok: true }] },
    sceneTrees: [
      { stopIndex: 0, nodes: [viewNode('root', 'Window', '1', [viewNode('Main', 'Node2D', '7', [])])] },
      { stopIndex: 1, nodes: [viewNode('root', 'Window', '1', [])] },
    ],
    exit: { exitCode: 0 },
    expandedObjects: 2,
    expansionTruncated: false,
    editsApplied: 1,
    editsTruncated: false,
    sceneTreeCount: 2,
    sceneTreeTruncated: false,
    outputTruncated: false,
    varsTruncated: false,
  }
  const merged = { ...base, ...overrides } as StructuredDebugInput & InputOverrides
  // `undefined` in an override means the carrier is ABSENT from the fixture
  // input (not merely empty): the destructure drops it, and each carrier comes
  // back only when it holds a value.
  const { sceneTrees, expansion, edits, exit, ...rest } = merged
  const result: StructuredDebugInput = { ...rest }
  if (sceneTrees !== undefined) result.sceneTrees = sceneTrees
  if (expansion !== undefined) result.expansion = expansion
  if (edits !== undefined) result.edits = edits
  if (exit !== undefined) result.exit = exit
  return result
}

/** One JSON-safe scene node, shaped like the tool result's tree. */
function viewNode(
  name: string,
  className: string,
  id: string,
  children: SceneTreeViewNode[],
): SceneTreeViewNode {
  return { name, className, id, sceneFilePath: '', children }
}

describe('structuredDebugView', () => {
  it('builds the full view with the first frame-bearing stop carrying the scope lines', () => {
    const view = structuredDebugView(input(), 10)
    expect(view.version).toBe(1)
    expect(view.maxStops).toBe(10)
    expect(view.stopCount).toBe(2)
    expect(view.detached).toBe(false)
    // Full detail on stop 0 (first with frames): scope lines + truncation flags.
    expect(view.stops[0]!.varsLines).toEqual(['  locals:', '    counter = 779'])
    expect(view.stops[0]!.scopeTruncated).toEqual({ locals: false, members: false, globals: false })
    // The card keeps the parsed tree (ids stringified so the view stays JSON).
    expect(view.stops[0]!.sceneTree?.nodes[0]).toMatchObject({ name: 'root', className: 'Window', id: '1' })
    expect(view.stops[0]!.sceneTree?.nodes[0]?.children[0]).toMatchObject({ name: 'Main', className: 'Node2D', id: '7' })
    // Stop 1: frames only, no scope lines (size parity).
    expect(view.stops[1]!.varsLines).toBeUndefined()
    expect(view.stops[1]!.frames).toEqual([{ file: 'res://player.gd', line: 8, func: '_physics_process' }])
    expect(view.stops[1]!.sceneTree?.nodes[0]?.children).toEqual([])
    // Structured carriers keep their stop linkage.
    expect(view.expansion).toEqual({
      stopIndex: 0, expandedObjects: 2, truncated: false,
      entries: [nestedEntry('player', '7')],
    })
    expect(view.edits).toEqual({
      stopIndex: 0, truncated: false,
      results: [{ target: 'counter', property: 'value', requested: 779, type: 'int', ok: true }],
    })
    expect(view.exit).toEqual({ exitCode: 0 })
    // Rendered, bounded output/errors.
    expect(view.outputTail).toEqual(['counter=779'])
    expect(view.errors).toEqual(['res://main.gd:12 error: the error'])
    expect(view.viewTruncated).toBe(false)
  })

  it('moves the detail to the first real stop after an empty-stack break pause (attach alignment)', () => {
    const view = structuredDebugView(input({
      stops: [
        stop(0, [], undefined, 1, 'break'), // attach `break`: empty engine stack
        stop(1, [FRAME_MAIN], scopesWith([{ name: 'counter', value: '1' }])),
      ],
    }), 10)
    expect(view.stops[0]!.varsLines).toBeUndefined()
    expect(view.stops[0]!.frames).toEqual([])
    expect(view.stops[1]!.varsLines).toEqual(['  locals:', '    counter = 1'])
  })

  it('falls back to stop 0 when no stop has a frame (detail stop = text parity)', () => {
    const view = structuredDebugView(input({
      stops: [stop(0, [], scopesWith([{ name: 'x', value: '1' }]))],
      sceneTrees: undefined,
      expansion: undefined,
      edits: undefined,
      exit: undefined,
    }), 10)
    expect(view.stops[0]!.varsLines).toEqual(['  locals:', '    x = 1'])
    expect(view.expansion).toBeUndefined()
    expect(view.edits).toBeUndefined()
    expect(view.exit).toBeUndefined()
  })

  it('omits absent carriers entirely and passes every truncation flag through', () => {
    const view = structuredDebugView(input({
      stops: [stop(0, [FRAME_MAIN], scopesWith([]))],
      expansion: undefined, edits: undefined, sceneTrees: undefined, exit: undefined,
      expandedObjects: 0, expansionTruncated: true,
      editsApplied: 0, editsTruncated: true,
      sceneTreeCount: 0, sceneTreeTruncated: true,
      outputTruncated: true, varsTruncated: true,
      detached: true,
    }), 3)
    expect(view.detached).toBe(true)
    expect(view.expansion).toBeUndefined()
    expect(view.edits).toBeUndefined()
    expect(view.exit).toBeUndefined()
    expect(view.expansionTruncated).toBe(true)
    expect(view.editsTruncated).toBe(true)
    expect(view.sceneTreeTruncated).toBe(true)
    expect(view.outputTruncated).toBe(true)
    expect(view.varsTruncated).toBe(true)
    expect(view.maxStops).toBe(3)
  })

  it('round-trips through JSON losslessly (no bigints, no cycles — H1/H4 boundary)', () => {
    const view = structuredDebugView(input(), 10)
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })

  it('bounds output and error tails like the text report', () => {
    const many = Array.from({ length: 100 }, (_, i) => `line ${i}`)
    const errors = Array.from({ length: 20 }, (_, i) => runtimeError('res://main.gd', i, `err ${i}`))
    const view = structuredDebugView(input({ stops: [], output: many, errors, sceneTrees: undefined }), 10)
    expect(view.outputTail).toHaveLength(20)
    expect(view.outputTail[19]!).toBe('line 19')
    expect(view.errors).toHaveLength(5)
    expect(view.errors[4]!).toBe('res://main.gd:4 error: err 4')
  })

  it('cuts the scope lines first when the serialized view exceeds the byte budget', () => {
    // ~2000 rows × ~170 chars ≈ 340KB of scope lines: over the 256KB budget.
    const locals = Array.from({ length: 2000 }, (_, i) => ({ name: `v${i}`, value: 'x'.repeat(160) }))
    const view = structuredDebugView(input({
      stops: [stop(0, [FRAME_MAIN], scopesWith(locals))],
      sceneTrees: undefined,
    }), 10)
    expect(view.viewTruncated).toBe(true)
    expect(view.stops[0]!.varsLines).toBeUndefined()
    expect(view.stops[0]!.scopeTruncated).toBeUndefined()
    // Frames survive the first cut.
    expect(view.stops[0]!.frames).toEqual([{ file: 'res://main.gd', line: 12, func: '_ready' }])
    expect(view.viewCut).toBe('vars')
  })

  it('keeps the detail when the view fits under the budget (no false truncation)', () => {
    const view = structuredDebugView(input(), 10)
    expect(view.viewTruncated).toBe(false)
    expect(view.stops[0]!.varsLines).toEqual(['  locals:', '    counter = 779'])
    expect(JSON.stringify(view).length).toBeLessThan(VIEW_MAX_BYTES)
  })
  it('cuts the sample nesting first, and says so', () => {
    // A deep sample is the usual overflow: 100 nested objects with 30 rows each.
    const children = Array.from({ length: 100 }, (_, c) => ({
      name: `arr[${c}]`,
      id: String(100 + c),
      className: 'Node',
      rows: Array.from({ length: 30 }, (_, r) => ({ name: `p${r}`, value: 'x'.repeat(120) })),
    }))
    const view = structuredDebugView(input({
      stops: [stop(0, [FRAME_MAIN], scopesWith([]))],
      expansion: { stopIndex: 0, expandedObjects: 101, entries: [{ name: 'self', id: '1', className: 'Control', rows: [], children }] },
    }), 10)
    expect(view.viewTruncated).toBe(true)
    expect(view.viewCut).toBe('expansionChildren')
    // The run's slice survives; the sampled object keeps its own rows.
    expect(view.stops[0]!.sceneTree?.nodes).toHaveLength(1)
    expect(view.expansion?.entries[0]?.name).toBe('self')
    expect(view.expansion?.entries[0]?.children).toBeUndefined()
  })

  it('drops the whole sample before it touches the tree', () => {
    // Roots alone overflow the budget: the sample goes, the tree stays.
    const entries = Array.from({ length: 40 }, (_, i) => ({
      name: `obj${i}`,
      id: String(i),
      className: 'Node',
      rows: Array.from({ length: 100 }, (_, r) => ({ name: `p${r}`, value: 'x'.repeat(120) })),
    }))
    const view = structuredDebugView(input({
      stops: [stop(0, [FRAME_MAIN], scopesWith([]))],
      expansion: { stopIndex: 0, expandedObjects: 40, entries },
    }), 10)
    expect(view.viewCut).toBe('expansion')
    expect(view.expansion).toBeUndefined()
    expect(view.stops[0]!.sceneTree?.nodes).toHaveLength(1)
    expect(view.stops[0]!.frames).toHaveLength(1)
  })

  it('carries the per-stop tree bound into the stop', () => {
    const view = structuredDebugView(input({
      sceneTrees: [
        { stopIndex: 0, nodes: [viewNode('root', 'Window', '1', [])], truncated: true },
        { stopIndex: 1, nodes: [viewNode('root', 'Window', '1', [])] },
      ],
    }), 10)
    expect(view.stops[0]!.sceneTree?.truncated).toBe(true)
    expect(view.stops[1]!.sceneTree?.truncated).toBeUndefined()
  })
})
