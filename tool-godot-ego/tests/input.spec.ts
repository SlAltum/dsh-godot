/**
 * Input tools: coordinate/Control clicks, key and action injection, and waits.
 */

import { describe, expect, it, vi } from 'vitest'
import { EgoGodotError } from '../src/errors.ts'
import { GameSessionRegistry } from '../src/session-service.ts'
import { inputTools } from '../src/input.ts'

const exec = {
  agent: { session: { header: { cwd: '/ws' } } },
  signal: new AbortController().signal,
}

type Handler = (cmd: string, params: Readonly<Record<string, unknown>>) => Record<string, unknown>

async function setup(handler: Handler) {
  const calls: Array<{ cmd: string; params: Readonly<Record<string, unknown>> }> = []
  const request = vi.fn(async (cmd: string, params: Readonly<Record<string, unknown>>) => {
    calls.push({ cmd, params })
    return { kind: 'ok' as const, id: calls.length, payload: handler(cmd, params) }
  })
  const registry = new GameSessionRegistry(async () => ({
    sessionId: 's1',
    workspace: '/ws',
    pid: 1,
    dispose: async () => {},
    request,
  }))
  await registry.ensure('/ws', {})
  return { tools: inputTools(registry), calls }
}

describe('godot_click', () => {
  it('sends viewport coordinates and reports the hit', async () => {
    const { tools } = await setup((_cmd, params) => (params.double === true ? {} : { hit: 'Main/Btn', frames: 9 }))
    const value = await tools.click.execute({ x: 1, y: 2 }, exec as never)
    expect(value).toEqual({ hit: 'Main/Btn', frames: 9 })
    const block = tools.click.output.render({}, value)[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.text).toBe('hit Main/Btn · frame 9')
    const none = await tools.click.execute({ x: 0, y: 0, button: 'right', double: true }, exec as never)
    expect(none).toEqual({ frames: 0 })
    const noneBlock = tools.click.output.render({}, none)[0]
    if (noneBlock?.type !== 'text') throw new Error('expected text')
    expect(noneBlock.text).toContain('no node consumed')
  })

  it('resolves a Control path to its center', async () => {
    const { tools, calls } = await setup((cmd) => {
      if (cmd === 'state') {
        return { targets: [{ path: 'Main/Btn', class: 'Button', rect: [10, 20, 100, 40], text: '' }] }
      }
      return { frames: 3 }
    })
    const value = await tools.click.execute({ target: 'Btn' }, exec as never)
    expect(value).toEqual({ frames: 3 })
    expect(calls[1]?.params).toMatchObject({ x: 60, y: 40 })
  })

  it('rejects ambiguous and unknown targets', async () => {
    const { tools } = await setup(() => ({ targets: [] }))
    await expect(tools.click.execute({ target: 'Btn', x: 1 }, exec as never)).rejects.toThrow(/not both/)
    await expect(tools.click.execute({ target: 'Btn' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(tools.click.execute({}, exec as never)).rejects.toThrow(/requires x and y/)
  })
})

describe('godot_key', () => {
  it('taps a key by name with modifiers', async () => {
    const { tools, calls } = await setup(() => ({ frames: 5 }))
    const value = await tools.key.execute({ key: 'Space', modifiers: ['shift'] }, exec as never)
    expect(value).toEqual({ frames: 5 })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.params).toMatchObject({ keycode: 32, pressed: true, shift: true, ctrl: false })
    expect(calls[1]?.params).toMatchObject({ pressed: false })
    const block = tools.key.output.render({}, value)[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.text).toContain('keys sent')
    const bare = tools.key.output.render({}, {})[0]
    if (bare?.type !== 'text') throw new Error('expected text')
    expect(bare.text).toContain('frame 0')
  })

  it('presses a single character once when pressed is explicit', async () => {
    const { tools, calls } = await setup(() => ({}))
    const value = await tools.key.execute({ key: 'a', pressed: false }, exec as never)
    expect(value).toEqual({ frames: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params).toMatchObject({ keycode: 65, pressed: false })
    const counted = await setup(() => ({ frames: 2 }))
    await expect(counted.tools.key.execute({ key: 'b', pressed: true }, exec as never)).resolves.toEqual({ frames: 2 })
  })

  it('tolerates a tap reply without frame counters', async () => {
    let call = 0
    const { tools } = await setup(() => {
      call += 1
      return call === 1 ? { frames: 4 } : {}
    })
    await expect(tools.key.execute({ key: 'Enter' }, exec as never)).resolves.toEqual({ frames: 0 })
  })

  it('drives an InputMap action and reports whether it exists', async () => {
    const { tools } = await setup(() => ({ known: true }))
    const value = await tools.key.execute({ action: 'jump' }, exec as never)
    expect(value).toEqual({ known: true })
    await tools.key.execute({ action: 'jump', pressed: false }, exec as never)
    const known = tools.key.output.render({}, value)[0]
    if (known?.type !== 'text') throw new Error('expected text')
    expect(known.text).toContain('action exists')
    const unknown = tools.key.output.render({}, { known: false })[0]
    if (unknown?.type !== 'text') throw new Error('expected text')
    expect(unknown.text).toContain('no such InputMap action')
  })

  it('rejects an unknown key and a call with neither key nor action', async () => {
    const { tools } = await setup(() => ({}))
    await expect(tools.key.execute({ key: 'Whatever' }, exec as never)).rejects.toThrow(/unknown key/)
    await expect(tools.key.execute({}, exec as never)).rejects.toThrow(/either key or action/)
  })
})

describe('godot_wait', () => {
  it('defaults to five frames and accepts milliseconds', async () => {
    const { tools, calls } = await setup(() => ({ frames: 12 }))
    const value = await tools.wait.execute({}, exec as never)
    expect(value).toEqual({ frames: 12 })
    expect(calls[0]?.params).toEqual({ frames: 5 })
    await tools.wait.execute({ ms: 100 }, exec as never)
    expect(calls[1]?.params).toEqual({ ms: 100 })
    const missing = await setup(() => ({}))
    await expect(missing.tools.wait.execute({}, exec as never)).resolves.toEqual({ frames: 0 })
    const block = tools.wait.output.render({}, value)[0]
    if (block?.type !== 'text') throw new Error('expected text')
    expect(block.text).toBe('frame 12')
  })

  it('requires a running session', async () => {
    const tools = inputTools(new GameSessionRegistry(async () => ({ sessionId: 's', workspace: '/ws', pid: 1, dispose: async () => {}, request: async () => ({ kind: 'ok', id: 1, payload: {} }) })))
    await expect(tools.wait.execute({}, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
    await expect(tools.wait.execute({}, { ...exec, agent: undefined } as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})

/** The first text block of a render result. */
function textOf(blocks: Array<{ type: string; text?: string }>): string {
  const block = blocks[0]
  if (block?.type !== 'text' || block.text === undefined) throw new Error('expected a text block')
  return block.text
}

describe('godot_hover', () => {
  it('moves the pointer and names the Control it landed on', async () => {
    const { tools, calls } = await setup(() => ({ frames: 21, over: 'Main/Btn' }))
    const value = await tools.hover.execute({ x: 30, y: 40 }, exec as never)
    expect(value).toEqual({ x: 30, y: 40, frames: 21, over: 'Main/Btn' })
    expect(calls[0]).toEqual({ cmd: 'move', params: { x: 30, y: 40 } })
    expect(textOf(tools.hover.output.render({ x: 30, y: 40 }, value)))
      .toBe('hover at (30, 40) → over Main/Btn · frame 21')
  })

  it('reports a point that is over nothing', async () => {
    const { tools } = await setup(() => ({ frames: 3 }))
    await expect(tools.hover.execute({ x: 1, y: 2 }, exec as never)).resolves.toEqual({ x: 1, y: 2, frames: 3 })
  })

  it('resolves a Control path to its center and confirms it was reached', async () => {
    const { tools, calls } = await setup((cmd) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/Btn', class: 'Button', rect: [10, 20, 100, 40], text: '' }] }
      return { over: 'Main/Btn' }
    })
    const value = await tools.hover.execute({ target: 'Btn' }, exec as never)
    expect(value).toEqual({ x: 60, y: 40, frames: 0, over: 'Main/Btn' })
    expect(calls[1]).toEqual({ cmd: 'move', params: { x: 60, y: 40 } })
  })

  it('fails when the requested Control is not under the point', async () => {
    const { tools } = await setup((cmd) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/Btn', class: 'Button', rect: [10, 20, 100, 40], text: '' }] }
      return { over: 'Main/Panel' }
    })
    await expect(tools.hover.execute({ target: 'Btn' }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
  })

  it('fails when nothing is under the point', async () => {
    const { tools } = await setup((cmd) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/Btn', class: 'Button', rect: [10, 20, 100, 40], text: '' }] }
      return { frames: 5 }
    })
    await expect(tools.hover.execute({ target: 'Btn' }, exec as never)).rejects.toThrow(/no Control/)
  })

  it('rejects ambiguous or missing coordinates', async () => {
    const { tools } = await setup(() => ({}))
    await expect(tools.hover.execute({ x: 1, y: 2, target: 'Btn' }, exec as never)).rejects.toThrow(/not both/)
    await expect(tools.hover.execute({ x: 1 }, exec as never)).rejects.toThrow(/requires x and y/)
  })

  it('reports frame zero when the reply omits it', async () => {
    const { tools } = await setup(() => ({}))
    await expect(tools.hover.execute({ x: 0, y: 0 }, exec as never)).resolves.toEqual({ x: 0, y: 0, frames: 0 })
  })
})

describe('godot_drag', () => {
  it('defaults to eight steps and sends both points', async () => {
    const { tools, calls } = await setup(() => ({ frames: 8 }))
    const value = await tools.drag.execute({ from: [10, 20], to: [30, 40] }, exec as never)
    expect(value).toEqual({ frames: 8 })
    expect(calls[0]).toEqual({ cmd: 'drag', params: { from: [10, 20], to: [30, 40], steps: 8 } })
    expect(textOf(tools.drag.output.render({ from: [10, 20], to: [30, 40] }, value)))
      .toBe('dragged (10,20) → (30,40) in 8 steps · frame 8')
  })

  it('honors an explicit step count', async () => {
    const { tools, calls } = await setup(() => ({ frames: 4 }))
    await tools.drag.execute({ from: [0, 0], to: [5, 5], steps: 3 }, exec as never)
    expect(calls[0]?.params).toMatchObject({ steps: 3 })
    expect(textOf(tools.drag.output.render({ from: [0, 0], to: [5, 5], steps: 3 }, { frames: 4 })))
      .toContain('in 3 steps')
    const empty = await setup(() => ({}))
    await expect(empty.tools.drag.execute({ from: [0, 0], to: [1, 1] }, exec as never)).resolves.toEqual({ frames: 0 })
  })

  it('rejects malformed points and step counts', async () => {
    const { tools } = await setup(() => ({}))
    await expect(tools.drag.execute({ from: [1], to: [2, 3] }, exec as never)).rejects.toThrow(/from must be \[x, y\]/)
    await expect(tools.drag.execute({ from: [1, 2], to: [3, 4], steps: 0 }, exec as never)).rejects.toThrow(/positive integer/)
  })
})

describe('godot_scroll', () => {
  it('defaults the position and sends the wheel delta', async () => {
    const { tools, calls } = await setup(() => ({ frames: 2 }))
    const value = await tools.scroll.execute({ delta: -3 }, exec as never)
    expect(value).toEqual({ x: 0, y: 0, frames: 2 })
    expect(calls[0]).toEqual({ cmd: 'wheel', params: { x: 0, y: 0, delta: -3 } })
    expect(textOf(tools.scroll.output.render({ delta: -3 }, value))).toBe('scrolled -3 notch(es) at (0, 0) · frame 2')
    await tools.scroll.execute({ x: 7, y: 9, delta: 1 }, exec as never)
    expect(calls[1]?.params).toEqual({ x: 7, y: 9, delta: 1 })
    expect(textOf(tools.scroll.output.render({ x: 7, y: 9, delta: 1 }, { x: 7, y: 9, frames: 2 })))
      .toBe('scrolled 1 notch(es) at (7, 9) · frame 2')
    const empty = await setup(() => ({}))
    await expect(empty.tools.scroll.execute({ delta: 1 }, exec as never)).resolves.toEqual({ x: 0, y: 0, frames: 0 })
  })

  it('scrolls at a Control center', async () => {
    const { tools, calls } = await setup((cmd) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/List', class: 'ScrollContainer', rect: [0, 10, 200, 80], text: '' }] }
      return {}
    })
    await tools.scroll.execute({ target: 'List', delta: 2 }, exec as never)
    expect(calls[1]).toEqual({ cmd: 'wheel', params: { x: 100, y: 50, delta: 2 } })
  })

  it('rejects ambiguous targets and a zero delta', async () => {
    const { tools } = await setup(() => ({}))
    await expect(tools.scroll.execute({ target: 'List', x: 1, delta: 1 }, exec as never)).rejects.toThrow(/not both/)
    await expect(tools.scroll.execute({ delta: 0 }, exec as never)).rejects.toThrow(/non-zero integer/)
  })
})

describe('godot_type', () => {
  it('types text and renders its length', async () => {
    const { tools, calls } = await setup(() => ({ frames: 12 }))
    const value = await tools.type.execute({ text: 'hello' }, exec as never)
    expect(value).toEqual({ frames: 12 })
    expect(calls[0]).toEqual({ cmd: 'type', params: { text: 'hello' } })
    expect(textOf(tools.type.output.render({ text: 'hello' }, value))).toBe('typed 5 characters · frame 12')
    const empty = await setup(() => ({}))
    await expect(empty.tools.type.execute({ text: 'a' }, exec as never)).resolves.toEqual({ frames: 0 })
  })

  it('rejects empty text', async () => {
    const { tools, calls } = await setup(() => ({}))
    await expect(tools.type.execute({ text: '' }, exec as never)).rejects.toThrow(/must not be empty/)
    expect(calls).toHaveLength(0)
  })
})

describe('godot_check', () => {
  it('clicks only when the state differs and reports the result', async () => {
    let pressed = false
    const { tools, calls } = await setup((cmd, params) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/HUD/Options', class: 'CheckBox', rect: [10, 10, 100, 40], text: '' }] }
      if (cmd === 'node') {
        return { props: [{ name: 'button_pressed', value: pressed, extra: 1 }, { name: 'toggle_mode', value: true }] }
      }
      if (cmd === 'click') {
        expect(params).toMatchObject({ x: 60, y: 30, button: 'left' })
        pressed = true
        return { frames: 9 }
      }
      return {}
    })
    const value = await tools.check.execute({ target: 'Main/HUD/Options' }, exec as never)
    expect(value).toEqual({ checked: true, changed: true, frames: 9 })
    expect(textOf(tools.check.output.render({ target: 'Main/HUD/Options' }, value)))
      .toBe('Main/HUD/Options is checked')
    const callsBefore = calls.filter(call => call.cmd === 'click').length
    const again = await tools.check.execute({ target: 'Main/HUD/Options' }, exec as never)
    expect(again).toEqual({ checked: true, changed: false })
    expect(calls.filter(call => call.cmd === 'click').length).toBe(callsBefore)
    expect(textOf(tools.check.output.render({ target: 'Main/HUD/Options' }, again))).toContain('(already)')
  })

  it('reports a click that did not change the state', async () => {
    const { tools } = await setup((cmd) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/Btn', class: 'CheckBox', rect: [0, 0, 10, 10], text: '' }] }
      if (cmd === 'node') return { props: [{ name: 'button_pressed', value: false }] }
      return {}
    })
    const value = await tools.check.execute({ target: 'Main/Btn', checked: true }, exec as never)
    expect(value).toEqual({ checked: false, changed: false, frames: 0 })
    expect(textOf(tools.check.output.render({ target: 'Main/Btn', checked: true }, value))).toContain('did not change')
  })

  it('rejects non-toggle controls and missing nodes', async () => {
    const fixed = await setup((cmd) => {
      if (cmd === 'node') return { props: [{ name: 'button_pressed', value: false }, { name: 'toggle_mode', value: false }] }
      return {}
    })
    await expect(fixed.tools.check.execute({ target: 'Main/Btn' }, exec as never)).rejects.toThrow(/not a toggle Control/)

    const plain = await setup(cmd => (cmd === 'node' ? { props: [{ name: 'text', value: 'x' }] } : {}))
    await expect(plain.tools.check.execute({ target: 'Main/Btn' }, exec as never)).rejects.toThrow(/does not expose button_pressed/)

    const noProps = await setup(() => ({}))
    await expect(noProps.tools.check.execute({ target: 'Main/Btn' }, exec as never)).rejects.toThrow(/does not expose button_pressed/)

    const missing = await setup(cmd => (cmd === 'node' ? { error: 'NOT_FOUND', path: 'Nope' } : {}))
    await expect(missing.tools.check.execute({ target: 'Nope' }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
  })
})

describe('godot_fill', () => {
  it('selects all, types the replacement, and reports the verified value', async () => {
    let text = 'old'
    const { tools, calls } = await setup((cmd, params) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/HUD/NameInput', class: 'LineEdit', rect: [10, 10, 200, 30], text }] }
      if (cmd === 'node') return { props: [{ name: 'text', value: text }, { name: 7, value: 'ignored' }] }
      if (cmd === 'click') return { frames: 2 }
      if (cmd === 'key') {
        if (params.keycode === 65 && params.ctrl === true) {
          if (params.pressed === true) text = ''
        }
        return { frames: 3 }
      }
      if (cmd === 'type') {
        text = String(params.text)
        return { frames: 4 }
      }
      return {}
    })
    const value = await tools.fill.execute({ target: 'Main/HUD/NameInput', text: 'hello' }, exec as never)
    expect(value).toEqual({ text: 'hello', frames: 4 })
    expect(calls.map(call => call.cmd)).toEqual(['state', 'click', 'key', 'key', 'type', 'node'])
    expect(calls[2]?.params).toMatchObject({ keycode: 65, ctrl: true, pressed: true })
    expect(textOf(tools.fill.output.render({ target: 'Main/HUD/NameInput', text: 'hello' }, value)))
      .toBe('filled Main/HUD/NameInput with "hello"')
  })

  it('clears the field when the replacement is empty', async () => {
    let text = 'old'
    const { tools, calls } = await setup((cmd, params) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/Name', class: 'LineEdit', rect: [0, 0, 100, 20], text }] }
      if (cmd === 'node') return { props: [{ name: 'text', value: text }] }
      if (cmd === 'key') {
        if (params.keycode === 65 && params.pressed === true) text = ''
        if (params.keycode === 4194308) text = ''
        return {}
      }
      return {}
    })
    await expect(tools.fill.execute({ target: 'Main/Name', text: '' }, exec as never))
      .resolves.toEqual({ text: '', frames: 0 })
    expect(calls.some(call => call.cmd === 'type')).toBe(false)
    expect(calls.some(call => call.cmd === 'key' && call.params.keycode === 4194308)).toBe(true)
  })

  it('treats a null text value as an empty field', async () => {
    const { tools } = await setup((cmd) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/Name', class: 'LineEdit', rect: [0, 0, 10, 10], text: '' }] }
      if (cmd === 'node') return { props: [{ name: 'text', value: null }] }
      return {}
    })
    await expect(tools.fill.execute({ target: 'Main/Name', text: '' }, exec as never))
      .resolves.toMatchObject({ text: '' })
  })

  it('fails when the field does not accept the text or is not a text input', async () => {
    const ignored = await setup((cmd) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/Name', class: 'LineEdit', rect: [0, 0, 10, 10], text: 'old' }] }
      if (cmd === 'node') return { props: [{ name: 'text', value: 'old' }] }
      return {}
    })
    await expect(ignored.tools.fill.execute({ target: 'Main/Name', text: 'new' }, exec as never))
      .rejects.toThrow(/produced "old" instead of "new"/)

    const plain = await setup((cmd) => {
      if (cmd === 'state') return { targets: [{ path: 'Main/Btn', class: 'Button', rect: [0, 0, 10, 10], text: '' }] }
      if (cmd === 'node') return { props: [{ name: 'visible', value: true }] }
      return {}
    })
    await expect(plain.tools.fill.execute({ target: 'Main/Btn', text: 'new' }, exec as never))
      .rejects.toThrow(/does not expose a text property/)

    const missing = await setup(cmd => (cmd === 'node' ? { error: 'NOT_FOUND' } : {}))
    await expect(missing.tools.fill.execute({ target: 'Nope', text: 'x' }, exec as never))
      .rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
  })
})

describe('new input tools failure paths', () => {
  it('propagates bridge rejections', async () => {
    const registry = new GameSessionRegistry(async () => ({
      sessionId: 's1',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => { throw new EgoGodotError('bridge rejected the command (BAD_REQUEST): x', 'GODOT_EGO_REJECTED') },
    }))
    await registry.ensure('/ws', {})
    const tools = inputTools(registry)
    await expect(tools.hover.execute({ x: 1, y: 2 }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(tools.drag.execute({ from: [0, 0], to: [1, 1] }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(tools.scroll.execute({ delta: 1 }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(tools.type.execute({ text: 'a' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(tools.check.execute({ target: 'Main/Btn' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
    await expect(tools.fill.execute({ target: 'Main/Name', text: 'a' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_REJECTED' })
  })

  it('requires a running session for each new tool', async () => {
    const tools = inputTools(new GameSessionRegistry(async () => ({
      sessionId: 's',
      workspace: '/ws',
      pid: 1,
      dispose: async () => {},
      request: async () => ({ kind: 'ok', id: 1, payload: {} }),
    })))
    await expect(tools.hover.execute({ x: 1, y: 2 }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
    await expect(tools.drag.execute({ from: [0, 0], to: [1, 1] }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
    await expect(tools.scroll.execute({ delta: 1 }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
    await expect(tools.type.execute({ text: 'a' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
    await expect(tools.check.execute({ target: 'Main/Btn' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
    await expect(tools.fill.execute({ target: 'Main/Name', text: 'a' }, exec as never)).rejects.toMatchObject({ code: 'GODOT_EGO_NO_SESSION' })
  })
})
