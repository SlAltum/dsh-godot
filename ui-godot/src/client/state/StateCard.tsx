/**
 * The `godot_state` card: the read's facts, then the live node hierarchy.
 *
 * `godot_state` reads the game as it stands, so every row is live: the card
 * draws the tree and leaves per-node state to `godot_node`. The rows themselves
 * belong to {@link NodeTree}, the same one the scene preview and the debug card
 * use.
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DisclosureRow } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCardFold } from '../cards/fold.ts'
import { callText } from '../debug/debug-view.ts'
import { NodeTree, type TreeItemModel, type TreeLocale } from '../scene/NodeTree.tsx'
import godotLogo from '../assets/godot-logo.svg'
import css from './StateCard.module.css'
import { asStateView, type StateViewNode } from './state-view.ts'

/** Props the renderer binds for the state card. */
export type StateCardProps =
  PropsLocale<'godot.state'>
  & {
    /** The tool call's settled (or running) block. */
    readonly block?: unknown
    /** Wire tool name: `godot_state`. */
    readonly toolName?: string
    /** The call this card belongs to; the fold state is kept per call. */
    readonly callId?: string
  }

/** The Godot mark as a mask, so it takes the row's icon colour. */
const GODOT_MASK = {
  maskImage: `url("${godotLogo}")`,
  WebkitMaskImage: `url("${godotLogo}")`,
} as const

/** The tree's labels, from the card's own namespace. */
function treeLocale(t: StateCardProps['t']): TreeLocale {
  return {
    sceneScript: t('sceneScript'),
    sceneInstance: t('sceneInstance'),
    sceneUnique: t('sceneUnique'),
    sceneCollapse: t('sceneCollapse'),
    sceneExpand: t('sceneExpand'),
  }
}

/** Count one view subtree (the rows the card holds). */
function countNodes(nodes: readonly StateViewNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0)
}
/** Adapt one live node to a tree row: the class text, the script glyph, the `%`, the mark. */
/** Adapt one live node to a tree row: the class text, the script glyph, the `%`. */
function toModel(node: StateViewNode, parent: string, changed: ReadonlySet<string>): TreeItemModel {
  const path = parent === '' ? node.name : `${parent}/${node.name}`
  // The bridge reports a scripted node's class as its script path, so such a
  // node draws the script glyph and shows the path as its class text.
  const scripted = node.className.startsWith('res://')
  return {
    key: path,
    name: node.name,
    ...(node.className === '' ? {} : { subtitle: node.className }),
    iconClass: scripted ? 'Script' : node.className,
    ...(node.script === '' ? {} : { script: node.script }),
    ...(node.scene === '' ? {} : { instance: node.scene }),
    unique: node.unique,
    path,
    ...(node.id === '' ? {} : { title: `${path} (${node.id})` }),
    ...(changed.has(path) ? { marked: true } : {}),
    children: node.children.map(child => toModel(child, path, changed)),
  }
}

/** Render one `godot_state` call. */
export function StateCard(props: StateCardProps) {
  const { t } = props
  const disclosure = useCardFold(props.callId ?? 'godot_state')
  const block = props.block as { meta?: unknown; isError?: boolean } | undefined
  const view = asStateView((block?.meta as { view?: unknown } | undefined)?.view)
  const fallbackText = callText(block as Parameters<typeof callText>[0])

  const facts = view === undefined
    ? ''
    : [
      view.scene === '' ? t('debugMainScene') : view.scene,
      `${view.fps} fps`,
      `${t('stateFrame')} ${view.frame}`,
      `${view.nodeCount} ${t('sceneNodes')}`,
      ...(view.paused ? [t('statePaused')] : []),
    ].join(' · ')
  const hasBody = view !== undefined || fallbackText !== ''
  const nodes = view?.nodes ?? []
  // Rows this read changed: the same mark the debug card uses for sampled
  // properties, spent here on "this row is new or moved since the last read".
  const changed = new Set([...(view?.changed?.appeared ?? []), ...(view?.changed?.changed ?? [])])

  return (
    <DisclosureRow
      icon={<span className={css.icon} style={GODOT_MASK} aria-hidden="true" />}
      title={props.toolName ?? 'godot_state'}
      titleClassName={block?.isError === true ? css.failed : undefined}
      open={disclosure.expanded}
      expandable
      onToggle={disclosure.toggle}
      expandOnRowClick
      previewChevron
      running={!hasBody}
      keepContentWhenOpen
      collapsedContent={<span className={css.facts}><span className={css.sep} aria-hidden="true" />{facts}</span>}
    >
      <div className={css.bodyWrap}>
        {view === undefined
          ? (fallbackText === '' ? null : <pre className={css.block}>{fallbackText}</pre>)
          : nodes.length === 0
            ? <p className={css.dim}>{t('stateNoTree')}</p>
            : (
              <>
                <h4 className={css.head}>
                  {`${t('debugSceneTree')} · ${view.treeTruncated === true
                    ? `${String(countNodes(nodes))} / ${String(view.nodeCount)}`
                    : String(view.nodeCount)} ${t('sceneNodes')}`}
                  {view.treeTruncated === true ? ` · ${t('debugTreeTruncated')}` : ''}
                  {changed.size === 0 ? '' : ` · ${t('stateChanged')} ${String(changed.size)}`}
                </h4>
                <NodeTree
                  roots={nodes.map(root => toModel(root, '', changed))}
                  selected={undefined}
                  t={treeLocale(t)}
                />
              </>
            )}
      </div>
    </DisclosureRow>
  )
}
