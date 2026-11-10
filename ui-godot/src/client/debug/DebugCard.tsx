/** The `godot_debug` card: where the run paused, and what the stop saw. */

import { Component, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DisclosureRow, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import godotLogo from '../assets/godot-logo.svg'
import css from './DebugCard.module.css'
import { NodeTree, type TreeItemModel, type TreeLocale } from '../scene/NodeTree.tsx'
import {
  asDebugView, callArgs, callText, entryChildren, entryRows, type DebugView,
  type DebugCallBlock,
  type DebugSceneNode, type DebugViewEntry, type DebugViewStop,
} from './debug-view.ts'

/** Rows shown per object before the card says how many it held back. */
const ROW_LIMIT = 12

/** The tree's labels, from the card's own namespace. */
function treeLocale(t: DebugCardProps['t']): TreeLocale {
  return {
    sceneScript: t('sceneScript'),
    sceneInstance: t('sceneInstance'),
    sceneUnique: t('sceneUnique'),
    sceneCollapse: t('sceneCollapse'),
    sceneExpand: t('sceneExpand'),
  }
}

/** The Godot mark as a mask, so it takes the row's icon colour. */
const GODOT_MASK = {
  maskImage: `url("${godotLogo}")`,
  WebkitMaskImage: `url("${godotLogo}")`,
} as const

/**
 * Keeps a broken report from taking the row with it.
 *
 * A throw inside the expanded content unmounts the slot's subtree, which in the
 * transcript looks like "click and the row disappears" with nothing to read. The
 * report is wrapped in this boundary so the row and its summary survive, and the
 * failure is logged where it can be seen.
 */
class ReportGuard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean; message: string }> {
  override state = { failed: false, message: '' }

  static getDerivedStateFromError(error: unknown): { failed: boolean; message: string } {
    return { failed: true, message: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: unknown): void {
    console.error('[godot_debug] the card report failed to render', error)
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <>
        <p className={css.bad}>report failed: {this.state.message}</p>
        {this.props.fallback}
      </>
    )
  }
}

/** Props the renderer binds for the debug card. */
export type DebugCardProps =
  PropsLocale<'godot.debug'>
  & {
    /** The tool call's settled (or running) block. */
    readonly block?: unknown
    /** Wire tool name: `godot_debug`. */
    readonly toolName?: string
    /** The call this card belongs to; the fold state is kept per call. */
    readonly callId?: string
    /** The shell's own inspector for this call (the "inspect" action). */
    readonly inspect?: (() => void) | undefined
  }

/**
 * Adapt one scene-tree node of a stop to a tree row.
 *
 * The protocol reports a scripted node's class as the script path (`res://…`),
 * so such a node draws the script glyph and shows the path as its class text.
 */
function toModel(node: DebugSceneNode, parent = '', captured: ReadonlySet<string> = new Set()): TreeItemModel {
  const scripted = node.className.startsWith('res://')
  const path = parent === '' ? node.name : `${parent}/${node.name}`
  const title = [node.name, node.className, `id ${node.id}`, node.sceneFilePath]
    .filter(part => part !== '')
    .join('\n')
  return {
    key: `${node.id}:${node.name}`,
    name: node.name,
    subtitle: node.className,
    iconClass: scripted ? 'Script' : node.className,
    ...(scripted ? { script: node.className } : {}),
    title,
    path,
    ...(captured.has(node.id) ? { captured: true } : {}),
    children: node.children.map(child => toModel(child, path, captured)),
  }
}

/**
 * What the card can say about one picked node.
 *
 * A finished run is a snapshot: the game has exited, so the card reports the
 * identity the protocol sent and, when the run expanded that object, the rows it
 * captured. Anything more needs a re-run with `expandNodes` or `nodePaths`.
 */
export function nodeInfo(
  node: DebugSceneNode,
  entries: readonly DebugViewEntry[],
): DebugViewEntry | undefined {
  const findDeep = (list: readonly DebugViewEntry[]): DebugViewEntry | undefined => {
    for (const entry of list) {
      if (entry.id === node.id) return entry
      const nested = findDeep(entryChildren(entry))
      if (nested !== undefined) return nested
    }
    return undefined
  }
  return findDeep(entries)
}

/**
 * The row key the card opens on: a node the run captured, else the first node.
 *
 * A run that expanded something did so because the reader asked about it, so that
 * node is the one worth showing; without an expansion the stop's own root is the
 * least surprising pick.
 */
function defaultKey(
  nodes: readonly DebugSceneNode[],
  entries: readonly DebugViewEntry[],
): string | undefined {
  const captured = firstExpanded(nodes, entries)
  if (captured !== undefined) return `${captured.id}:${captured.name}`
  const first = nodes[0]
  return first === undefined ? undefined : `${first.id}:${first.name}`
}

/**
 * The first node of a tree the run expanded.
 */
function firstExpanded(
  nodes: readonly DebugSceneNode[],
  entries: readonly DebugViewEntry[],
): DebugSceneNode | undefined {
  for (const node of nodes) {
    if (entries.some(entry => entry.id === node.id)) return node
    const inner = firstExpanded(node.children, entries)
    if (inner !== undefined) return inner
  }
  return undefined
}

/**
 * Find a node by the row key the tree reports (`id:name`).
 */
function findNode(
  nodes: readonly DebugSceneNode[],
  key: string | undefined,
  parent = '',
): { node: DebugSceneNode; path: string } | undefined {
  if (key === undefined) return undefined
  for (const node of nodes) {
    const path = parent === '' ? node.name : `${parent}/${node.name}`
    if (`${node.id}:${node.name}` === key) return { node, path }
    const inner = findNode(node.children, key, path)
    if (inner !== undefined) return inner
  }
  return undefined
}

/**
 * The row keys above `key`, so a tree opens along the path to the picked node.
 */
function pathKeys(nodes: readonly DebugSceneNode[], key: string | undefined): Set<string> {
  const open = new Set<string>()
  const walk = (list: readonly DebugSceneNode[], trail: string[]): boolean => {
    for (const node of list) {
      const nodeKey = `${node.id}:${node.name}`
      const next = [...trail, nodeKey]
      if (nodeKey === key) {
        for (const part of next) open.add(part)
        return true
      }
      if (walk(node.children, next)) return true
    }
    return false
  }
  if (key !== undefined) walk(nodes, [])
  return open
}

/** Every object id the sample holds, nested objects included: the rows the run has state for. */
function capturedIdSet(entries: readonly DebugViewEntry[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: readonly DebugViewEntry[]): void => {
    for (const entry of list) {
      ids.add(entry.id)
      walk(entryChildren(entry))
    }
  }
  walk(entries)
  return ids
}

/** One stop: the top frame in the summary, everything else folded inside. */
function StopSection(props: {
  stop: DebugViewStop
  entries: readonly DebugViewEntry[]
  cut: DebugView['viewCut'] | undefined
  sampledElsewhere: boolean
  t: DebugCardProps['t']
}) {
  const { stop, entries, t, cut, sampledElsewhere } = props
  const nodes = stop.sceneTree?.nodes ?? []
  const hasNodes = nodes.length > 0
  const capturedIds = capturedIdSet(entries)
  const [selected, setSelected] = useState<string | undefined>(
    () => defaultKey(nodes, entries),
  )
  const picked = findNode(nodes, selected)
  const info = picked === undefined ? undefined : nodeInfo(picked.node, entries)
  const top = stop.frames[0]
  const where = top === undefined ? '' : `${top.func} — ${top.file}:${top.line}`
  return (
    <details className={css.stop} open={stop.index === 0}>
      <summary className={css.stopHead}>
        <span className={css.stopIndex}>#{stop.index + 1}</span>
        <span className={css.stopWhere}>{where}</span>
        <span className={css.stopReason}>{stop.reason}</span>
        <span className={css.stopThread}>thread {stop.threadId}</span>
      </summary>
      {stop.frames.length > 1 && (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('debugFrames')}</h4>
          <ol className={css.frames}>
            {stop.frames.map(frame => (
              <li key={`${frame.file}:${frame.line}:${frame.func}`}>
                <code>{frame.func}</code> <span className={css.dim}>{frame.file}:{frame.line}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {stop.varsLines !== undefined && stop.varsLines.length > 0 && (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('debugVars')}</h4>
          <pre className={css.block}>{stop.varsLines.join('\n')}</pre>
        </section>
      )}
      {hasNodes
        ? (
          <section className={css.section}>
            <h4 className={css.sectionTitle}>
              {t('debugSceneTree')} · {nodes.length} {t('debugTreeNodeCount')}
              {stop.sceneTree?.truncated === true ? ` · ${t('debugTreeTruncated')}` : ''}
            </h4>
            {sampledElsewhere && <p className={css.dim}>{t('debugNoExpansionHere')}</p>}
            <NodeTree
              roots={nodes.map(root => toModel(root, '', capturedIds))}
              selected={selected}
              onSelect={node => { setSelected(node.key) }}
              t={treeLocale(t)}
              openKeys={pathKeys(nodes, selected)}
            />
            <div className={css.nodeInfo}>
              {picked === undefined
                ? <p className={css.dim}>{t('debugPickNode')}</p>
                : (
                  <>
                    <div className={css.nodeHead}>
                      <code>{picked.path}</code>
                      <span className={css.dim}>{picked.node.className}</span>
                      <span className={css.dim}>id {picked.node.id}</span>
                    </div>
                    {picked.node.sceneFilePath !== '' && <div className={css.dim}>{picked.node.sceneFilePath}</div>}
                    {info === undefined
                      ? <p className={css.dim}>{t('debugNodeNotExpanded')}</p>
                      : (
                        <ul className={css.rows}>
                          {info.rows.slice(0, ROW_LIMIT).map(row => (
                            <li key={row.name}>
                              <span className={css.rowName}>{row.name}</span>
                              <span className={css.rowValue}>{row.value}</span>
                            </li>
                          ))}
                          {info.rows.length > ROW_LIMIT && (
                            <li className={css.dim}>{t('debugMoreRows').replace('{n}', String(info.rows.length - ROW_LIMIT))}</li>
                          )}
                        </ul>
                      )}
                  </>
                )}
            </div>
          </section>
        )
        : (
          <p className={`${css.note} ${css.dim}`}>
            {stop.frames.length === 0
              ? t('debugTreeNoFrames')
              : cut === 'sceneTree' ? t('debugTreeCut') : t('debugTreeNotCaptured')}
          </p>
        )}
    </details>
  )
}

/** One expanded object and the objects nested inside it. */
function Entry(props: { entry: DebugViewEntry; depth: number; t: DebugCardProps['t'] }) {
  const { entry, depth, t } = props
  const head = entry.repr === undefined ? `${entry.className}<${entry.id}>` : entry.repr
  return (
    <li className={css.entry} style={{ marginLeft: `${depth * 16}px` }}>
      <div className={css.entryHead}>
        <code>{entry.name}</code>
        <span className={css.dim}>{head}</span>
      </div>
      <ul className={css.rows}>
        {entryRows(entry).slice(0, ROW_LIMIT).map(row => (
          <li key={row.name}>
            <span className={css.rowName}>{row.name}</span>
            <span className={css.rowValue}>{row.value}</span>
          </li>
        ))}
        {entryRows(entry).length > ROW_LIMIT && (
          <li className={css.dim}>{t('debugMoreRows').replace('{n}', String(entryRows(entry).length - ROW_LIMIT))}</li>
        )}
      </ul>
      {entryChildren(entry).length > 0 && (
        <ul className={css.entries}>
          {entryChildren(entry).map(child => <Entry key={`${child.name}:${child.id}`} entry={child} depth={depth + 1} t={t} />)}
        </ul>
      )}
    </li>
  )
}

/**
 * Render one `godot_debug` call.
 *
 * A toolview entry that throws is abdicated by the slot registry for the rest
 * of the session, so an unexpected wire shape must degrade to the text report
 * instead of taking the card away.
 */
export function DebugCard(props: DebugCardProps) {
  const disclosure = useCardFold(props.callId ?? 'godot_debug')
  try {
    return <DebugCardBody {...props} disclosure={disclosure} />
  } catch (error) {
    // A slot that throws is abdicated for the session, and a silent `null` leaves
    // the transcript with a gap. Show what broke, with the call's own text.
    const fallback = callText((props.block ?? undefined) as Parameters<typeof callText>[0])
    return (
      <details open>
        <summary className={css.head}>
          <span>{props.toolName ?? 'godot_debug'}</span>
          <span>{error instanceof Error ? error.message : String(error)}</span>
        </summary>
        {fallback !== '' && <pre className={css.block}>{fallback}</pre>}
      </details>
    )
  }
}

/**
 * Which calls have their report open, kept outside React.
 *
 * The transcript re-creates a toolview on every streaming render, so a row's own
 * `useState` is thrown away as fast as the reader opens it — which is what made a
 * click look like it did nothing. Keyed by call id, so a row that re-mounts comes
 * back the way the reader left it.
 */
const OPEN_CALLS = new Set<string>()

/**
 * Set a call's fold state from outside the component.
 *
 * The card's own controls go through {@link useCardFold}; this exists so a test or a
 * preview can render the report without simulating the click.
 */
export function setCardOpen(callId: string, open: boolean): void {
  if (open) OPEN_CALLS.add(callId)
  else OPEN_CALLS.delete(callId)
}

/** The card's fold state, stored per call rather than per component instance. */
function useCardFold(callId: string): {
  readonly expanded: boolean
  readonly toggle: () => void
} {
  const [, bump] = useState(0)
  const write = (open: boolean): void => {
    if (open) OPEN_CALLS.add(callId)
    else OPEN_CALLS.delete(callId)
    bump(count => count + 1)
  }
  return {
    expanded: OPEN_CALLS.has(callId),
    toggle: () => { write(!OPEN_CALLS.has(callId)) },
  }
}

/** The card itself; {@link DebugCard} guards it. */
function DebugCardBody(props: DebugCardProps & {
  readonly disclosure: ReturnType<typeof useCardFold>
}) {
  const { t, disclosure } = props
  const block = props.block as DebugCallBlock | undefined
  const args = callArgs(block)
  const meta = block?.meta as { view?: unknown } | undefined
  const view = asDebugView(meta?.view)

  const attach = args.mode === 'attach'
  const target = attach
    ? (typeof args.port === 'number' ? `:${args.port}` : t('debugAttachTarget'))
    : (typeof args.scene === 'string' && args.scene !== '' ? args.scene : t('debugMainScene'))
  const breakpoints = Array.isArray(args.breakpoints) ? args.breakpoints.length : 0

  const chips: string[] = []
  if (view !== undefined) {
    chips.push(`${view.stopCount} ${t('debugStops')}`)
    if (view.detached) chips.push(t('debugDetached'))
    if (view.sceneTreeCount > 0) chips.push(`${view.sceneTreeCount} ${t('debugSceneTrees')}`)
    if (view.editsApplied > 0) chips.push(`${view.editsApplied} ${t('debugEdits')}`)
    if (view.expandedObjects > 0) chips.push(`${view.expandedObjects} ${t('debugExpanded')}`)
    const truncated = view.viewTruncated === true || view.expansionTruncated || view.editsTruncated
      || view.sceneTreeTruncated || view.outputTruncated || view.varsTruncated
    if (truncated) chips.push(t('debugTruncated'))
  }

  const failed = block?.isError === true
  const fallbackText = failed || view === undefined ? callText(block) : ''
  // An unsettled call still shows what it was asked to do, marked as running.
  const hasBody = view !== undefined || fallbackText !== ''
  const reportText = callText(block)
  const facts = [
    `${attach ? t('debugAttach') : t('debugLaunch')} · ${target}`,
    breakpoints > 0 ? `${breakpoints} ${t('debugBreakpoints')}` : '',
    ...chips,
    hasBody ? '' : t('debugRunning'),
  ].filter(part => part !== '').join(' · ')
  return (
    <DisclosureRow
      icon={<span className={css.icon} style={GODOT_MASK} aria-hidden="true" />}
      title={props.toolName ?? 'godot_debug'}
      titleClassName={failed ? css.failed : undefined}
      open={disclosure.expanded}
      expandable
      onToggle={disclosure.toggle}
      expandOnRowClick
      previewChevron
      running={!hasBody}
      keepContentWhenOpen
      collapsedContent={hasBody
        ? <TextShimmer className={css.facts}>{facts}</TextShimmer>
        : <span className={css.facts}>{facts}</span>}
    >
      <ReportGuard fallback={<pre className={css.block}>{reportText}</pre>}>
        <div className={css.bodyWrap}>
        {view === undefined
          ? (fallbackText === '' ? null : <pre className={css.block}>{fallbackText}</pre>)
          : (
          <>
            <div className={css.stops}>
              {view.stops.map(stop => (
                <StopSection
                  key={stop.index}
                  stop={stop}
                  entries={view.expansion?.stopIndex === stop.index ? view.expansion.entries : []}
                  cut={view.viewCut}
                  sampledElsewhere={view.expansion !== undefined && view.expansion.stopIndex !== stop.index}
                  t={t}
                />
              ))}
            </div>

            {view.expansion !== undefined && view.expansion.entries.length > 0 && (
              <details className={css.stop}>
                <summary className={css.stopHead}>
                  <span className={css.stopWhere}>{t('debugExpansion')}</span>
                  <span className={css.stopReason}>{view.expansion.expandedObjects}</span>
                </summary>
                <ul className={css.entries}>
                  {view.expansion.entries.map(entry => <Entry key={`${entry.name}:${entry.id}`} entry={entry} depth={0} t={t} />)}
                </ul>
              </details>
            )}

            {view.edits !== undefined && view.edits.results.length > 0 && (
              <details className={css.stop}>
                <summary className={css.stopHead}>
                  <span className={css.stopWhere}>{t('debugEdits')}</span>
                  <span className={css.stopReason}>{view.editsApplied}</span>
                </summary>
                <ul className={css.rows}>
                  {view.edits.results.map(result => (
                    <li key={`${result.target}:${result.property}`}>
                      <code>{result.target}.{result.property}</code>
                      <span className={result.ok ? css.ok : css.bad}>{String(result.requested)}</span>
                      {result.detail !== undefined && <span className={css.dim}>{result.detail}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {(view.outputTail.length > 0 || view.errors.length > 0) && (
              <details className={css.stop}>
                <summary className={css.stopHead}>
                  <span className={css.stopWhere}>{t('debugOutput')}</span>
                  <span className={css.stopReason}>
                    {view.outputTail.length + view.errors.length}
                    {view.outputTruncated ? ` · ${t('debugTruncated')}` : ''}
                  </span>
                </summary>
                {view.errors.length > 0 && <pre className={`${css.block} ${css.bad}`}>{view.errors.join('\n')}</pre>}
                {view.outputTail.length > 0 && <pre className={css.block}>{view.outputTail.join('\n')}</pre>}
              </details>
            )}

            {view.exit !== undefined && (
              <div className={css.exit}>
                {view.exit.exitCode !== undefined ? `exit ${view.exit.exitCode}` : `signal ${view.exit.signal ?? ''}`}
              </div>
            )}
          </>
        )}
        {props.inspect === undefined ? null : (
          <button type="button" className={css.inspect} onClick={() => { props.inspect?.() }}>
            <svg width="12" height="12" aria-hidden="true">
              <use href="#dsw-icon-inspect-outline-regular" />
            </svg>
            {t('debugInspect')}
          </button>
        )}
        </div>
      </ReportGuard>
    </DisclosureRow>
  )
}