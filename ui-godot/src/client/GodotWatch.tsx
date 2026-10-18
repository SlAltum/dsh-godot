/** The floating Godot watch ball and its live frame panel. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { watchStreamUrl, type GodotWatchFace, type WatchSession } from './godot-watch-controller.ts'
import godotLogo from './assets/godot-logo.svg'
import css from './GodotWatch.module.css'

/** Props the renderer binds for the watch panel. */
export type GodotWatchProps = PropsLocale<'godot.watch'> & InjectFace<GodotWatchFace>

/** Ball edge in pixels. */
const BALL = 52

/** Gap between the snapped panel and the ball. */
const GAP = 12

/** Minimum distance from a viewport edge. */
const MARGIN = 8

/** Panel width; height is measured after render. */
const PANEL_WIDTH = 420

/** Persisted ball and panel positions. */
const BALL_KEY = 'dsh.godot.watch.pos'
const PANEL_KEY = 'dsh.godot.watch.panelPos'

/** One floating position in viewport pixels. */
interface Position {
  x: number
  y: number
}

/** One drag in progress. */
interface DragState {
  pointerId: number
  startX: number
  startY: number
  baseX: number
  baseY: number
}

/** Read a stored position, dropping malformed entries. */
function loadPosition(key: string): Position | undefined {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as Partial<Position>
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return undefined
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return undefined
    return { x: parsed.x, y: parsed.y }
  } catch {
    return undefined
  }
}

/** Persist a position best-effort. */
function savePosition(key: string, position: Position): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(position))
  } catch {
    // Persistence is optional; a full or blocked localStorage must not break the panel.
  }
}

/** Keep a box fully inside the viewport. */
function clampToViewport(position: Position, width: number, height: number): Position {
  return {
    x: Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, position.x)),
    y: Math.max(MARGIN, Math.min(window.innerHeight - height - MARGIN, position.y)),
  }
}

/** The ball's first position: bottom-right, clear of the composer. */
function defaultBallPosition(): Position {
  return {
    x: window.innerWidth - 18 - BALL,
    y: window.innerHeight - 104 - BALL,
  }
}

/** A floating box that can be dragged and persists where the user left it. */
function useFloatingBox(size: { readonly w: number; readonly h: number }, storageKey: string, initial: Position) {
  const [position, setPosition] = useState<Position>(() => clampToViewport(loadPosition(storageKey) ?? initial, size.w, size.h))
  const [dragging, setDragging] = useState(false)
  const positionRef = useRef(position)
  positionRef.current = position
  const drag = useRef<DragState | undefined>(undefined)
  const moved = useRef(false)

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    const interactive = target.closest('button, a, input, [role="button"]')
    if (interactive !== null && interactive !== event.currentTarget) return
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: positionRef.current.x,
      baseY: positionRef.current.y,
    }
    moved.current = false
    setDragging(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is an optimization; pointer events still arrive without it.
    }
    event.preventDefault()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = drag.current
    if (current === undefined || event.pointerId !== current.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!moved.current && Math.abs(dx) + Math.abs(dy) > 5) moved.current = true
    if (!moved.current) return
    const next = clampToViewport({ x: current.baseX + dx, y: current.baseY + dy }, size.w, size.h)
    positionRef.current = next
    setPosition(next)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = drag.current
    if (current === undefined || event.pointerId !== current.pointerId) return
    drag.current = undefined
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // A lost capture needs no compensation.
    }
    if (moved.current) savePosition(storageKey, positionRef.current)
  }

  /** Whether the last gesture moved the box; a click after a drag is ignored. */
  const consumeMoved = (): boolean => {
    const wasMoved = moved.current
    moved.current = false
    return wasMoved
  }

  return {
    position,
    setPosition,
    dragging,
    consumeMoved,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}

/** Map one session state to its short localized label. */
function stateLabel(session: WatchSession, t: GodotWatchProps['t']): string {
  if (session.state === 'ready') return t('watchRunning')
  if (session.state === 'lost') return t('watchLost')
  return session.state
}

/** Render the fixed watch ball and, when open, the live frame panel. */
export function GodotWatch({ useWatch, toggle, close, click, t }: GodotWatchProps): ReactNode {
  const state = useWatch(snapshot => snapshot)
  const session = state.sessions.find(item => item.sessionId === state.selected) ?? state.sessions[0]
  const ball = useFloatingBox({ w: BALL, h: BALL }, BALL_KEY, defaultBallPosition())
  const panel = useFloatingBox({ w: PANEL_WIDTH, h: 520 }, PANEL_KEY, { x: 0, y: 0 })
  const panelRef = useRef<HTMLElement | null>(null)
  const ballRef = useRef(ball.position)
  ballRef.current = ball.position

  // Snap the panel beside the ball each time it opens (above it, flipping below
  // near the top edge). Moving the ball later must not re-snap an open panel.
  useLayoutEffect(() => {
    if (!state.open || panelRef.current === null) return
    const element = panelRef.current
    const width = element.offsetWidth > 0 ? element.offsetWidth : PANEL_WIDTH
    const height = element.offsetHeight > 0 ? element.offsetHeight : 520
    const anchor = ballRef.current
    const x = anchor.x + BALL - width
    let y = anchor.y - height - GAP
    if (y < MARGIN) y = anchor.y + BALL + GAP
    panel.setPosition(clampToViewport({ x, y }, width, height))
  }, [state.open, session?.sessionId, state.error, state.sessions.length, panel.setPosition])

  useEffect(() => {
    const onResize = (): void => {
      ball.setPosition(current => clampToViewport(current, BALL, BALL))
      const element = panelRef.current
      panel.setPosition(current => clampToViewport(current, element?.offsetWidth ?? PANEL_WIDTH, element?.offsetHeight ?? 520))
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [ball.setPosition, panel.setPosition])

  const dot = state.error ? css.error : session === undefined ? css.idle : session.state === 'ready' ? css.ready : css.lost
  const onFrameClick = (event: MouseEvent<HTMLImageElement>): void => {
    /* v8 ignore next -- the image renders only when a session exists */
    if (session === undefined) return
    const image = event.currentTarget
    const rect = image.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const width = session.window?.[0] ?? image.naturalWidth
    const height = session.window?.[1] ?? image.naturalHeight
    if (width <= 0 || height <= 0) return
    click(
      ((event.clientX - rect.left) / rect.width) * width,
      ((event.clientY - rect.top) / rect.height) * height,
    )
  }

  return (
    <div className={css.layer}>
      {state.open
        ? (
          <section
            ref={panelRef}
            className={css.panel}
            style={{ left: `${panel.position.x}px`, top: `${panel.position.y}px` }}
            aria-label={t('watchTitle')}
          >
            <header className={`${css.head} ${panel.dragging ? css.dragging : ''}`} {...panel.handlers}>
              <img className={css.headLogo} src={godotLogo} alt="" draggable={false} />
              <span className={`${css.status} ${dot}`} aria-hidden="true" />
              <span className={css.title}>{t('watchTitle')}</span>
              {session !== undefined
                ? <span className={css.meta}>{session.sessionId.slice(0, 8)} · {stateLabel(session, t)}</span>
                : null}
              <button type="button" className={css.close} aria-label={t('watchClose')} onClick={close}>×</button>
            </header>
            <div className={css.body}>
              {state.error
                ? <p className={css.note}>{t('watchError')}</p>
                : session === undefined
                  ? <p className={css.note}>{t('watchIdle')}</p>
                  : (
                    <>
                      <img className={css.frame} src={watchStreamUrl(session.sessionId)} alt={t('watchLive')} onClick={onFrameClick} />
                      <p className={css.hint}>{t('watchHint')}</p>
                    </>
                  )}
            </div>
          </section>
        )
        : null}
      <button
        type="button"
        className={`${css.ball} ${ball.dragging ? css.dragging : ''}`}
        style={{ left: `${ball.position.x}px`, top: `${ball.position.y}px` }}
        aria-label={t('watchOpen')}
        {...ball.handlers}
        onClick={() => {
          if (ball.consumeMoved()) return
          toggle()
        }}
      >
        <span className={css.mark} aria-hidden="true">
          <img className={css.ballLogo} src={godotLogo} alt="" draggable={false} />
        </span>
        <span className={`${css.status} ${dot} ${css.badge}`} aria-hidden="true" />
      </button>
    </div>
  )
}
