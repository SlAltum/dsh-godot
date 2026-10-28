/**
 * RED-BY-DESIGN reproduction of the 2026-10-27 user feedback.
 *
 * Every assertion here is stated against what the tool SHOULD do, so the suite
 * fails on the current implementation and can only go green once the defect is
 * actually fixed. It is the baseline the fix has to move, not a smoke test.
 *
 * The fixture (`tests/fixtures/stretch-repro`) is the geometry the sandbox was
 * never exercised in: a 1440 × 900 canvas, `canvas_items` stretch, rendered into
 * a 1280 × 720 window. Measured: `scale 0.8`, image 1152 × 720, screen origin x=64.
 * It reports its own geometry and its own expectations (`GEOM` / `EXPECT`
 * lines), so nothing here hardcodes a scale factor.
 *
 * Gated by `DSH_TEST_GODOT` (the Godot executable path) like the other real
 * smoke specs.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import * as ToolGodotEgo from '../src/index.ts'

const GODOT = process.env.DSH_TEST_GODOT
const FIXTURE = fileURLToPath(new URL('./fixtures/stretch-repro', import.meta.url))

/** Tolerance for one rounded edge of a scaled rect. */
const EDGE_TOLERANCE = 2

interface CallOptions {
  /** Session cwd to run the tool as; defaults to the fixture. */
  cwd?: string
}

interface ToolResultLike {
  isError: boolean
  value: unknown
  content: { type: string; text?: string }[]
}

interface Geometry {
  window: [number, number]
  canvas: [number, number]
  image: [number, number]
  reportedTexture: [number, number]
  scale: [number, number]
  screen: [number, number, number, number]
}

interface Expectation {
  ico_canvas: [number, number, number, number]
  ico_texture: [number, number, number, number]
  edge_canvas: [number, number, number, number]
  edge_texture: [number, number, number, number]
  modulate_on: [number, number, number]
}

describe.skipIf(GODOT === undefined)('REPRO: sandbox in a scaled (non-1:1) geometry', { concurrent: false }, () => {
  let ctx: Context
  const fixtureCwd = FIXTURE
  let seq = 0
  let logCursor = 0

  const call = async (name: string, args: unknown, options: CallOptions = {}): Promise<ToolResultLike> =>
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: `repro-${++seq}` as never,
      name,
      arguments: args,
      agent: { session: { header: { cwd: options.cwd ?? fixtureCwd } } } as never,
    }) as unknown as ToolResultLike

  const textOf = (result: ToolResultLike): string =>
    result.content.flatMap(block => (block.type === 'text' ? [block.text ?? ''] : [])).join('\n')

  /**
   * Read only the bytes printed since the previous call. `godot_logs` caps one
   * reply at `maxBytes` (4,096 by default) and returns a byte cursor, so a
   * single read silently truncates a chatty game. Drain to the end instead.
   */
  const readNewLogs = async (): Promise<string> => {
    const chunks: string[] = []
    for (let round = 0; round < 16; round += 1) {
      const reply = await call('godot_logs', { since: logCursor, maxBytes: 262_144 })
      const value = reply.value as { text: string; nextOffset: number }
      if (value.text !== '(no new output)' && value.text.length > 0) chunks.push(value.text)
      if (value.nextOffset === logCursor) break
      logCursor = value.nextOffset
    }
    return chunks.join('\n')
  }

  /** Last occurrence of a labelled JSON line, or `undefined`. */
  const lastJson = (text: string, label: string): unknown => {
    const marker = `${label} `
    const index = text.lastIndexOf(marker)
    if (index < 0) return undefined
    const line = text.slice(index + marker.length).split('\n')[0] ?? ''
    try {
      return JSON.parse(line) as unknown
    } catch {
      return undefined
    }
  }

  /** Ask the fixture to reprint its geometry, then read it back. */
  const measure = async (): Promise<{ geometry: Geometry; expected: Expectation }> => {
    await call('godot_key', { key: 'r' })
    await call('godot_wait', { frames: 2 })
    const text = await readNewLogs()
    const geometry = lastJson(text, 'GEOM') as Geometry | undefined
    const expected = lastJson(text, 'EXPECT') as Expectation | undefined
    expect(geometry, `fixture must print GEOM/EXPECT; read:\n${text}`).toBeDefined()
    expect(expected).toBeDefined()
    return { geometry: geometry as Geometry, expected: expected as Expectation }
  }

  /** Leave the pointer somewhere harmless so each assertion starts clean. */
  const parkPointer = async (): Promise<void> => {
    await call('godot_hover', { x: 5, y: 5 })
    await call('godot_wait', { frames: 2 })
  }

  beforeAll(async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(TimeoutPolicy)
    await ctx.plugin(ToolGodotEgo, Config({
      executable: GODOT as string,
      requestTimeoutMs: 20_000,
      importTimeoutMs: 120_000,
    }))
    const play = await call('godot_play', { path: FIXTURE, offscreen: true })
    expect(play.isError, textOf(play)).toBe(false)
  }, 180_000)

  afterAll(async () => {
    await call('godot_stop', {}).catch(() => undefined)
    await ctx.fiber.dispose()
  })

  // ---------------------------------------------------------------- rig guard

  it('RIG: the fixture runs in a geometry where the three spaces differ', async () => {
    const { geometry } = await measure()
    // Guard, not a bug assertion: if this ever fails, the rig stopped
    // reproducing and every bug test below becomes meaningless.
    expect(geometry.scale[0], 'canvas != texture pitch; fixture must stay scaled').not.toBeCloseTo(1, 3)
    expect(geometry.image[0]).not.toBe(geometry.canvas[0])
    // The reported texture size is NOT the captured image size (measured
    // 922 × 576 against 1152 × 720), so the capture side must use the image.
    expect(geometry.reportedTexture[0]).not.toBe(geometry.image[0])
    expect(geometry.screen[0]).not.toBeCloseTo(1, 3)
  })

  // ------------------------------------------------- #1 pointer injection

  it('#1 godot_hover puts the pointer ON the Control (mouse_entered fires)', async () => {
    const { expected } = await measure()
    await parkPointer()

    const before = await call('godot_node', { path: '/root/Main/Frame/Ico', props: ['modulate'] })
    expect(before.isError, textOf(before)).toBe(false)
    expect((before.value as { text: string }).text).toContain('[1, 1, 1, 1]')

    const hover = await call('godot_hover', { target: 'Ico' })
    expect(hover.isError, textOf(hover)).toBe(false)
    await call('godot_wait', { frames: 3 })

    const after = await call('godot_node', { path: '/root/Main/Frame/Ico', props: ['modulate'] })
    const [r, g, b] = expected.modulate_on
    expect(
      (after.value as { text: string }).text,
      'hover reported success but the Control never entered: the point was '
      + 'delivered in screen space while Control rects are canvas space',
    ).toContain(`[${String(r)}, ${String(g)}, ${String(b)}, 1]`)
    expect(await readNewLogs()).toContain('HOVER in')
  })

  it('#1 godot_click reports the Control that consumed the click', async () => {
    const click = await call('godot_click', { target: 'Ico' })
    expect(click.isError, textOf(click)).toBe(false)
    const hit = (click.value as { hit?: string }).hit
    expect(hit, 'click hit nothing although the target Control is under the point').toBeDefined()
    expect(hit).toContain('Ico')
  })

  // ------------------------------------------------- #5 path round-trip

  it('#5 every path godot_state lists is consumable by godot_node', async () => {
    const state = await call('godot_state', { tree: false, targets: true })
    expect(state.isError, textOf(state)).toBe(false)
    const paths = (state.value as { snapshot: string }).snapshot
      .split('\n')
      .filter(line => line.startsWith('  ') && line.includes(' ['))
      .map(line => line.trim().split(' ')[0] as string)
      .filter(path => path.length > 0)
    expect(paths.length, 'the fixture exposes several Controls').toBeGreaterThan(2)

    const failures: string[] = []
    for (const path of paths) {
      const node = await call('godot_node', { path })
      if (node.isError) failures.push(`${path} -> ${textOf(node)}`)
    }
    expect(failures, 'godot_state paths must round-trip into godot_node').toEqual([])
  })

  // ------------------------------------------------- #2 crop geometry

  /** Assert one captured dimension against the fixture's expected image pixels. */
  const expectPixels = (actual: number, expected: number, what: string): void => {
    expect(
      Math.abs(actual - expected),
      `${what}: captured ${String(actual)} image px, expected ${String(expected)} `
      + '(Control rect in canvas x image/canvas scale)',
    ).toBeLessThanOrEqual(EDGE_TOLERANCE)
  }

  it('#2 godot_see crops exactly the Control region (canvas -> image pixels)', async () => {
    const { expected } = await measure()
    const see = await call('godot_see', { target: 'Main/Frame/Ico', format: 'png' })
    expect(see.isError, textOf(see)).toBe(false)
    const value = see.value as { width: number; height: number }
    const [, , width, height] = expected.ico_texture
    expectPixels(value.width, width, 'crop width')
    expectPixels(value.height, height, 'crop height')
  })

  it('#2 godot_see clips an edge Control to its visible part', async () => {
    const { expected } = await measure()
    const see = await call('godot_see', { target: 'Main/EdgePanel', format: 'png' })
    expect(see.isError, textOf(see)).toBe(false)
    const value = see.value as { width: number; height: number }
    const [, , width, height] = expected.edge_texture
    expectPixels(value.width, width, 'visible crop width')
    expectPixels(value.height, height, 'visible crop height')
  })

  // ------------------------------------------------- #9 change detection

  it('#9 ifUnchanged detects a still scene instead of comparing frame numbers', async () => {
    await measure()
    // The previous test resized the window, and a resize changes the captured
    // image size for a few frames; one throwaway capture pins the baseline at
    // the current size so the comparison is between two equal frames.
    await call('godot_wait', { frames: 10 })
    await call('godot_see', { format: 'png' })
    const second = await call('godot_see', { format: 'png', ifUnchanged: 'skip' })
    // With `allowEval` off and no attachment store mounted, `see` still delivers
    // the pixels (as a temp file, hence the note); the verdict is what matters.
    expect(
      (second.value as { note?: string }).note,
      'the scene is static, yet the second capture was not reported unchanged; '
      + 'frame numbers advance even when no pixel changes',
    ).toContain('unchanged')
  })

  // ------------------------------------------------- #6 method call

  it('#6 godot_call invokes a method and the scene reflects it', async () => {
    const shown = await call('godot_node', { path: '/root/Main/Frame/Ico', props: ['visible'] })
    expect(shown.isError, textOf(shown)).toBe(false)
    expect((shown.value as { text: string }).text).toContain('true')

    const hidden = await call('godot_call', { path: 'Main/Frame/Ico', method: 'hide' })
    expect(hidden.isError, textOf(hidden)).toBe(false)
    expect((hidden.value as { text: string }).text).toContain('Main/Frame/Ico.hide()')
    const afterHide = await call('godot_node', { path: '/root/Main/Frame/Ico', props: ['visible'] })
    expect((afterHide.value as { text: string }).text, 'hide() must actually hide the Control').toContain('false')

    const back = await call('godot_call', { path: 'Main/Frame/Ico', method: 'show' })
    expect(back.isError, textOf(back)).toBe(false)
    const afterShow = await call('godot_node', { path: '/root/Main/Frame/Ico', props: ['visible'] })
    expect((afterShow.value as { text: string }).text).toContain('true')
  })

  it('#6 godot_call names the methods it knows when the name is wrong', async () => {
    const wrong = await call('godot_call', { path: 'Main/Frame/Ico', method: 'hdie' })
    expect(wrong.isError, 'a wrong method name must fail').toBe(true)
    expect(textOf(wrong)).toContain('no method hdie')
    expect(textOf(wrong)).toMatch(/did you mean|defined methods/)
  })

  // ------------------------------------------------- #3 missing project

  it('#3 godot_play without a project.godot reports the missing project', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ego-no-project-'))
    try {
      const play = await call('godot_play', { path: empty }, { cwd: empty })
      expect(play.isError, 'a directory without project.godot must fail').toBe(true)
      expect(textOf(play), 'the error must name the missing project.godot').toContain('project.godot')
      expect(textOf(play), 'the error must not blame the import step').not.toContain('import exited')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  // ------------------------------------------------- runtime resize (last: it leaves the window resized)

  it('survives a window resize: the scale is re-read, never cached', async () => {
    // Resizing is ordinary user behavior, and it changes canvas -> window at
    // runtime. A cached mapping or a launch-time assumption breaks here.
    const before = await measure()
    await call('godot_key', { key: 's' })
    await call('godot_wait', { frames: 3 })
    // The compositor settles the render target a few frames later; a test that
    // assumes one wait is enough would read a half-resized frame.
    let after = await measure()
    for (let attempt = 0; attempt < 6 && after.geometry.image[0] === before.geometry.image[0]; attempt += 1) {
      await call('godot_wait', { frames: 5 })
      after = await measure()
    }
    expect(after.geometry.scale[0], 'the fixture resized the window').not.toBeCloseTo(before.geometry.scale[0], 3)

    // `s` grows the window, so the same Control now occupies other image pixels.
    const see = await call('godot_see', { target: 'Main/Frame/Ico', format: 'png' })
    expect(see.isError, textOf(see)).toBe(false)
    const value = see.value as { width: number; height: number }
    const [, , width, height] = after.expected.ico_texture
    expectPixels(value.width, width, 'crop width after resize')
    expectPixels(value.height, height, 'crop height after resize')

    // Pointer injection stays in canvas space, so it must land on the Control
    // whatever the window does.
    await parkPointer()
    const hover = await call('godot_hover', { target: 'Ico' })
    expect(hover.isError, textOf(hover)).toBe(false)
    await call('godot_wait', { frames: 2 })
    const modulate = await call('godot_node', { path: '/root/Main/Frame/Ico', props: ['modulate'] })
    expect((modulate.value as { text: string }).text, 'hover after a resize').toContain('[1.6')
  })
})
