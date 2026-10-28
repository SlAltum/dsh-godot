/**
 * Static structural validation for `.tscn` files.
 *
 * The headless editor pass imports scenes and reports parse failures, but a
 * scene can be syntactically perfect and still be wrong: a Control laid out
 * with anchors inside a Container is silently rewritten at runtime, a
 * `parent="…"` can name a node that no longer exists, and a `[connection]` can
 * point at a method nobody wrote. Those only surface when someone opens the
 * scene and moves something. This module finds them by reading the file, so a
 * scene can be checked in the same breath as a script and without an engine.
 *
 * @module @deepseek-ai/dsh-tool-godot/scene-validate
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { GodotIssue } from './validate.ts'

/** One node entry, with the properties the rules read. */
export interface SceneNodeEntry {
  readonly name: string
  /** Parent path as written (`.` for the root's children). */
  readonly parent: string
  /** Full scene path from the root, for example `Frame/Ico`. */
  readonly path: string
  readonly type: string
  readonly line: number
  readonly script?: string
}

/** One `[connection]` entry. */
export interface SceneConnection {
  readonly from: string
  readonly to: string
  readonly signal: string
  readonly method: string
  readonly line: number
}

/** One `[ext_resource]` entry. */
export interface SceneResource {
  readonly id: string
  readonly type: string
  readonly path: string
  readonly line: number
}

/** The parts of a scene document the rules need. */
export interface SceneDocument {
  readonly nodes: SceneNodeEntry[]
  readonly connections: SceneConnection[]
  readonly resources: SceneResource[]
  /** Property text per node path (`layout_mode = 2` and friends). */
  readonly properties: ReadonlyMap<string, Readonly<Record<string, string>>>
}

/** Attributes of one `[section …]` header. */
type Attrs = Record<string, string>

/**
 * Parse the quoted `key="value"` and bare `key=value` attributes of a section
 * header.
 * @param text - the text between the brackets, after the section kind.
 * @returns the attributes by name.
 */
export function parseHeaderAttrs(text: string): Attrs {
  const attrs: Attrs = {}
  const pattern = /(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g
  for (const match of text.matchAll(pattern)) {
    const key = match[1] as string
    const raw = match[2] as string
    attrs[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw
  }
  return attrs
}

/**
 * Parse a scene file into the nodes, connections, resources, and node
 * properties the rules read. Multi-line values (arrays, dictionaries) are
 * skipped: no rule depends on them.
 * @param text - the `.tscn` text.
 * @returns the parsed document.
 */
export function parseSceneDocument(text: string): SceneDocument {
  const nodes: SceneNodeEntry[] = []
  const connections: SceneConnection[] = []
  const resources: SceneResource[] = []
  const properties = new Map<string, Record<string, string>>()
  let current: SceneNodeEntry | undefined
  const lines = text.split('\n')
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (line.startsWith('[')) {
      const header = /^\[(\w+)\s*(.*)\]$/.exec(line)
      current = undefined
      if (header === null) continue
      const kind = header[1]
      const attrs = parseHeaderAttrs(header[2] ?? '')
      if (kind === 'node') {
        const name = attrs.name ?? ''
        const parent = attrs.parent ?? '.'
        const path = parent === '.' ? name : `${parent}/${name}`
        current = {
          name,
          parent,
          path,
          type: attrs.type ?? attrs.instance ?? '',
          line: index + 1,
          ...(attrs.script !== undefined ? { script: attrs.script } : {}),
        }
        nodes.push(current)
        properties.set(path, {})
      } else if (kind === 'connection') {
        connections.push({
          from: attrs.from ?? '',
          to: attrs.to ?? '.',
          signal: attrs.signal ?? '',
          method: attrs.method ?? '',
          line: index + 1,
        })
      } else if (kind === 'ext_resource') {
        resources.push({ id: attrs.id ?? '', type: attrs.type ?? '', path: attrs.path ?? '', line: index + 1 })
      }
      continue
    }
    if (current === undefined) continue
    const property = /^(\w+)\s*=\s*(.+)$/.exec(line)
    if (property === null) continue
    const bag = properties.get(current.path)
    if (bag !== undefined) bag[property[1] as string] = (property[2] as string).trim()
  }
  // `script = ExtResource("1_ab")` is a property, not a header attribute.
  const withScript = nodes.map((node) => {
    const bag = properties.get(node.path) ?? {}
    const resolved = node.script ?? /^ExtResource\("([^"]+)"\)$/.exec(bag.script ?? '')?.[1]
    return resolved === undefined ? node : { ...node, script: resolved }
  })
  return { nodes: withScript, connections, resources, properties }
}

/** Builtin classes whose children are laid out by the container, not by anchors. */
const CONTAINER_TYPES = new Set([
  'Container', 'BoxContainer', 'VBoxContainer', 'HBoxContainer', 'GridContainer',
  'MarginContainer', 'PanelContainer', 'ScrollContainer', 'CenterContainer',
  'AspectRatioContainer', 'FlowContainer', 'HFlowContainer', 'VFlowContainer',
  'SplitContainer', 'HSplitContainer', 'VSplitContainer', 'TabContainer',
])

/** Whether a type name denotes a Container (builtin list plus the `*Container` suffix). */
export function isContainer(type: string): boolean {
  return CONTAINER_TYPES.has(type) || type.endsWith('Container')
}

/** Whether the property bag carries Control layout evidence. */
function usesAnchors(bag: Readonly<Record<string, string>>): boolean {
  if (bag.layout_mode === '1' || bag.layout_mode === '0') return true
  if (bag.anchors_preset !== undefined && bag.anchors_preset !== '0') return true
  return ['anchor_left', 'anchor_top', 'anchor_right', 'anchor_bottom']
    .some(key => bag[key] !== undefined && bag[key] !== '0.0' && bag[key] !== '0')
}

/** Options for {@link validateSceneText}. */
export interface ValidateSceneOptions {
  /** Scene path as reported in issues (`res://…` or project-relative). */
  readonly path: string
  /** Absolute project root, used to check `res://` resources. */
  readonly projectRoot: string
  /** Load one `res://` text file, or `undefined` when it does not exist. */
  readonly readFile?: (resourcePath: string) => Promise<string | undefined>
}

/** A `func name(` declaration, used to check connection targets. */
const FUNC_RE = /^\s*(?:static\s+)?func\s+([A-Za-z_]\w*)\s*\(/gm

/**
 * Validate one scene's text.
 * @param text - the `.tscn` text.
 * @param options - scene path, project root, and a resource reader.
 * @returns the issues, in file order.
 */
export async function validateSceneText(text: string, options: ValidateSceneOptions): Promise<GodotIssue[]> {
  const document = parseSceneDocument(text)
  const issues: GodotIssue[] = []
  const report = (line: number, kind: GodotIssue['kind'], message: string): void => {
    issues.push({ kind, message, path: options.path, line })
  }
  const byPath = new Map<string, SceneNodeEntry>()
  const scriptsByResourceId = new Map(document.resources.filter(entry => entry.type === 'Script').map(entry => [entry.id, entry.path]))

  const root = document.nodes[0]
  for (const [index, node] of document.nodes.entries()) {
    if (byPath.has(node.path)) {
      report(node.line, 'error', `duplicate node path "${node.path}"`)
    }
    byPath.set(node.path, node)

    const bag = document.properties.get(node.path) ?? {}
    // `.` means the scene root, which is the first node; the root itself has no parent.
    const parent = index === 0
      ? undefined
      : node.parent === '.' ? root : byPath.get(node.parent) ?? document.nodes.find(entry => entry.path === node.parent)
    if (parent === undefined && index !== 0 && node.parent !== '.') {
      report(node.line, 'error', `parent "${node.parent}" of "${node.name}" does not exist in this scene`)
      continue
    }
    // The feedback's case: anchors/offsets under a Container are ignored at
    // runtime, so the scene looks right in the file and wrong on screen.
    if (parent !== undefined && isContainer(parent.type) && usesAnchors(bag)) {
      report(node.line, 'error',
        `"${node.path}" is laid out with anchors/offsets inside the Container "${parent.path}" (${parent.type}); `
        + 'containers position their children, so set layout_mode = 2 and drop anchors/offsets')
    }
    if (parent !== undefined && !isContainer(parent.type) && bag.layout_mode === '2') {
      report(node.line, 'warning',
        `"${node.path}" uses layout_mode = 2 (container layout) but "${parent.path}" is a ${parent.type}, not a Container`)
    }
  }

  for (const resource of document.resources) {
    if (!resource.path.startsWith('res://') || options.readFile === undefined) continue
    const content = await options.readFile(resource.path)
    if (content === undefined) {
      report(resource.line, 'error', `ext_resource "${resource.path}" does not exist`)
    }
  }

  for (const connection of document.connections) {
    const owner = byPath.get(connection.to === '.' ? document.nodes[0]?.path ?? '.' : connection.to)
    if (owner === undefined) {
      report(connection.line, 'error', `connection target "${connection.to}" does not exist in this scene`)
      continue
    }
    if (options.readFile === undefined) continue
    const scriptId = document.properties.get(owner.path)?.script
    const resourceId = scriptId === undefined ? undefined : /^ExtResource\("([^"]+)"\)$/.exec(scriptId)?.[1]
    const scriptPath = resourceId === undefined ? undefined : scriptsByResourceId.get(resourceId)
    if (scriptPath === undefined) continue
    const source = await options.readFile(scriptPath)
    if (source === undefined) continue
    const methods = new Set([...source.matchAll(FUNC_RE)].map(match => match[1]))
    if (!methods.has(connection.method)) {
      report(connection.line, 'error',
        `connection calls "${connection.method}" on "${owner.path}", but ${scriptPath} declares no such function`)
    }
  }

  return issues
}

/**
 * Validate one scene file on disk.
 * @param file - absolute path of the `.tscn` file.
 * @param options - project root and the reported scene path.
 * @returns the issues.
 */
export async function validateSceneFile(
  file: string,
  options: { readonly path: string; readonly projectRoot: string },
): Promise<GodotIssue[]> {
  const text = await readFile(file, 'utf8')
  return validateSceneText(text, {
    path: options.path,
    projectRoot: options.projectRoot,
    readFile: async (resourcePath) => {
      const target = resolve(options.projectRoot, resourcePath.slice('res://'.length))
      try {
        return await readFile(target, 'utf8')
      } catch {
        return undefined
      }
    },
  })
}

/** Max `.tscn` files one scene validation reads from a directory. */
export const SCENE_FILE_LIMIT = 200

/**
 * Collect the `.tscn` files to validate for one `path` argument: the file
 * itself, or every scene below a directory.
 * @param target - absolute path of a `.tscn` file or a directory.
 * @param projectRoot - absolute project root, for the reported paths.
 * @returns absolute paths with their reported `res://` form, bounded by {@link SCENE_FILE_LIMIT}.
 */
export async function collectSceneFiles(
  target: string,
  projectRoot: string,
): Promise<Array<{ file: string; path: string }>> {
  const reported = (file: string): string => `res://${relative(projectRoot, file).split(sep).join('/')}`
  try {
    if (!(await stat(target)).isDirectory()) return [{ file: target, path: reported(target) }]
  } catch {
    return [{ file: target, path: reported(target) }]
  }
  const out: Array<{ file: string; path: string }> = []
  const walk = async (directory: string): Promise<void> => {
    if (out.length >= SCENE_FILE_LIMIT) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (out.length >= SCENE_FILE_LIMIT) return
      if (entry.name.startsWith('.')) continue
      const child = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') await walk(child)
      } else if (entry.name.endsWith('.tscn')) {
        out.push({ file: child, path: reported(child) })
      }
    }
  }
  await walk(target)
  return out
}
