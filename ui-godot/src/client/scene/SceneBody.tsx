/** The `.tscn` document body: the scene's node tree, read from the file itself.
 *
 * A scene file is text, so a reader who opens one wants the hierarchy it
 * describes rather than the raw syntax. The rows themselves — icons, marks,
 * folding — belong to {@link NodeTree}, which the debug card shares.
 */

import { useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NodeTree, type TreeItemModel, type TreeLocale } from './NodeTree.tsx'
import css from './SceneBody.module.css'
import { parseTscn, type SceneNode } from './tscn.ts'

/** Props the renderer binds for the scene body. */
export type SceneBodyProps =
  PropsRuntime<'sidebar.right.tab.document'>
  & PropsLocale<'godot.scene'>

/**
 * Adapt one parsed scene node to a tree row.
 */
function toModel(node: SceneNode): TreeItemModel {
  const iconClass = node.type !== '' ? node.type : 'Script'
  return {
    key: node.path,
    name: node.name,
    ...(node.type !== '' ? { subtitle: node.type } : {}),
    iconClass,
    ...(node.script !== undefined ? { script: node.script } : {}),
    ...(node.instance !== undefined ? { instance: node.instance } : {}),
    unique: node.unique,
    line: node.line,
    children: node.children.map(toModel),
  }
}

/**
 * Render one `.tscn` file as a node tree.
 */
export function SceneBody(props: SceneBodyProps) {
  const { t } = props
  const text = props.content.kind === 'text' ? props.content.text : ''
  const scene = useMemo(() => parseTscn(text), [text])
  const [selected, setSelected] = useState<string>()
  const selectedNode = scene.nodes.find(node => node.path === selected)

  if (props.content.kind !== 'text') return <div className={css.note}>{t('sceneLoading')}</div>
  if (scene.root === undefined) return <div className={css.note}>{t('sceneEmpty')}</div>

  return (
    <div className={css.body}>
      <div className={css.header}>
        <span className={css.root}>{scene.rootName}</span>
        <span className={css.meta}>{scene.nodes.length} {t('sceneNodes')}</span>
        <span className={css.meta}>{scene.resources.length} {t('sceneResources')}</span>
      </div>
      <div className={css.panes}>
        <div className={css.treePane}>
          <NodeTree
            roots={[toModel(scene.root)]}
            selected={selected}
            onSelect={node => { setSelected(node.key) }}
            t={t as unknown as TreeLocale}
          />
        </div>
        <div className={css.detail}>
          {selectedNode === undefined
            ? <div className={css.note}>{t('scenePickNode')}</div>
            : (
              <>
                <div className={css.detailHead}>
                  <code>{selectedNode.path}</code>
                  <span className={css.meta}>{t('sceneLine')} {selectedNode.line}</span>
                </div>
                {selectedNode.script !== undefined && (
                  <div className={css.detailMeta}>{t('sceneScript')}: <code>{selectedNode.script}</code></div>
                )}
                {selectedNode.instance !== undefined && (
                  <div className={css.detailMeta}>{t('sceneInstance')}: <code>{selectedNode.instance}</code></div>
                )}
                <pre className={css.source}>{selectedNode.body}</pre>
              </>
            )}
        </div>
      </div>
    </div>
  )
}
