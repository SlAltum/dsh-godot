// @vitest-environment jsdom
/** What the watch ball and panel show, and the click mapping. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { GodotWatch } from '../src/client/GodotWatch.tsx'
import type { GodotWatchProps } from '../src/client/GodotWatch.tsx'
import type { GodotWatchState } from '../src/client/godot-watch-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const t = (key: keyof typeof en) => en[key]
const session = {
  sessionId: 'abcdef123456', state: 'ready', pid: 7, window: [1280, 720] as const, lostReason: null,
}

/** Render the watch panel with one snapshot and recorded actions. */
function renderWatch(state: Partial<GodotWatchState> = {}) {
  const store = createSnapshotStore<GodotWatchState>({
    sessions: [], selected: undefined, open: false, error: false, ...state,
  })
  const actions = { toggle: vi.fn(), close: vi.fn(), select: vi.fn(), click: vi.fn() }
  const props = { ...actions, t, useWatch: bindSnapshotSelector(store) } as unknown as GodotWatchProps
  render(<GodotWatch {...props} />)
  return actions
}

describe('GodotWatch', () => {
  it('always shows the ball and toggles the panel', () => {
    const actions = renderWatch()
    fireEvent.click(screen.getByRole('button', { name: en.watchOpen }))
    expect(actions.toggle).toHaveBeenCalledTimes(1)
  })

  it('shows the idle note when no session is running', () => {
    renderWatch({ open: true })
    expect(screen.getByText(en.watchIdle)).toBeTruthy()
  })

  it('shows the endpoint error note', () => {
    renderWatch({ open: true, error: true })
    expect(screen.getByText(en.watchError)).toBeTruthy()
  })

  it('streams the selected session and forwards a scaled click', () => {
    const actions = renderWatch({ open: true, sessions: [session], selected: session.sessionId })
    const image = screen.getByAltText(en.watchLive) as HTMLImageElement
    expect(image.src).toContain(`/api/godot/view?session=${session.sessionId}`)
    expect(screen.getByText(en.watchHint)).toBeTruthy()
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}),
    })
    fireEvent.click(image, { clientX: 320, clientY: 180 })
    expect(actions.click).toHaveBeenCalledWith(640, 360)
    fireEvent.click(screen.getByRole('button', { name: en.watchClose }))
    expect(actions.close).toHaveBeenCalledTimes(1)
  })

  it('falls back to the image size when the window is unknown', () => {
    const actions = renderWatch({
      open: true,
      sessions: [{ ...session, window: null }],
      selected: session.sessionId,
    })
    const image = screen.getByAltText(en.watchLive) as HTMLImageElement
    Object.defineProperty(image, 'naturalWidth', { value: 640 })
    Object.defineProperty(image, 'naturalHeight', { value: 360 })
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}),
    })
    fireEvent.click(image, { clientX: 64, clientY: 36 })
    expect(actions.click).toHaveBeenCalledWith(64, 36)
  })

  it('labels lost and unknown session states', () => {
    renderWatch({ open: true, sessions: [{ ...session, state: 'lost' }], selected: session.sessionId })
    expect(screen.getByText(new RegExp(en.watchLost))).toBeTruthy()
    cleanup()
    renderWatch({ open: true, sessions: [{ ...session, state: 'starting' }], selected: session.sessionId })
    expect(screen.getByText(/starting/)).toBeTruthy()
  })

  it('ignores a zero-sized frame', () => {
    const actions = renderWatch({ open: true, sessions: [session], selected: session.sessionId })
    const image = screen.getByAltText(en.watchLive) as HTMLImageElement
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
    })
    fireEvent.click(image, { clientX: 1, clientY: 1 })
    expect(actions.click).not.toHaveBeenCalled()
  })

  it('ignores a zero game window', () => {
    const actions = renderWatch({
      open: true,
      sessions: [{ ...session, window: [0, 0] }],
      selected: session.sessionId,
    })
    const image = screen.getByAltText(en.watchLive) as HTMLImageElement
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}),
    })
    fireEvent.click(image, { clientX: 1, clientY: 1 })
    expect(actions.click).not.toHaveBeenCalled()
  })

  it('drags the ball, ignores the click that ends a drag, and persists the spot', () => {
    const actions = renderWatch()
    const ball = screen.getByRole('button', { name: en.watchOpen })
    const initialLeft = ball.style.left
    fireEvent.pointerDown(ball, { button: 0, pointerId: 1, clientX: 900, clientY: 700 })
    fireEvent.pointerMove(ball, { pointerId: 1, clientX: 850, clientY: 650 })
    fireEvent.pointerUp(ball, { pointerId: 1, clientX: 850, clientY: 650 })

    expect(ball.style.left).not.toBe(initialLeft)
    const stored = JSON.parse(window.localStorage.getItem('dsh.godot.watch.pos') ?? '{}') as { x?: unknown; y?: unknown }
    expect(typeof stored.x).toBe('number')
    expect(typeof stored.y).toBe('number')
    fireEvent.click(ball)
    expect(actions.toggle).not.toHaveBeenCalled()
    fireEvent.click(ball)
    expect(actions.toggle).toHaveBeenCalledTimes(1)
  })

  it('ignores a sub-threshold movement and keeps the click', () => {
    const actions = renderWatch()
    const ball = screen.getByRole('button', { name: en.watchOpen })
    fireEvent.pointerDown(ball, { button: 0, pointerId: 2, clientX: 900, clientY: 700 })
    fireEvent.pointerMove(ball, { pointerId: 2, clientX: 902, clientY: 701 })
    fireEvent.pointerUp(ball, { pointerId: 2, clientX: 902, clientY: 701 })
    fireEvent.click(ball)
    expect(actions.toggle).toHaveBeenCalledTimes(1)
  })

  it('drags the panel by its header and persists that spot', () => {
    renderWatch({ open: true, sessions: [session], selected: session.sessionId })
    const title = screen.getByText(en.watchTitle)
    const header = title.parentElement as HTMLElement
    fireEvent.pointerDown(header, { button: 0, pointerId: 3, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(header, { pointerId: 3, clientX: 460, clientY: 360 })
    fireEvent.pointerUp(header, { pointerId: 3, clientX: 460, clientY: 360 })
    expect(window.localStorage.getItem('dsh.godot.watch.panelPos')).not.toBeNull()
  })

  it('flips the panel below a ball near the top edge', () => {
    window.localStorage.setItem('dsh.godot.watch.pos', JSON.stringify({ x: 100, y: 0 }))
    renderWatch({ open: true })
    const panel = screen.getByLabelText(en.watchTitle) as HTMLElement
    expect(Number.parseInt(panel.style.top, 10)).toBeGreaterThan(0)
  })

  it('clamps both boxes when the viewport resizes', () => {
    renderWatch()
    fireEvent(window, new Event('resize'))
    fireEvent(window, new Event('resize'))
    cleanup()
    renderWatch({ open: true })
    fireEvent(window, new Event('resize'))
    const panel = screen.getByLabelText(en.watchTitle) as HTMLElement
    expect(panel.style.left).toMatch(/px$/)
  })

  it('ignores malformed stored positions and a failing storage write', () => {
    window.localStorage.setItem('dsh.godot.watch.pos', '{not json')
    renderWatch()
    cleanup()
    window.localStorage.setItem('dsh.godot.watch.pos', JSON.stringify({ x: 'nope', y: 1 }))
    renderWatch()
    cleanup()
    window.localStorage.setItem('dsh.godot.watch.pos', '{"x":1e999,"y":0}')
    renderWatch()

    cleanup()
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const actions = renderWatch()
    const ball = screen.getByRole('button', { name: en.watchOpen })
    fireEvent.pointerDown(ball, { button: 0, pointerId: 4, clientX: 900, clientY: 700 })
    fireEvent.pointerMove(ball, { pointerId: 4, clientX: 850, clientY: 650 })
    fireEvent.pointerUp(ball, { pointerId: 4, clientX: 850, clientY: 650 })
    expect(actions.toggle).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('survives a browser that rejects pointer capture and stray pointer events', () => {
    renderWatch()
    const ball = screen.getByRole('button', { name: en.watchOpen })
    fireEvent.pointerMove(ball, { pointerId: 9, clientX: 1, clientY: 1 })
    fireEvent.pointerUp(ball, { pointerId: 9 })
    Object.defineProperty(ball, 'setPointerCapture', { value: () => { throw new Error('capture') } })
    Object.defineProperty(ball, 'releasePointerCapture', { value: () => { throw new Error('release') } })
    fireEvent.pointerDown(ball, { button: 0, pointerId: 5, clientX: 900, clientY: 700 })
    fireEvent.pointerMove(ball, { pointerId: 5, clientX: 850, clientY: 650 })
    fireEvent.pointerUp(ball, { pointerId: 5, clientX: 850, clientY: 650 })
    expect(ball.style.left).not.toBe('')
  })

  it('ignores a non-primary button and drags started on panel controls', () => {
    renderWatch()
    const ball = screen.getByRole('button', { name: en.watchOpen })
    fireEvent.pointerDown(ball, { button: 2, pointerId: 6, clientX: 900, clientY: 700 })
    fireEvent.pointerMove(ball, { pointerId: 6, clientX: 800, clientY: 600 })
    fireEvent.pointerUp(ball, { pointerId: 6, clientX: 800, clientY: 600 })
    expect(window.localStorage.getItem('dsh.godot.watch.pos')).toBeNull()

    cleanup()
    renderWatch({ open: true, sessions: [session], selected: session.sessionId })
    const closeButton = screen.getByRole('button', { name: en.watchClose })
    fireEvent.pointerDown(closeButton, { button: 0, pointerId: 7, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(closeButton, { pointerId: 7, clientX: 450, clientY: 350 })
    fireEvent.pointerUp(closeButton, { pointerId: 7, clientX: 450, clientY: 350 })
    expect(window.localStorage.getItem('dsh.godot.watch.panelPos')).toBeNull()
  })

  it('measures the panel before snapping when layout is available', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(420)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
    renderWatch({ open: true })
    expect(screen.getByLabelText(en.watchTitle)).toBeTruthy()
    vi.restoreAllMocks()
  })
})
