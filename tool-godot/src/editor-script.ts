/**
 * The model-facing `godot_editor_script` tool: run one `res://` EditorScript
 * in the headless Godot editor and return its stdout, parsed as JSON when the
 * script printed JSON. This is the escape hatch for project-specific checks
 * (custom validators, scene-graph audits, snapshot dumps): the project's own
 * code runs with full editor access and can emit structured data to stdout.
 *
 * ## Why the tool runs a bootstrap, not the script
 *
 * Godot's `--script` runs a `SceneTree`/`MainLoop`, NOT an `EditorScript`:
 * passing an EditorScript straight to `--script` makes the engine abort with
 * `Can't load the script "..." as it doesn't inherit from SceneTree or
 * MainLoop` (the command line tutorial states the rule: "The script must
 * inherit from `SceneTree` or `MainLoop`"). The tool therefore writes a small
 * `SceneTree` bootstrap to a temporary file OUTSIDE the project — `--script`
 * accepts an absolute filesystem path — which loads the requested
 * EditorScript, instantiates it in editor context (`--editor` is required; a
 * runtime build refuses with "Class 'EditorScript' can only be instantiated by
 * editor"), calls its `_run()` (or the exposed `run()`, when present), and
 * quits. The bootstrap embeds the target path instead of consuming an argument
 * so `OS.get_cmdline_user_args()` inside the EditorScript stays exactly the
 * tool call's `args`.
 *
 * @module @deepseek-ai/dsh-tool-godot/editor-script
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { resolveProjectRoot, runGodot, withTempGdScript } from './godot-core.ts'
import type { ResolvedCaps } from './godot-core.ts'

/** Validated `godot_editor_script` arguments. */
export interface EditorScriptInput {
  script: string
  path?: string
  args?: string[]
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `script`, a `res://` scheme, and a non-blank `path` when given. Throws a
 * plain `Error` (an ordinary tool argument error) otherwise.
 *
 * @param args - the schema-validated arguments.
 * @returns the accepted input.
 */
export function parseEditorScriptArgs(args: { script: string; path?: string; args?: string[] }): EditorScriptInput {
  if (args.script.trim().length === 0) throw new Error('script must be a non-empty string')
  if (!args.script.startsWith('res://')) throw new Error('script must be a res:// path')
  if (args.path !== undefined && args.path.trim().length === 0) throw new Error('path must be a non-empty string when given')
  return {
    script: args.script,
    ...(args.path !== undefined ? { path: args.path } : {}),
    args: args.args ?? [],
  }
}

/** Quote `value` as a GDScript double-quoted string literal. */
function gdStringLiteral(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Build the GDScript source of the `SceneTree` bootstrap that runs one
 * EditorScript. The bootstrap embeds the target `res://` path, instantiates
 * the script under `--editor`, calls `_run()` (or an exposed `run()`), and
 * quits non-zero with a `printerr` message when the script cannot be loaded,
 * instantiated, or run — so the tool's exit code and stderr tell the whole
 * story.
 *
 * @param script - the `res://` EditorScript path to run.
 * @returns the complete bootstrap source.
 */
export function buildEditorScriptBootstrap(script: string): string {
  return [
    'extends SceneTree',
    '',
    '',
    'func _initialize() -> void:',
    `\tvar target := ${gdStringLiteral(script)}`,
    '\tvar script: Script = load(target)',
    '\tif script == null:',
    '\t\tprinterr("godot_editor_script: cannot load " + target)',
    '\t\tquit(1)',
    '\t\treturn',
    '\tvar instance: Object = script.new()',
    '\tif instance == null:',
    '\t\tprinterr("godot_editor_script: cannot instantiate " + target)',
    '\t\tquit(1)',
    '\t\treturn',
    '\tif instance is MainLoop:',
    '\t\tprinterr("godot_editor_script: " + target + " is a MainLoop; pass an EditorScript")',
    '\t\tquit(1)',
    '\t\treturn',
    '\tif instance.has_method("run"):',
    '\t\tinstance.call("run")',
    '\telif instance.has_method("_run"):',
    '\t\tinstance.call("_run")',
    '\telse:',
    '\t\tprinterr("godot_editor_script: " + target + " has no _run(); pass an EditorScript")',
    '\t\tquit(1)',
    '\t\treturn',
    '\tquit(0)',
    '',
  ].join('\n')
}

/**
 * Build the godot argv for one EditorScript run: headless editor, project
 * root, `--script` pointed at the written bootstrap, then the user args after
 * `--`. Every model-controlled value is a plain argv element.
 *
 * @param root - the resolved project root.
 * @param bootstrapPath - the absolute filesystem path of the bootstrap script.
 * @param userArgs - the user arguments passed after `--`.
 * @returns the complete argv (excluding the executable itself).
 */
export function buildEditorScriptCommand(root: string, bootstrapPath: string, userArgs: readonly string[] = []): string[] {
  return [
    '--headless',
    '--editor',
    '--path',
    root,
    '--script',
    bootstrapPath,
    ...(userArgs.length > 0 ? ['--', ...userArgs] : []),
  ]
}

/** Parse `text` as JSON, returning `undefined` instead of throwing. */
function parseJsonOrUndefined(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return undefined
  }
}

/**
 * Best-effort JSON parse of script stdout: the whole trimmed output when it
 * already starts with `{` or `[`, otherwise the last individual line that
 * starts with one of those and parses. The line fallback exists because a real
 * godot prints its version header and scan progress to stdout before the
 * script runs, so "one JSON line among banner noise" is the common case.
 * Invalid JSON is left as `undefined` (the raw output stays available).
 *
 * @param output - the captured stdout.
 * @returns the parsed value, or `undefined` when the output carries no JSON.
 */
export function tryParseJson(output: string): JsonValue | undefined {
  const trimmed = output.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    const whole = parseJsonOrUndefined(trimmed)
    if (whole !== undefined) return whole
  }
  for (const raw of trimmed.split('\n').reverse()) {
    const line = raw.trim()
    if (line[0] !== '{' && line[0] !== '[') continue
    const parsed = parseJsonOrUndefined(line)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/** The canonical `godot_editor_script` result. */
export interface EditorScriptResult {
  /** The resolved project root the script ran under. */
  projectRoot: string
  /** The `res://` EditorScript path. */
  script: string
  /** The process exit code, present when the process exited (omitted when killed by a signal). */
  exitCode?: number
  /** The signal that killed the process, present when killed (omitted when it exited). */
  signal?: string
  /** The retained stdout. */
  output: string
  /** The retained stderr (carries godot's load/parse/script errors). */
  stderr: string
  /** The stdout parsed as JSON when it was JSON. */
  json?: JsonValue
  /** True when the run exited cleanly. */
  ok: boolean
  /** True when the subprocess seam dropped stdout bytes past the budget. */
  stdoutTruncated: boolean
  /** True when the subprocess seam dropped stderr bytes past the budget. */
  stderrTruncated: boolean
}

/**
 * Format the model-facing `godot_editor_script` result text: an exit head,
 * truncation notes, the stdout body, and a stderr tail when present.
 *
 * @param value - the canonical result.
 * @returns the model-facing text.
 */
export function renderEditorScriptOutput(value: EditorScriptResult): string {
  const exit = value.signal !== undefined ? `signal ${value.signal}` : `code ${value.exitCode}`
  const notes: string[] = []
  if (value.stdoutTruncated) notes.push('(stdout truncated)')
  if (value.stderrTruncated) notes.push('(stderr truncated)')
  const note = notes.length > 0 ? ` ${notes.join(' ')}` : ''
  const body = value.output.length > 0 ? value.output : '(no output)'
  const stderr = value.stderr.length > 0 ? `\nstderr:\n${value.stderr}` : ''
  return `Godot EditorScript ${value.script} exited with ${exit}${note}\n${body}${stderr}`
}

/**
 * Pending-call presentation: a generic card titled by the script.
 *
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the call runs.
 */
export function presentEditorScriptCall(args: { script: string; path?: string; args?: string[] }): GenericCallView {
  const where = args.path !== undefined ? ` in ${args.path}` : ''
  return { card: 'generic', title: `Run Godot EditorScript ${args.script}${where}` }
}

/**
 * Register the `godot_editor_script` tool.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param caps - per-call resolved caps thunk (settings section over the composition entry).
 */
export function applyEditorScriptTool(ctx: Context, caps: () => ResolvedCaps): void {
  const tool = defineTool({
    name: 'godot_editor_script',
    description:
      'Run a res:// EditorScript in the headless Godot editor and return its stdout, parsed as JSON when the script printed JSON. '
      + 'Use it for project-specific checks that need editor access (scene-graph audits, custom validators, snapshot dumps). '
      + 'The script is project code and runs with full editor access. A non-zero exit is reported in the result, not an error. '
      + 'Requires a godot executable configured or on PATH.',
    parameters: {
      script: {
        type: 'string',
        required: true,
        description: 'The res:// EditorScript path to run (a GDScript extending EditorScript).',
      },
      path: {
        type: 'string',
        description: 'Project root. Defaults to the session workspace; a relative path resolves against it. Discovery walks up for project.godot.',
      },
      args: {
        type: 'array',
        description: 'User arguments passed after -- (OS.get_cmdline_user_args()).',
        items: { type: 'string' },
      },
    },
    timeoutMs: caps().timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectRoot: { type: 'string', required: true },
          script: { type: 'string', required: true },
          exitCode: { type: 'number' },
          signal: { type: 'string' },
          output: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          json: { type: 'json' },
          ok: { type: 'boolean', required: true },
          stdoutTruncated: { type: 'boolean', required: true },
          stderrTruncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderEditorScriptOutput(value) }],
    },
    async execute(args, exec) {
      const c = caps()
      const input = parseEditorScriptArgs(args)
      const workdir = exec.agent?.session.header.cwd ?? process.cwd()
      const projectRoot = await resolveProjectRoot(input.path, workdir)
      const run = await withTempGdScript(buildEditorScriptBootstrap(input.script), bootstrapPath =>
        runGodot(ctx, exec, 'godot_editor_script', c.godot, buildEditorScriptCommand(projectRoot, bootstrapPath, input.args), c))
      const json = tryParseJson(run.stdout)
      return {
        projectRoot,
        script: input.script,
        /* v8 ignore next 1 -- a signal-killed run cannot be driven deterministically in tests */
        ...(run.signal !== null ? { signal: run.signal } : run.exitCode !== null ? { exitCode: run.exitCode } : {}),
        output: run.stdout,
        stderr: run.stderr,
        ...(json !== undefined ? { json } : {}),
        ok: run.exitCode === 0 && run.signal === null,
        stdoutTruncated: run.stdoutTruncated,
        stderrTruncated: run.stderrTruncated,
      }
    },
    presentCall: presentEditorScriptCall,
  })
  ctx.tools.register(tool)
}
