/**
 * Snapshot renderer: turns the protocol's stack dump and frame variables into
 * the bounded, model-facing stop snapshot. Expected renderings are anchored to
 * the T3.0 real-Godot observations (self → Object<id>, counter → 1,
 * StringName &'hero', Vector2(10, 20)) and to the source plugin's display
 * rules (toFixed(5) floats, quoted strings, Array/Dictionary shapes).
 */

import { describe, expect, it } from 'vitest'
import { ObjectId, StringName, Vector2 } from '../src/variants.ts'
import type { DecodedVariant } from '../src/variant-decoder.ts'
import { renderSnapshot, type RenderOptions } from '../src/snapshot.ts'

const options: RenderOptions = {
  maxDepth: 3,
  maxVarsPerScope: 200,
  maxValueLength: 200,
}

describe('renderSnapshot', () => {
  it('renders the stack dump frame triplets', () => {
    const dump = [6, 'res://player.gd', 10, 'run', 'res://main.gd', 7, '_ready']
    const snapshot = renderSnapshot(dump, [], options)
    expect(snapshot.frames).toEqual([
      { file: 'res://player.gd', line: 10, func: 'run' },
      { file: 'res://main.gd', line: 7, func: '_ready' },
    ])
  })

  it('handles an empty stack dump', () => {
    const snapshot = renderSnapshot([0], [], options)
    expect(snapshot.frames).toEqual([])
  })

  it('groups variables into locals/members/globals by the scope code', () => {
    const vars = [
      ['local_a', 0, 2, 1, ''],
      ['self', 1, 24, new ObjectId(27262977501n), 'Player'],
      ['GLOBAL', 2, 2, 42, ''],
    ]
    const snapshot = renderSnapshot([0], vars, options)
    expect(snapshot.scopes.locals.map(v => v.name)).toEqual(['local_a'])
    expect(snapshot.scopes.members.map(v => v.name)).toEqual(['self'])
    expect(snapshot.scopes.globals.map(v => v.name)).toEqual(['GLOBAL'])
  })

  it('renders primitives with the source plugin display rules', () => {
    const vars: DecodedVariant[][] = [
      ['i', 0, 2, 7, ''],
      ['f', 0, 3, 0.1234567, ''],
      ['b', 0, 1, true, ''],
      ['s', 0, 4, 'hello', ''],
      ['n', 0, 0, null, ''],
      ['big', 0, 2, 9007199254740993n, ''],
    ]
    const snapshot = renderSnapshot([0], vars, options)
    const byName = Object.fromEntries(snapshot.scopes.locals.map(v => [v.name, v.value]))
    expect(byName['i']).toBe('7')
    expect(byName['f']).toBe('0.12346') // toFixed(5)
    expect(byName['b']).toBe('true')
    expect(byName['s']).toBe("'hello'")
    expect(byName['n']).toBe('null')
    expect(byName['big']).toBe('9007199254740993')
  })

  it('renders typed values with type_name + stringify_value', () => {
    const vars: DecodedVariant[][] = [
      ['self', 1, 24, new ObjectId(27262977501n), 'Player'],
      ['tag', 1, 21, new StringName('hero'), ''],
      ['pos', 1, 5, new Vector2(10, 20), ''],
    ]
    const snapshot = renderSnapshot([0], vars, options)
    const byName = Object.fromEntries(snapshot.scopes.members.map(v => [v.name, v.value]))
    expect(byName['self']).toBe('Object<27262977501>')
    expect(byName['tag']).toBe("StringName'hero'")
    expect(byName['pos']).toBe('Vector2(10, 20)')
  })

  it('renders containers with bounded element previews', () => {
    const vars: DecodedVariant[][] = [
      ['arr', 0, 28, [1, 2, 3], ''],
      ['dict', 0, 27, new Map([['k', 'v']]), ''],
    ]
    const snapshot = renderSnapshot([0], vars, options)
    const byName = Object.fromEntries(snapshot.scopes.locals.map(v => [v.name, v.value]))
    expect(byName['arr']).toBe('(3) [1, 2, 3]')
    expect(byName['dict']).toBe('Dictionary(1)')
  })

  it('strips Members/ and Constants/ prefixes on non-object member names', () => {
    const vars: DecodedVariant[][] = [
      ['Members/position', 1, 5, new Vector2(1, 2), ''],
      ['Constants/MAX', 1, 2, 10, ''],
    ]
    const snapshot = renderSnapshot([0], vars, options)
    const names = snapshot.scopes.members.map(v => v.name)
    expect(names).toEqual(['position', 'MAX'])
  })

  it('caps variables per scope and flags the truncation', () => {
    const vars: DecodedVariant[][] = []
    for (let i = 0; i < 210; i++) vars.push([`v${i}`, 0, 2, i, ''])
    const snapshot = renderSnapshot([0], vars, { ...options, maxVarsPerScope: 200 })
    expect(snapshot.scopes.locals).toHaveLength(200)
    expect(snapshot.scopeTruncated.locals).toBe(true)
    expect(snapshot.scopeTruncated.members).toBe(false)
    expect(snapshot.scopeTruncated.globals).toBe(false)
  })

  it('caps rendered value length', () => {
    const vars: DecodedVariant[][] = [['s', 0, 4, 'x'.repeat(500), '']]
    const snapshot = renderSnapshot([0], vars, { ...options, maxValueLength: 100 })
    const first = snapshot.scopes.locals[0]
    expect(first).toBeDefined()
    expect(first?.value.length).toBeLessThanOrEqual(103) // 100 + ellipsis
    expect(first?.value.endsWith('…')).toBe(true)
  })

  it('skips unknown scope codes and unknown var shapes defensively', () => {
    const vars: DecodedVariant[][] = [
      ['weird_scope', 9, 2, 1, ''],
      ['no_value'],
      [42, 0, 2, 1, ''],
    ]
    const snapshot = renderSnapshot([0], vars, options)
    expect(snapshot.scopes.locals).toHaveLength(0)
    expect(snapshot.scopes.members).toHaveLength(0)
    expect(snapshot.scopes.globals).toHaveLength(0)
  })
})
