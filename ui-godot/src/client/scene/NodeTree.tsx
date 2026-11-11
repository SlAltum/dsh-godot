/**
 * One scene tree: the node rows shared by the `.tscn` preview and the debug card.
 *
 * Both surfaces describe the same thing — a node hierarchy with a class, a
 * script and a unique name — so the rows, the icons and the marks live here and
 * each caller only decides what its rows mean.
 */

import { useState } from 'react'
import { NODE_ICON_CLASSES } from './icons.ts'
import css from './NodeTree.module.css'

export interface TreeItemModel {
  /** Stable identity for React and for the selection. */
  readonly key: string
  readonly name: string
  /** The class text under the name (`Control`, `res://main.gd`), when there is one. */
  readonly subtitle?: string
  /** Engine class whose icon this row draws. */
  readonly iconClass: string
  /** Node script path, when the node has one. */
  readonly script?: string
  /** Inherited scene path, when the node is an instance. */
  readonly instance?: string
  /** `unique_name_in_owner`: the editor's `%` mark. */
  readonly unique?: boolean
  /** Source line in the scene file, when the row came from one. */
  readonly line?: number
  /** Hover text; the debug card carries the object id and scene file here. */
  readonly title?: string
  /** Node address for a caller that acts on a row (the live tree asks the game). */
  readonly path?: string
  /** The caller has state for this node (sampled properties, or a change in this read). */
  readonly marked?: boolean
  readonly children: readonly TreeItemModel[]
}

/** The dictionary keys a tree row uses. */
export interface TreeLocale {
  readonly sceneScript: string
  readonly sceneInstance: string
  readonly sceneUnique: string
  readonly sceneCollapse: string
  readonly sceneExpand: string
}

/** Package name, used to build document-relative asset URLs. */
const PACKAGE = '@deepseek-ai/dsh-ui-godot'

/**
 * The icon URL for one engine class.
 */
function iconUrl(className: string): string | undefined {
  return NODE_ICON_CLASSES.has(className)
    ? `plugins/${PACKAGE}/assets/icons/${encodeURIComponent(className)}.svg`
    : undefined
}

/** The script glyph the editor draws for a scripted node. */
function scriptGlyphUrl(): string {
  return `plugins/${PACKAGE}/assets/icons/Script.svg`
}

/** One node row and its children. */
function Row(props: {
  node: TreeItemModel
  selected: string | undefined
  onSelect: ((node: TreeItemModel) => void) | undefined
  t: TreeLocale
  openKeys: ReadonlySet<string>
}): React.JSX.Element {
  const { node, selected, onSelect, t, openKeys } = props
  const [open, setOpen] = useState(openKeys.has(node.key) || openKeys.size === 0)
  const hasChildren = node.children.length > 0
  const icon = iconUrl(node.iconClass)
  const instanceGlyph = node.instance === undefined ? undefined : iconUrl('PackedScene')
  const rowClass = [
    css.row,
    node.marked === true ? css.rowMarked : '',
    selected === node.key ? css.rowSelected : '',
  ].filter(part => part !== '').join(' ')
  return (
    <li className={css.node}>
      <div className={rowClass} title={node.title}>
        {hasChildren
          ? (
            <button
              type="button"
              className={css.twisty}
              aria-label={open ? t.sceneCollapse : t.sceneExpand}
              aria-expanded={open}
              onClick={() => { setOpen(!open) }}
            >
              {open ? '▾' : '▸'}
            </button>
          )
          : <span className={css.twistySpacer} />}
        {icon === undefined
          ? <span className={css.iconSpacer} aria-hidden="true" />
          : <span className={css.icon} style={{ maskImage: `url("${icon}")` }} aria-hidden="true" />}
        {onSelect === undefined
          ? <span className={css.name}>{node.name}</span>
          : (
            <button type="button" className={css.name} onClick={() => { onSelect(node) }}>
              {node.name}
            </button>
          )}
        {node.subtitle !== undefined && <span className={css.type}>{node.subtitle}</span>}
        <span className={css.marks}>
          {instanceGlyph !== undefined && (
            <span className={css.badgeIcon} style={{ maskImage: `url("${instanceGlyph}")` }} title={`${t.sceneInstance}: ${node.instance ?? ''}`} />
          )}
          {node.unique === true && <span className={css.uniqueMark} title={t.sceneUnique}>%</span>}
          {node.script !== undefined && (
            <span className={css.badgeIcon} style={{ maskImage: `url("${scriptGlyphUrl()}")` }} title={`${t.sceneScript}: ${node.script}`} />
          )}
          {node.line !== undefined && <span className={css.line}>{node.line}</span>}
        </span>
      </div>
      {hasChildren && open && (
        <ul className={css.children}>
          {node.children.map(child => (
            <Row key={child.key} node={child} selected={selected} onSelect={onSelect} t={t} openKeys={openKeys} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Render a node hierarchy; `openKeys` rows start unfolded (empty = all unfolded). */
export function NodeTree(props: {
  roots: readonly TreeItemModel[]
  selected?: string | undefined
  onSelect?: ((node: TreeItemModel) => void) | undefined
  t: TreeLocale
  openKeys?: ReadonlySet<string> | undefined
}) {
  const openKeys = props.openKeys ?? new Set<string>()
  return (
    <ul className={css.tree}>
      {props.roots.map(root => (
        <Row
          key={root.key}
          node={root}
          selected={props.selected}
          onSelect={props.onSelect}
          t={props.t}
          openKeys={openKeys}
        />
      ))}
    </ul>
  )
}
