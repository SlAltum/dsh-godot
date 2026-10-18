/**
 * The model-facing `godot_inspect` tool: read Godot text-format project,
 * scene, and resource files and return their structure. Godot resource
 * formats (`project.godot`, `.tscn`, `.tres`) are plain text, so inspection
 * is pure file parsing — no godot subprocess is spawned. This module owns
 * the parsers, the schema, the rendering, and the presentation.
 *
 * @module @deepseek-ai/dsh-tool-godot/inspect
 */

import type { Context } from '@deepseek-ai/cordis'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { GodotError, PROJECT_FILE, displayPath } from './godot-core.ts'

/** Validated `godot_inspect` arguments. */
export interface InspectInput {
  path: string
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `path`. Throws a plain `Error` (an ordinary tool argument error)
 * otherwise.
 *
 * @param args - the schema-validated arguments.
 * @returns the accepted input.
 */
export function parseInspectArgs(args: { path: string }): InspectInput {
  if (args.path.trim().length === 0) throw new Error('path must be a non-empty string')
  return { path: args.path }
}

/** One `[ext_resource]` entry of a scene or resource file. */
export interface ExtResource {
  id: string
  type: string
  path: string
}

/** One `[node]` entry of a scene file. */
export interface SceneNode {
  name: string
  type?: string
  parent?: string
  instance?: string
}

/** The parsed structure of a `project.godot` file. */
export interface ProjectInfo {
  configVersion?: string
  name?: string
  mainScene?: string
  autoloads: Array<{ name: string; path: string }>
  /** Section names in file order. */
  sections: string[]
}

/** The parsed structure of a `.tscn` file. */
export interface SceneInfo {
  format?: string
  uid?: string
  extResources: ExtResource[]
  nodes: SceneNode[]
}

/** The parsed structure of a `.tres` file. */
export interface ResourceInfo {
  /** Section names in file order. */
  sections: string[]
  extResources: ExtResource[]
}

/** The canonical `godot_inspect` result, discriminated by `kind`. */
export type InspectResult =
  | ({ kind: 'project'; path: string } & ProjectInfo)
  | ({ kind: 'scene'; path: string } & SceneInfo)
  | ({ kind: 'resource'; path: string } & ResourceInfo)

/**
 * The schema-inferred output shape of `godot_inspect`: the discriminated
 * `kind` union with every kind-specific field optional. Renderers accept this
 * shape (the output schema is the render boundary), while execution builds
 * the narrower {@link InspectResult}.
 */
export interface InspectOutput {
  kind: 'project' | 'scene' | 'resource'
  path: string
  configVersion?: string
  name?: string
  mainScene?: string
  autoloads?: Array<{ name: string; path: string }>
  sections?: string[]
  format?: string
  uid?: string
  extResources?: ExtResource[]
  nodes?: SceneNode[]
}

/**
 * Parse `key="value"` attribute pairs out of a bracketed header line.
 *
 * @param header - the header text between the brackets.
 * @returns the attribute map, first occurrence wins per key.
 */
export function parseAttrs(header: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  // Godot headers mix quoted values (uid="uid://...", name="Main") and bare
  // numeric values (format=3, load_steps=2). Both groups are guaranteed by
  // the regex alternatives, so the captures are asserted rather than guarded.
  const re = /(\w+)=("([^"]*)"|(\S+))/g
  for (let match = re.exec(header); match !== null; match = re.exec(header)) {
    const key = match[1] as string
    /* v8 ignore next 1 -- one regex alternative always captures a value group, so the empty-string fallback never fires */
    const value = match[3] ?? match[4] ?? ''
    attrs[key] = value
  }
  return attrs
}

/**
 * Parse a `project.godot` file: the top-level `config_version`, the
 * `[application]` main scene and display name, the `[autoload]` entries, and
 * the section list. Comments (`;`) and blank lines are skipped; unknown
 * sections and keys are ignored.
 *
 * @param text - the file text.
 * @returns the parsed project info.
 */
export function parseProjectFile(text: string): ProjectInfo {
  const info: ProjectInfo = { autoloads: [], sections: [] }
  let section = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith(';')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header !== null) {
      const name = header[1] as string
      section = name
      info.sections.push(section)
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')
    if (section === '') {
      if (key === 'config_version') info.configVersion = value
      continue
    }
    if (section === 'application') {
      if (key === 'run/main_scene') info.mainScene = value
      else if (key === 'config/name') info.name = value
    } else if (section === 'autoload') {
      info.autoloads.push({ name: key, path: value.replace(/^\*/, '') })
    }
  }
  return info
}

/**
 * Parse a `.tscn` file: the `[gd_scene]` header format/uid, every
 * `[ext_resource]` entry, and every `[node]` entry (name, optional type,
 * optional parent, optional instance). Other sections (`[sub_resource]`,
 * `[connection]`, ...) are skipped.
 *
 * @param text - the file text.
 * @returns the parsed scene info.
 */
export function parseSceneFile(text: string): SceneInfo {
  const info: SceneInfo = { extResources: [], nodes: [] }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const header = /^\[(\w+) (.*)\]$/.exec(line)
    if (header === null) continue
    const kind = header[1]
    if (kind === 'gd_scene') {
      const attrs = parseAttrs(header[2] as string)
      if (attrs.format !== undefined) info.format = attrs.format
      if (attrs.uid !== undefined) info.uid = attrs.uid
    } else if (kind === 'ext_resource') {
      const attrs = parseAttrs(header[2] as string)
      const id = attrs.id
      const path = attrs.path
      if (id !== undefined && path !== undefined) {
        info.extResources.push({ id, type: attrs.type ?? '', path })
      }
    } else if (kind === 'node') {
      const attrs = parseAttrs(header[2] as string)
      info.nodes.push({
        name: attrs.name ?? '',
        ...(attrs.type !== undefined ? { type: attrs.type } : {}),
        ...(attrs.parent !== undefined ? { parent: attrs.parent } : {}),
        ...(attrs.instance !== undefined ? { instance: attrs.instance } : {}),
      })
    }
  }
  return info
}

/**
 * Parse a `.tres` file: the section list and every `[ext_resource]` entry.
 *
 * @param text - the file text.
 * @returns the parsed resource info.
 */
export function parseResourceFile(text: string): ResourceInfo {
  const info: ResourceInfo = { sections: [], extResources: [] }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const header = /^\[(\w+)(?: (.*))?\]$/.exec(line)
    if (header === null) continue
    if (header[1] === 'ext_resource') {
      /* v8 ignore next 1 -- an ext_resource header always carries attributes,
         so the nullish fallback for a bare section header never fires here. */
      const attrs = parseAttrs(header[2] ?? '')
      const id = attrs.id
      const path = attrs.path
      if (id !== undefined && path !== undefined) {
        info.extResources.push({ id, type: attrs.type ?? '', path })
      }
    } else {
      info.sections.push(header[1] as string)
    }
  }
  return info
}

/** The resolved inspection target: the discriminant kind and the file path to read. */
type InspectTarget = { kind: 'project' | 'scene' | 'resource'; path: string }

/**
 * Resolve what `path` refers to: a directory containing `project.godot` is a
 * project; a `.tscn`/`.tres`/`project.godot` file is a scene/resource/project.
 * Anything else throws `GODOT_PARSE_ERROR`.
 *
 * @param target - the absolute target path.
 * @returns the resolved kind and file path.
 */
export async function resolveInspectTarget(target: string): Promise<InspectTarget> {
  const info = await stat(target)
  if (info.isDirectory()) {
    const entries = await readdir(target)
    if (!entries.includes(PROJECT_FILE)) {
      throw new GodotError(`${target} is not a Godot project root (no ${PROJECT_FILE})`, 'GODOT_PARSE_ERROR')
    }
    return { kind: 'project', path: join(target, PROJECT_FILE) }
  }
  const ext = extname(target)
  if (ext === '.tscn') return { kind: 'scene', path: target }
  if (ext === '.tres') return { kind: 'resource', path: target }
  if (basename(target) === PROJECT_FILE) return { kind: 'project', path: target }
  throw new GodotError(`unsupported file type: ${target}`, 'GODOT_PARSE_ERROR')
}

/**
 * Format the model-facing `godot_inspect` result text: a per-kind summary
 * head plus the structured details.
 *
 * @param value - the canonical result.
 * @returns the model-facing text.
 */
export function renderInspectOutput(value: InspectOutput): string {
  if (value.kind === 'project') {
    const head = `Godot project at ${value.path}`
    const name = value.name !== undefined ? `\nName: ${value.name}` : ''
    const main = value.mainScene !== undefined ? `\nMain scene: ${value.mainScene}` : ''
    const config = value.configVersion !== undefined ? `\nConfig version: ${value.configVersion}` : ''
    const autoloads = value.autoloads !== undefined && value.autoloads.length > 0
      ? `\nAutoloads:\n${value.autoloads.map(a => `  ${a.name} = ${a.path}`).join('\n')}`
      : ''
    const sections = value.sections !== undefined && value.sections.length > 0 ? `\nSections: ${value.sections.join(', ')}` : ''
    return `${head}${name}${main}${config}${autoloads}${sections}`
  }
  if (value.kind === 'scene') {
    const head = `Godot scene at ${value.path}`
    const fmt = value.format !== undefined ? `\nFormat: ${value.format}` : ''
    const uid = value.uid !== undefined ? `\nUID: ${value.uid}` : ''
    const resources = value.extResources !== undefined && value.extResources.length > 0
      ? `\nExternal resources:\n${value.extResources.map(r => `  ${r.id}: ${r.type} ${r.path}`).join('\n')}`
      : ''
    const nodes = value.nodes !== undefined && value.nodes.length > 0 ? `\nNodes:\n${value.nodes.map((n) => {
      const type = n.type !== undefined ? ` type=${n.type}` : ''
      const parent = n.parent !== undefined ? ` parent=${n.parent}` : ''
      const instance = n.instance !== undefined ? ` instance=${n.instance}` : ''
      return `  ${n.name}${type}${parent}${instance}`
    }).join('\n')}` : ''
    return `${head}${fmt}${uid}${resources}${nodes}`
  }
  const head = `Godot resource at ${value.path}`
  const resources = value.extResources !== undefined && value.extResources.length > 0
    ? `\nExternal resources:\n${value.extResources.map(r => `  ${r.id}: ${r.type} ${r.path}`).join('\n')}`
    : ''
  const sections = value.sections !== undefined && value.sections.length > 0 ? `\nSections: ${value.sections.join(', ')}` : ''
  return `${head}${resources}${sections}`
}

/**
 * Pending-call presentation: a generic card titled by the target path.
 *
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the call runs.
 */
export function presentInspectCall(args: { path: string }): GenericCallView {
  return { card: 'generic', title: `Inspect Godot ${args.path}` }
}

/**
 * Register the `godot_inspect` tool.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it.
 */
export function applyInspectTool(ctx: Context): void {
  const tool = defineTool({
    name: 'godot_inspect',
    description:
      'Inspect a Godot project root, scene (.tscn), or resource (.tres) file and return its structure: '
      + 'for a project the name, main scene, autoloads, and sections; for a scene the format, uid, external resources, and node tree; '
      + 'for a resource the sections and external resources. Pure file parsing, no godot subprocess.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Project root directory, or a .tscn/.tres/project.godot file. A relative path resolves against the session workspace.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['project', 'scene', 'resource'], required: true },
          path: { type: 'string', required: true },
          configVersion: { type: 'string' },
          name: { type: 'string' },
          mainScene: { type: 'string' },
          autoloads: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, path: { type: 'string', required: true } } } },
          sections: { type: 'array', items: { type: 'string' } },
          format: { type: 'string' },
          uid: { type: 'string' },
          extResources: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, type: { type: 'string', required: true }, path: { type: 'string', required: true } } } },
          nodes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, type: { type: 'string' }, parent: { type: 'string' }, instance: { type: 'string' } } } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderInspectOutput(value) }],
    },
    async execute(args, exec) {
      const input = parseInspectArgs(args)
      const workdir = exec.agent?.session.header.cwd ?? process.cwd()
      const target = isAbsolute(input.path) ? input.path : resolve(workdir, input.path)
      let resolved: InspectTarget
      try {
        resolved = await resolveInspectTarget(target)
      } catch (error) {
        if (error instanceof GodotError) throw error
        throw new GodotError(`cannot inspect ${target}`, 'GODOT_PARSE_ERROR', { cause: error })
      }
      let text: string
      /* v8 ignore start -- resolveInspectTarget already stat'd the file; an
         unreadable-after-stat race cannot be driven in tests. */
      try {
        text = await readFile(resolved.path, 'utf8')
      } catch (error) {
        throw new GodotError(`cannot read ${resolved.path}`, 'GODOT_PARSE_ERROR', { cause: error })
      }
      /* v8 ignore stop */
      const path = displayPath(target, workdir)
      const result: InspectResult = resolved.kind === 'project'
        ? { kind: 'project', path, ...parseProjectFile(text) }
        : resolved.kind === 'scene'
          ? { kind: 'scene', path, ...parseSceneFile(text) }
          : { kind: 'resource', path, ...parseResourceFile(text) }
      return result
    },
    presentCall: presentInspectCall,
  })
  ctx.tools.register(tool)
}
