/** The floating Godot watch ball and its live frame panel. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject,
} from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { watchStreamUrl, type GodotWatchFace, type WatchSession, type WatchTreeNode } from './godot-watch-controller.ts'
import { NodeTree, type TreeItemModel, type TreeLocale } from './scene/NodeTree.tsx'
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
const PANEL_WIDTH = 920

/** Panel height: the split between preview and details needs a definite box. */
const PANEL_HEIGHT = 720

/** Persisted ball and panel positions. */
const BALL_KEY = 'dsh.godot.watch.pos'
const PANEL_KEY = 'dsh.godot.watch.panelPos'
const TREE_KEY = 'dsh.godot.watch.treeWidth'
const DETAIL_KEY = 'dsh.godot.watch.detailHeight'

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

/** Read a stored pane size, dropping anything unusable. */
function loadSize(key: string): number | undefined {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Persist a pane size best-effort. */
function saveSize(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(Math.round(value)))
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

/**
 * Adapt one live tree node to a tree row.
 *
 * The sandbox bridge reports the engine class even for a scripted node, so the
 * icon is the class icon and the scene file (when the node came from one)
 * travels in the tooltip.
 * @param node - the host's node projection.
 * @returns the row model, with its children.
 */
function toModel(node: WatchTreeNode, parent = ''): TreeItemModel {
  const path = parent === '' ? node.name : `${parent}/${node.name}`
  const title = [node.name, node.className, node.scene !== '' ? node.scene : `id ${node.id}`]
    .filter(part => part !== '')
    .join('\n')
  return {
    key: `${node.id}:${node.name}`,
    name: node.name,
    subtitle: node.className,
    iconClass: node.className,
    title,
    path,
    ...(node.unique ? { unique: true } : {}),
    ...(node.script !== '' ? { script: node.script } : {}),
    children: node.children.map(child => toModel(child, path)),
  }
}

/** The row key of the node at one address, found by walking the tree. */
function selectedRowKey(nodes: readonly WatchTreeNode[], path: string | undefined, parent = ''): string | undefined {
  if (path === undefined) return undefined
  for (const node of nodes) {
    const here = parent === '' ? node.name : `${parent}/${node.name}`
    if (here === path) return `${node.id}:${node.name}`
    const inner = selectedRowKey(node.children, path, here)
    if (inner !== undefined) return inner
  }
  return undefined
}

/**
 * Hold a drag size inside its bounds. */
export function clampPaneSize(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * One draggable pane size, applied as a CSS custom property.
 *
 * The drag writes the property straight to the element instead of going through
 * React state: a scene tree of a few hundred rows re-rendering on every pointer
 * move makes the pane the preview shares lag behind the splitter.
 * @param initial - starting size in pixels.
 * @param min - smallest allowed size.
 * @param max - largest allowed size.
 * @param axis - `x` grows with the pointer (a sidebar), `y` grows against it (a bottom pane).
 * @param property - the custom property to set on `target`.
 * @param target - the element that owns the layout (the stage or the pane).
 * @returns the handlers to spread on the splitter.
 */
function usePaneSize(
  initial: number,
  min: number,
  max: number,
  axis: 'x' | 'y',
  property: string,
  target: RefObject<HTMLElement | null>,
  storageKey: string,
) {
  const drag = useRef<{ pointerId: number; start: number; base: number } | undefined>(undefined)
  const sizeRef = useRef(clampPaneSize(loadSize(storageKey) ?? initial, min, max))

  const apply = (value: number): void => {
    sizeRef.current = clampPaneSize(value, min, max)
    target.current?.style.setProperty(property, `${sizeRef.current}px`)
  }

  // The first paint has no inline property yet; write the starting size once.
  useEffect(() => { apply(sizeRef.current) }, [target])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    drag.current = {
      pointerId: event.pointerId,
      start: axis === 'x' ? event.clientX : event.clientY,
      base: sizeRef.current,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is an optimization; pointer events still arrive without it.
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = drag.current
    if (current === undefined || event.pointerId !== current.pointerId) return
    const delta = (axis === 'x' ? event.clientX : event.clientY) - current.start
    apply(current.base + (axis === 'x' ? delta : -delta))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = undefined
    saveSize(storageKey, sizeRef.current)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Releasing an uncaptured pointer is not an error worth reporting.
    }
  }

  // Double-clicking a splitter restores the default width, as editors do.
  const onDoubleClick = (): void => {
    apply(initial)
    saveSize(storageKey, sizeRef.current)
  }

  /**
   * Keyboard sizing, for a pane nobody can drag: arrows move by 8 px (24 with
   * Shift), Home and End go to the bounds.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const step = event.shiftKey ? 24 : 8
    const grow = axis === 'x' ? 'ArrowRight' : 'ArrowUp'
    const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowDown'
    let next: number
    if (event.key === grow) next = sizeRef.current + step
    else if (event.key === shrink) next = sizeRef.current - step
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    else return
    event.preventDefault()
    apply(next)
    saveSize(storageKey, sizeRef.current)
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
      onKeyDown,
    },
  }
}

/** Render the fixed watch ball and, when open, the live panel. */
export function GodotWatch({ useWatch, toggle, close, click, selectNode, t }: GodotWatchProps): ReactNode {
  const state = useWatch(snapshot => snapshot)
  const session = state.sessions.find(item => item.sessionId === state.selected) ?? state.sessions[0]
  const ball = useFloatingBox({ w: BALL, h: BALL }, BALL_KEY, defaultBallPosition())
  const panel = useFloatingBox({ w: PANEL_WIDTH, h: PANEL_HEIGHT }, PANEL_KEY, { x: 0, y: 0 })
  // The preview is the panel's subject: both side panes fold away on request and
  // can be resized by dragging their splitter.
  const [treeOpen, setTreeOpen] = useState(true)
  const [detailOpen, setDetailOpen] = useState(true)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const treeSize = usePaneSize(280, 160, 460, 'x', '--tree-w', stageRef, TREE_KEY)
  const detailSize = usePaneSize(180, 80, 420, 'y', '--detail-h', detailRef, DETAIL_KEY)
  const panelRef = useRef<HTMLElement | null>(null)
  const ballRef = useRef(ball.position)
  ballRef.current = ball.position

  // Snap the panel beside the ball each time it opens (above it, flipping below
  // near the top edge). Moving the ball later must not re-snap an open panel.
  useLayoutEffect(() => {
    if (!state.open || panelRef.current === null) return
    const element = panelRef.current
    const width = element.offsetWidth > 0 ? element.offsetWidth : PANEL_WIDTH
    const height = element.offsetHeight > 0 ? element.offsetHeight : PANEL_HEIGHT
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
      panel.setPosition(current => clampToViewport(current, element?.offsetWidth ?? PANEL_WIDTH, element?.offsetHeight ?? PANEL_HEIGHT))
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
            style={{
              left: `${panel.position.x}px`,
              top: `${panel.position.y}px`,
              width: `${PANEL_WIDTH}px`,
              height: `${PANEL_HEIGHT}px`,
            }}
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
                      <div ref={stageRef} className={css.stage}>
                        {!treeOpen && (
                          <div className={css.rail}>
                            <Tooltip label={t('watchTreeShow')}>
                              <button
                                type="button"
                                className={css.treeToggle}
                                aria-label={t('watchTreeShow')}
                                aria-expanded={false}
                                onClick={() => { setTreeOpen(true) }}
                              >
                                <IconPanelLeftOutlineRegular />
                              </button>
                            </Tooltip>
                          </div>
                        )}
                        {treeOpen && (
                          <aside className={css.treePane}>
                            <div className={css.treeHead}>
                              <span className={css.treeTitle}>{t('watchTree')}</span>
                              <Tooltip label={t('watchTreeHide')}>
                                <button
                                  type="button"
                                  className={css.treeToggle}
                                  aria-label={t('watchTreeHide')}
                                  aria-expanded
                                  onClick={() => { setTreeOpen(false) }}
                                >
                                  <IconPanelLeftOutlineRegular />
                                </button>
                              </Tooltip>
                            </div>
                            <div
                              className={css.splitterX}
                              role="separator"
                              tabIndex={0}
                              aria-orientation="vertical"
                              aria-label={t('watchResizeTree')}
                              {...treeSize.handlers}
                            />
                            <div className={css.treeBody}>
                              {state.treeError !== null && <p className={css.note}>{state.treeError}</p>}
                              {state.tree !== null && state.tree.length > 0
                                ? (
                                  <NodeTree
                                    roots={state.tree.map(root => toModel(root))}
                                    selected={selectedRowKey(state.tree, state.selectedNode)}
                                    onSelect={node => { selectNode(node.path) }}
                                    t={t as unknown as TreeLocale}
                                  />
                                )
                                : <p className={css.note}>{t('watchTreeEmpty')}</p>}
                            </div>
                          </aside>
                        )}
                        <div className={css.column}>
                        <div className={css.framePane}>
                          <img
                            className={css.frame}
                            src={watchStreamUrl(session.sessionId)}
                            alt={t('watchLive')}
                            onClick={onFrameClick}
                          />
                        </div>
                        <section
                          ref={detailRef}
                          className={detailOpen ? css.detailPane : css.detailPaneCollapsed}
                        >
                          <div
                            className={css.splitterY}
                            role="separator"
                            tabIndex={0}
                            aria-orientation="horizontal"
                            aria-label={t('watchResizeDetail')}
                            {...detailSize.handlers}
                          />
                          <button
                            type="button"
                            className={css.paneToggle}
                            aria-expanded={detailOpen}
                            onClick={() => { setDetailOpen(!detailOpen) }}
                          >
                            <span className={css.chevron} aria-hidden="true">{detailOpen ? '▾' : '▸'}</span>
                            {t('watchDetail')}
                            {state.nodeDetail === null ? '' : ` · ${state.nodeDetail.path}`}
                          </button>
                          <div className={css.detailBody}>
                            {!detailOpen ? null : state.nodeDetail === null
                              ? <p className={css.note}>{t('watchPickNode')}</p>
                              : (
                                <>
                                  <div className={css.detailHead}>
                                    <code>{state.nodeDetail.path}</code>
                                    <span className={css.meta}>{state.nodeDetail.className}</span>
                                    <span className={css.meta}>
                                      {state.nodeDetail.props.length}/{state.nodeDetail.total}
                                    </span>
                                  </div>
                                  {state.nodeDetail.error !== null
                                    ? <p className={css.note}>{state.nodeDetail.error}</p>
                                    : (
                                      <ul className={css.props}>
                                        {state.nodeDetail.props.map(prop => (
                                          <li key={prop.name}>
                                            <span className={css.propName}>{prop.name}</span>
                                            <code className={css.propValue}>{prop.value}</code>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                </>
                              )}
                          </div>
                        </section>
                        </div>
                      </div>
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
