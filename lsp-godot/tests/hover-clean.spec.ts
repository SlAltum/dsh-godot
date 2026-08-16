/**
 * Godot hover markdown cleaning (plan T1.3/S1): strips the leading tab Godot
 * prepends to hover lines (a markdown code-block hazard) and the bbcode
 * residue the source plugin's response_filter handles (`br`, `codeblocks`,
 * `gdscript`, `csharp` tags, unstripped `#` headings).
 *
 * Fixtures are real responses recorded in the T0 probe (Godot 4.7; hover
 * transcript replayed from `tests/fixtures/t0-responses.json`) plus constructed
 * samples for the source-plugin bbcode paths.
 */

import { describe, expect, it } from 'vitest'
import { hoverClean } from '../src/hover-clean.ts'

/** Real Godot 4.7 hover on `Vector2.RIGHT` (native class doc, zh_CN editor). */
const VECTOR2_HOVER =
  '\t<Native> class Vector2\n\n使用浮点数坐标的 2D 向量。\n包含两个元素的结构体，可用于代表 2D 坐标或任何数值的二元组。\n使用浮点数坐标。默认情况下，这些浮点值为 32 位精度，与始终为 64 位的 `float` 并不相同。\n**注意：**在布尔语境中，如果 Vector2 等于 `Vector2(0, 0)` 则求值结果为 `false`。'

/** Real Godot 4.7 hover on `Player` (script class, T0 fixture). */
const PLAYER_HOVER =
  '\tclass Player\n\nDefined in [res://player.gd](file:///D%3A/project/player.gd)'

/** Real Godot 4.7 hover on `move` (function declaration). */
const FUNC_HOVER = '\tfunc move() -> void\n\nDefined in [res://player.gd](file:///D%3A/project/player.gd)'

describe('hoverClean', () => {
  it('strips the leading tab from every line (real Vector2 hover)', () => {
    const cleaned = hoverClean(VECTOR2_HOVER)
    expect(cleaned.startsWith('<Native> class Vector2')).toBe(true)
    expect(cleaned).not.toContain('\n\t')
    // Document body is otherwise untouched (no bbcode tags in 4.7 zh docs).
    expect(cleaned).toContain('使用浮点数坐标的 2D 向量。')
    expect(cleaned).toContain('`float`')
  })

  it('strips the leading tab from a script-class hover (real Player hover)', () => {
    const cleaned = hoverClean(PLAYER_HOVER)
    expect(cleaned.startsWith('class Player')).toBe(true)
    expect(cleaned).toContain('[res://player.gd]')
  })

  it('strips the leading tab from a function hover (real move hover)', () => {
    const cleaned = hoverClean(FUNC_HOVER)
    expect(cleaned.startsWith('func move() -> void')).toBe(true)
  })

  it('converts `br` bbcode tags to paragraph breaks', () => {
    expect(hoverClean('First paragraph`br`Second paragraph')).toBe('First paragraph\n\nSecond paragraph')
  })

  it('drops codeblocks tags and wraps gdscript/csharp blocks in fences', () => {
    const input = 'Docs\n`codeblocks`\n`gdscript`\nvar x = 1\n`/gdscript`\n`/codeblocks`\nMore\n`csharp`\nint y;\n`/csharp`'
    const cleaned = hoverClean(input)
    expect(cleaned).not.toContain('codeblocks')
    expect(cleaned).toContain('\nGDScript:\n```gdscript\nvar x = 1\n```')
    expect(cleaned).toContain('\nC#:\n```csharp\nint y;\n```')
    expect(cleaned).toContain('Docs')
    expect(cleaned).toContain('More')
  })

  it('strips unstripped markdown heading hashes the source plugin hacks around', () => {
    // The source-plugin semantics keep the space after the stripped hashes:
    // "# Heading" becomes " Heading" — no longer a markdown heading, still readable.
    expect(hoverClean('Intro\n# Not A Heading\nBody')).toBe('Intro\n Not A Heading\nBody')
    expect(hoverClean('A\n## Sub Heading\nB')).toBe('A\n Sub Heading\nB')
  })

  it('is idempotent on already-clean text', () => {
    const clean = 'plain markdown with `code` and **bold**'
    expect(hoverClean(clean)).toBe(clean)
  })

  it('handles the empty string', () => {
    expect(hoverClean('')).toBe('')
  })
})
