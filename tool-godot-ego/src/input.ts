/**
 * Input tools: `godot_click` (coordinates or a Control path), `godot_key`,
 * `godot_type`, `godot_check`, `godot_fill`, `godot_hover`, `godot_drag`,
 * `godot_scroll`, and `godot_wait`. They only marshal arguments into bridge
 * commands; the engine owns the input pipeline and reports what consumed the
 * event. The form tools compose those commands and read the resulting property
 * back, because a game has no DOM value to inspect.
 * @module @deepseek-ai/dsh-tool-godot-ego/input
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { EgoGodotError } from './errors.ts'
import type { EgoSessionHandle, GameSessionRegistry } from './session-service.ts'
import { parseTargets } from './targets.ts'
import { keycodeOf, sessionFor } from './tool-support.ts'

/** `godot_click` arguments. */
export interface ClickArgs {
  x?: number
  y?: number
  target?: string
  button?: 'left' | 'right' | 'middle'
  double?: boolean
}

/** `godot_key` arguments. */
export interface KeyArgs {
  key?: string
  action?: string
  pressed?: boolean
  modifiers?: Array<'shift' | 'ctrl' | 'alt' | 'meta'>
}

/** `godot_wait` arguments. */
export interface WaitArgs {
  frames?: number
  ms?: number
}

/** `godot_hover` arguments. */
export interface HoverArgs {
  x?: number
  y?: number
  target?: string
}

/** `godot_drag` arguments. */
export interface DragArgs {
  from: number[]
  to: number[]
  steps?: number
}

/** `godot_scroll` arguments. */
export interface ScrollArgs {
  x?: number
  y?: number
  delta: number
  target?: string
}

/** `godot_type` arguments. */
export interface TypeArgs {
  text: string
}

/** `godot_check` arguments. */
export interface CheckArgs {
  target: string
  checked?: boolean
}

/** `godot_fill` arguments. */
export interface FillArgs {
  target: string
  text: string
}

/** Key modifiers as the bridge receives them. */
interface KeyModifiers {
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

/** No modifier is held. */
const NO_MODIFIERS: KeyModifiers = { shift: false, ctrl: false, alt: false, meta: false }

/** Validate a model-provided point and normalize it to a pair. */
function pointOf(value: number[], label: string): [number, number] {
  if (value.length !== 2) throw new Error(`${label} must be [x, y]`)
  return [value[0] as number, value[1] as number]
}

/**
 * Resolve a Control path to its viewport center through the bridge target list.
 * @param session - the running session.
 * @param target - an exact path or a trailing path segment.
 * @param signal - caller cancellation.
 * @returns the center coordinates and the canonical path that matched.
 * @throws EgoGodotError `GODOT_EGO_REJECTED` when no Control matches.
 */
async function resolveTarget(
  session: EgoSessionHandle,
  target: string,
  signal: AbortSignal | undefined,
): Promise<{ x: number; y: number; path: string }> {
  const state = await session.request('state', { tree: false, targets: true, diff: false }, signal)
  const entry = parseTargets(state.payload.targets)
    .find(candidate => candidate.path === target || candidate.path.endsWith(`/${target}`))
  if (entry === undefined) {
    throw new EgoGodotError(`no Control matched "${target}"; read godot_state for the available targets`, 'GODOT_EGO_REJECTED')
  }
  const [left, top, width, height] = entry.rect
  return { x: left + width / 2, y: top + height / 2, path: entry.path }
}

/**
 * Read named properties of one node.
 * @param session - the running session.
 * @param path - the node path.
 * @param names - property names to request.
 * @param signal - caller cancellation.
 * @returns the returned rows keyed by property name.
 * @throws EgoGodotError `GODOT_EGO_REJECTED` when the node does not exist.
 */
async function nodeProps(
  session: EgoSessionHandle,
  path: string,
  names: string[],
  signal: AbortSignal | undefined,
): Promise<Map<string, unknown>> {
  const reply = await session.request('node', { path, props: names, maxProps: names.length }, signal)
  if (typeof reply.payload.error === 'string') {
    const message = typeof reply.payload.message === 'string'
      ? reply.payload.message
      : `no node at "${path}" in the current scene`
    throw new EgoGodotError(message, 'GODOT_EGO_REJECTED')
  }
  const rows = new Map<string, unknown>()
  for (const row of Array.isArray(reply.payload.props) ? reply.payload.props : []) {
    const record = row as Record<string, unknown>
    if (typeof record.name === 'string') rows.set(record.name, record.value)
  }
  return rows
}

/**
 * Press and release one key (with modifiers) through the bridge.
 * @param session - the running session.
 * @param keycode - the Godot keycode.
 * @param modifiers - held modifiers.
 * @param signal - caller cancellation.
 * @returns the frame number reported by the release.
 */
async function tapKey(
  session: EgoSessionHandle,
  keycode: number,
  modifiers: KeyModifiers,
  signal: AbortSignal | undefined,
): Promise<number> {
  await session.request('key', { keycode, ...modifiers, pressed: true }, signal)
  const reply = await session.request('key', { keycode, ...modifiers, pressed: false }, signal)
  return typeof reply.payload.frames === 'number' ? reply.payload.frames : 0
}

/** Godot keycode for Backspace. */
const BACKSPACE = 4194308

/** Godot keycode for A. */
const KEY_A = 65

/** The input tool definitions, one per tool. */
export interface InputTools {
  readonly click: ToolDefinition
  readonly key: ToolDefinition
  readonly wait: ToolDefinition
  readonly hover: ToolDefinition
  readonly drag: ToolDefinition
  readonly scroll: ToolDefinition
  readonly type: ToolDefinition
  readonly check: ToolDefinition
  readonly fill: ToolDefinition
}

/**
 * Build the input tools.
 * @param registry - the plugin-owned session registry.
 * @returns the click, key, wait, hover, drag, scroll, type, check, and fill tool definitions.
 */
export function inputTools(registry: GameSessionRegistry): InputTools {
  const click = defineTool({
    name: 'godot_click',
    description: 'Click in the running game, by viewport coordinates or by Control path. '
      + 'A path resolves through godot_state\'s target list and clicks the Control center; the reply names the node that consumed the click.',
    parameters: {
      x: { type: 'number', description: 'Viewport x coordinate (with y), when not using target.' },
      y: { type: 'number', description: 'Viewport y coordinate (with x), when not using target.' },
      target: { type: 'string', description: 'Control path from godot_state, for example, "Main/HUD/StartButton".' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default left).' },
      double: { type: 'boolean', description: 'Send a double click.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hit: { type: 'string' },
          frames: { type: 'number', required: true },
        },
      },
      render: (_args, value: { hit?: string; frames: number }) => [{
        type: 'text',
        text: `${value.hit === undefined ? 'no node consumed the click' : `hit ${value.hit}`} · frame ${value.frames}`,
      }],
    },
    async execute(args: ClickArgs, exec) {
      const session = sessionFor(registry, exec)
      let x = args.x
      let y = args.y
      if (args.target !== undefined) {
        if (x !== undefined || y !== undefined) throw new Error('click takes either target or x/y, not both')
        const point = await resolveTarget(session, args.target, exec.signal)
        x = point.x
        y = point.y
      }
      if (typeof x !== 'number' || typeof y !== 'number') throw new Error('click requires x and y, or target')
      const reply = await session.request('click', {
        x,
        y,
        button: args.button ?? 'left',
        double: args.double === true,
      }, exec.signal)
      const hit = typeof reply.payload.hit === 'string' ? reply.payload.hit : undefined
      const frames = typeof reply.payload.frames === 'number' ? reply.payload.frames : 0
      return { ...(hit !== undefined ? { hit } : {}), frames }
    },
  })

  const key = defineTool({
    name: 'godot_key',
    description: 'Press a keyboard key (or tap it) or drive an InputMap action in the running game. '
      + 'Without pressed, the key is pressed and released; pass pressed to hold or release it explicitly.',
    parameters: {
      key: { type: 'string', description: 'Key name: a single character, Space, Enter, Escape, Tab, Backspace, Delete, or an arrow.' },
      action: { type: 'string', description: 'InputMap action name; alternative to key.' },
      pressed: { type: 'boolean', description: '`true` holds, `false` releases. Omit to tap.' },
      modifiers: {
        type: 'array',
        items: { type: 'string', enum: ['shift', 'ctrl', 'alt', 'meta'] },
        description: 'Modifier keys held during the key press.',
      },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          known: { type: 'boolean' },
          frames: { type: 'number' },
        },
      },
      render: (_args, value: { known?: boolean; frames?: number }) => [{
        type: 'text',
        text: value.known === undefined
          ? `keys sent · frame ${String(value.frames ?? 0)}`
          : value.known ? 'action exists; input sent' : 'no such InputMap action in this project',
      }],
    },
    async execute(args: KeyArgs, exec) {
      const session = sessionFor(registry, exec)
      if (args.action !== undefined) {
        const reply = await session.request('action', { name: args.action, pressed: args.pressed ?? true }, exec.signal)
        return { known: reply.payload.known === true }
      }
      if (args.key === undefined) throw new Error('key requires either key or action')
      const keycode = keycodeOf(args.key)
      if (keycode === undefined) throw new Error(`unknown key "${args.key}"; use a single character or a named key`)
      const modifiers = args.modifiers ?? []
      const event = {
        keycode,
        shift: modifiers.includes('shift'),
        ctrl: modifiers.includes('ctrl'),
        alt: modifiers.includes('alt'),
        meta: modifiers.includes('meta'),
      }
      if (args.pressed === undefined) {
        await session.request('key', { ...event, pressed: true }, exec.signal)
        const reply = await session.request('key', { ...event, pressed: false }, exec.signal)
        return { frames: typeof reply.payload.frames === 'number' ? reply.payload.frames : 0 }
      }
      const reply = await session.request('key', { ...event, pressed: args.pressed }, exec.signal)
      return { frames: typeof reply.payload.frames === 'number' ? reply.payload.frames : 0 }
    },
  })

  const wait = defineTool({
    name: 'godot_wait',
    description: 'Wait inside the running game: a number of process frames (default 5) or a wall-clock duration in milliseconds. '
      + 'Use frames after a click so the next godot_see observes the processed result.',
    parameters: {
      frames: { type: 'number', description: 'Process frames to advance (default 5).' },
      ms: { type: 'number', description: 'Wall-clock milliseconds; alternative to frames.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { frames: { type: 'number', required: true } },
      },
      render: (_args, value: { frames: number }) => [{ type: 'text', text: `frame ${value.frames}` }],
    },
    async execute(args: WaitArgs, exec) {
      const session = sessionFor(registry, exec)
      const params = args.ms !== undefined ? { ms: args.ms } : { frames: args.frames ?? 5 }
      const reply = await session.request('wait', params, exec.signal)
      return { frames: typeof reply.payload.frames === 'number' ? reply.payload.frames : 0 }
    },
  })

  const hover = defineTool({
    name: 'godot_hover',
    description: 'Move the mouse pointer over a Control (by path) or to viewport coordinates without pressing a button, '
      + 'so hover states and tooltips trigger. Combine with godot_see to confirm the hovered look.',
    parameters: {
      x: { type: 'number', description: 'Viewport x coordinate (with y), when not using target.' },
      y: { type: 'number', description: 'Viewport y coordinate (with x), when not using target.' },
      target: { type: 'string', description: 'Control path from godot_state, for example, "Main/HUD/StartButton".' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number', required: true },
          y: { type: 'number', required: true },
          frames: { type: 'number', required: true },
          over: { type: 'string' },
        },
      },
      render: (_args, value: { x: number; y: number; frames: number; over?: string }) => [{
        type: 'text',
        text: `hover at (${String(value.x)}, ${String(value.y)})`
          + (value.over === undefined ? ' → no Control there' : ` → over ${value.over}`)
          + ` · frame ${value.frames}`,
      }],
    },
    async execute(args: HoverArgs, exec) {
      const session = sessionFor(registry, exec)
      let x = args.x
      let y = args.y
      let wanted: string | undefined
      if (args.target !== undefined) {
        if (x !== undefined || y !== undefined) throw new Error('hover takes either target or x/y, not both')
        const point = await resolveTarget(session, args.target, exec.signal)
        x = point.x
        y = point.y
        wanted = point.path
      }
      if (typeof x !== 'number' || typeof y !== 'number') throw new Error('hover requires x and y, or target')
      const reply = await session.request('move', { x, y }, exec.signal)
      const over = typeof reply.payload.over === 'string' ? reply.payload.over : undefined
      const frames = typeof reply.payload.frames === 'number' ? reply.payload.frames : 0
      if (wanted !== undefined && !(over === wanted || over?.startsWith(`${wanted}/`) === true)) {
        throw new EgoGodotError(
          `hover at (${String(x)}, ${String(y)}) landed on ${over === undefined ? 'no Control' : `"${over}"`} instead of "${wanted}"`
          + '; the point may be clipped, covered, or outside the Control',
          'GODOT_EGO_REJECTED',
        )
      }
      return { x, y, frames, ...(over !== undefined ? { over } : {}) }
    },
  })

  const drag = defineTool({
    name: 'godot_drag',
    description: 'Press the left button at from, move the pointer to to in steps, and release. '
      + 'Use it for sliders, drag-and-drop, and camera pans; both points are viewport coordinates [x, y].',
    parameters: {
      from: { type: 'array', items: { type: 'number' }, required: true, description: 'Start point [x, y].' },
      to: { type: 'array', items: { type: 'number' }, required: true, description: 'End point [x, y].' },
      steps: { type: 'integer', description: 'Intermediate move events (default 8); more steps make slower gestures.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { frames: { type: 'number', required: true } },
      },
      render: (args, value: { frames: number }) => [{
        type: 'text',
        text: `dragged (${args.from.join(',')}) → (${args.to.join(',')}) in ${String(args.steps ?? 8)} steps · frame ${value.frames}`,
      }],
    },
    async execute(args: DragArgs, exec) {
      const session = sessionFor(registry, exec)
      const from = pointOf(args.from, 'from')
      const to = pointOf(args.to, 'to')
      const steps = args.steps ?? 8
      if (steps < 1) throw new Error('steps must be a positive integer')
      const reply = await session.request('drag', { from, to, steps }, exec.signal)
      return { frames: typeof reply.payload.frames === 'number' ? reply.payload.frames : 0 }
    },
  })

  const scroll = defineTool({
    name: 'godot_scroll',
    description: 'Scroll the mouse wheel at a Control center or at viewport coordinates. '
      + 'A positive delta scrolls down, a negative delta scrolls up; each unit is one wheel notch.',
    parameters: {
      x: { type: 'number', description: 'Viewport x coordinate (default 0).' },
      y: { type: 'number', description: 'Viewport y coordinate (default 0).' },
      target: { type: 'string', description: 'Control path to scroll at (overrides x/y).' },
      delta: { type: 'integer', required: true, description: 'Wheel notches: positive scrolls down, negative up.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number', required: true },
          y: { type: 'number', required: true },
          frames: { type: 'number', required: true },
        },
      },
      render: (args, value: { x: number; y: number; frames: number }) => [{
        type: 'text',
        text: `scrolled ${String(args.delta)} notch(es) at (${String(value.x)}, ${String(value.y)}) · frame ${value.frames}`,
      }],
    },
    async execute(args: ScrollArgs, exec) {
      const session = sessionFor(registry, exec)
      if (args.delta === 0) throw new Error('delta must be a non-zero integer')
      let x = args.x ?? 0
      let y = args.y ?? 0
      if (args.target !== undefined) {
        if (args.x !== undefined || args.y !== undefined) throw new Error('scroll takes either target or x/y, not both')
        const point = await resolveTarget(session, args.target, exec.signal)
        x = point.x
        y = point.y
      }
      const reply = await session.request('wheel', { x, y, delta: args.delta }, exec.signal)
      return { x, y, frames: typeof reply.payload.frames === 'number' ? reply.payload.frames : 0 }
    },
  })

  const typeText = defineTool({
    name: 'godot_type',
    description: 'Type text into the focused control of the running game, one character at a time. '
      + 'Click the input (for example, a LineEdit) first so it has focus; use godot_key for named keys and shortcuts.',
    parameters: {
      text: { type: 'string', required: true, description: 'Characters to type.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { frames: { type: 'number', required: true } },
      },
      render: (args, value: { frames: number }) => [{
        type: 'text',
        text: `typed ${String(args.text.length)} characters · frame ${value.frames}`,
      }],
    },
    async execute(args: TypeArgs, exec) {
      const session = sessionFor(registry, exec)
      if (args.text.length === 0) throw new Error('text must not be empty')
      const reply = await session.request('type', { text: args.text }, exec.signal)
      return { frames: typeof reply.payload.frames === 'number' ? reply.payload.frames : 0 }
    },
  })

  const check = defineTool({
    name: 'godot_check',
    description: 'Check or uncheck a checkbox, check button, or radio button by Control path. '
      + 'Reads button_pressed first and only clicks when the state differs, then reports the resulting state. '
      + 'Fails on a Control that is not a toggle button.',
    parameters: {
      target: { type: 'string', required: true, description: 'Control path from godot_state, for example, "Main/HUD/Options".' },
      checked: { type: 'boolean', description: '`true` checks (default), `false` unchecks.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          checked: { type: 'boolean', required: true },
          changed: { type: 'boolean', required: true },
          frames: { type: 'number' },
        },
      },
      render: (args, value: { checked: boolean; changed: boolean }) => {
        const desired = args.checked ?? true
        const note = value.changed ? '' : value.checked === desired ? ' (already)' : ' (did not change)'
        return [{
          type: 'text',
          text: `${args.target} is ${value.checked ? 'checked' : 'unchecked'}${note}`,
        }]
      },
    },
    async execute(args: CheckArgs, exec) {
      const session = sessionFor(registry, exec)
      const desired = args.checked ?? true
      const before = await nodeProps(session, args.target, ['button_pressed', 'toggle_mode'], exec.signal)
      if (!before.has('button_pressed')) {
        throw new EgoGodotError(`"${args.target}" does not expose button_pressed; it is not a checkbox or toggle button`, 'GODOT_EGO_REJECTED')
      }
      if (before.get('toggle_mode') === false) {
        throw new EgoGodotError(`"${args.target}" is not a toggle Control (toggle_mode is false)`, 'GODOT_EGO_REJECTED')
      }
      const current = before.get('button_pressed') === true
      if (current === desired) return { checked: current, changed: false }
      const point = await resolveTarget(session, args.target, exec.signal)
      const reply = await session.request('click', { x: point.x, y: point.y, button: 'left', double: false }, exec.signal)
      const after = await nodeProps(session, args.target, ['button_pressed'], exec.signal)
      const checked = after.get('button_pressed') === true
      return {
        checked,
        changed: checked !== current,
        frames: typeof reply.payload.frames === 'number' ? reply.payload.frames : 0,
      }
    },
  })

  const fill = defineTool({
    name: 'godot_fill',
    description: 'Replace the text of an input Control (LineEdit or TextEdit) by Control path: '
      + 'clicks it, selects all, types the text, and verifies the resulting value. Use godot_type to append to the caret instead.',
    parameters: {
      target: { type: 'string', required: true, description: 'Input Control path from godot_state, for example, "Main/HUD/NameInput".' },
      text: { type: 'string', required: true, description: 'Replacement text; an empty string clears the field.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          frames: { type: 'number', required: true },
        },
      },
      render: (args, value: { text: string }) => [{
        type: 'text',
        text: `filled ${args.target} with ${JSON.stringify(value.text)}`,
      }],
    },
    async execute(args: FillArgs, exec) {
      const session = sessionFor(registry, exec)
      const point = await resolveTarget(session, args.target, exec.signal)
      await session.request('click', { x: point.x, y: point.y, button: 'left', double: false }, exec.signal)
      await tapKey(session, KEY_A, { ...NO_MODIFIERS, ctrl: true }, exec.signal)
      let frames = args.text.length === 0
        ? await tapKey(session, BACKSPACE, NO_MODIFIERS, exec.signal)
        : 0
      if (args.text.length > 0) {
        const reply = await session.request('type', { text: args.text }, exec.signal)
        frames = typeof reply.payload.frames === 'number' ? reply.payload.frames : 0
      }
      const after = await nodeProps(session, args.target, ['text'], exec.signal)
      if (!after.has('text')) {
        throw new EgoGodotError(`"${args.target}" does not expose a text property; it is not a text input`, 'GODOT_EGO_REJECTED')
      }
      const value = after.get('text') === null ? '' : String(after.get('text'))
      if (value !== args.text) {
        throw new EgoGodotError(
          `filling "${args.target}" produced ${JSON.stringify(value)} instead of ${JSON.stringify(args.text)}; the field may not accept typed text`,
          'GODOT_EGO_REJECTED',
        )
      }
      return { text: value, frames }
    },
  })

  return { click, key, wait, hover, drag, scroll, type: typeText, check, fill }
}
