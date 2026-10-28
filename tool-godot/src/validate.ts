/**
 * The model-facing `godot_validate` tool: validate a whole Godot project
 * (headless editor import + a GDScript parse sweep) or one GDScript file
 * (`--check-only --script`) and return structured parse errors. Execution
 * spawns the configured godot executable through the subprocess seam with a
 * plain argv vector; this module owns the model-facing schema, argument
 * validation, argv construction, Godot diagnostics parsing, rendering, and
 * presentation.
 *
 * ## Why project mode runs the engine twice
 *
 * The headless editor run (`--editor --quit`) imports assets and surfaces
 * scene/resource errors, but it does NOT parse GDScript: a project holding a
 * syntax-error script still exits 0 with an empty diagnostics stream (verified
 * on 4.7.2, both with and without `class_name`). Project mode therefore
 * follows it with a second run whose `--script` is a generated `SceneTree`
 * sweep that loads every `.gd` under `res://`, so script parse errors are part
 * of the verdict instead of silently passing.
 *
 * @module @deepseek-ai/dsh-tool-godot/validate
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericResultView, GenericCallView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { resToRelative, resolveProjectRoot, runGodot, withTempGdScript } from './godot-core.ts'
import { collectSceneFiles, validateSceneFile } from './scene-validate.ts'
import type { GodotRun, ResolvedCaps } from './godot-core.ts'
import { validateMeta, validateViewFromMeta } from './presentation.ts'
import type { ValidateMeta } from './presentation.ts'

/** Default cap on issues one `godot_validate` result retains inline. */
export const VALIDATE_MAX_ERRORS = 200

/** Trailing non-empty engine lines a failed run with no parsed issue keeps. */
export const VALIDATE_DIAGNOSTIC_LINES = 12

/** One parsed Godot diagnostics line: an `ERROR:`/`SCRIPT ERROR:`/`WARNING:` and its `at:` location. */
export type GodotIssue = {
  kind: 'error' | 'warning'
  message: string
  path?: string
  line?: number
  column?: number
}

/** Validated `godot_validate` arguments. */
export interface ValidateInput {
  path?: string
  mode: 'project' | 'file' | 'scene'
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `path` when given. Throws a plain `Error` (an ordinary tool argument error)
 * otherwise.
 *
 * @param args - the schema-validated arguments.
 * @returns the accepted input.
 */
export function parseValidateArgs(args: { path?: string; mode?: 'project' | 'file' | 'scene' }): ValidateInput {
  if (args.path !== undefined && args.path.trim().length === 0) throw new Error('path must be a non-empty string when given')
  const mode = args.mode ?? 'project'
  if (mode === 'scene' && args.path === undefined) throw new Error('scene mode requires a path (a .tscn file or a directory)')
  return { ...(args.path !== undefined ? { path: args.path } : {}), mode }
}

/**
 * Build the godot argv for one validation run. `project` mode boots the
 * headless editor against the project root and quits, which imports assets
 * and parses every script; `file` mode parses one script through `--check-only`.
 * Every model-controlled value is a plain argv element.
 *
 * @param mode - the validation mode.
 * @param root - the resolved project root.
 * @param file - the script path for `file` mode.
 * @returns the complete argv (excluding the executable itself).
 */
export function buildValidateCommand(mode: 'project' | 'file', root: string, file: string): string[] {
  if (mode === 'file') return ['--headless', '--check-only', '--script', file, '--path', root]
  return ['--headless', '--editor', '--path', root, '--quit']
}

/**
 * The `SceneTree` sweep project mode runs after the editor import pass. It
 * loads every `.gd` under `res://` once so godot prints the parse diagnostics
 * the editor run never emits, and exits non-zero when any script failed.
 *
 * A broken GDScript loads as an object whose instance base type is empty
 * (that is the validity probe here; `can_instantiate()` is false even for
 * valid scripts whose base class — `SceneTree`, for one — is not
 * ClassDB-instantiable). Dot-directories such as `.godot` are skipped.
 * The trailing marker line is a summary for anyone reading raw output; the
 * tool itself consumes the engine's diagnostics stream.
 */
const SCRIPT_SWEEP_SOURCE = [
  'extends SceneTree',
  '',
  '',
  'func _gd_files(root: String) -> PackedStringArray:',
  '\tvar out := PackedStringArray()',
  '\tvar dir := DirAccess.open(root)',
  '\tif dir == null:',
  '\t\treturn out',
  '\tdir.list_dir_begin()',
  '\tvar entry := dir.get_next()',
  '\twhile entry != "":',
  '\t\tif not entry.begins_with("."):',
  '\t\t\tvar full := root.path_join(entry)',
  '\t\t\tif dir.current_is_dir():',
  '\t\t\t\tout.append_array(_gd_files(full))',
  '\t\t\telif entry.ends_with(".gd"):',
  '\t\t\t\tout.append(full)',
  '\t\tentry = dir.get_next()',
  '\tdir.list_dir_end()',
  '\treturn out',
  '',
  '',
  'func _initialize() -> void:',
  '\tvar files := _gd_files("res://")',
  '\tvar failed := 0',
  '\tfor path in files:',
  '\t\tvar script: Script = ResourceLoader.load(path, "Script", ResourceLoader.CACHE_MODE_IGNORE)',
  '\t\tif script == null or String(script.get_instance_base_type()) == "":',
  '\t\t\tfailed += 1',
  '\tprint("DSH_GODOT_SCRIPT_SWEEP ", JSON.stringify({"checked": files.size(), "failed": failed}))',
  '\tquit(1 if failed > 0 else 0)',
  '',
].join('\n')

/**
 * Build the godot argv for the project-mode GDScript sweep: headless editor,
 * project root, and `--script` pointed at the written sweep bootstrap. The
 * editor flag keeps the parse faithful to what the editor sees (scripts
 * referencing editor-only classes stay valid).
 *
 * @param root - the resolved project root.
 * @param sweepPath - the absolute filesystem path of the sweep script.
 * @returns the complete argv (excluding the executable itself).
 */
export function buildScriptSweepCommand(root: string, sweepPath: string): string[] {
  return ['--headless', '--editor', '--path', root, '--script', sweepPath]
}

/** ANSI CSI sequences godot may emit in terminal builds (colors, cursor moves). */
const ANSI_CSI = /\u001b\[[0-9;]*[A-Za-z]/g

/**
 * Strip ANSI escape sequences from one line of CLI output.
 *
 * @param text - the raw output line.
 * @returns the plain-text line.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, '')
}

const ISSUE_RE = /^\s*(?:SCRIPT\s+)?(ERROR|WARNING):\s?(.*)$/
const AT_RE = /^\s*at:\s+(.+?)(?::(\d+))(?::(\d+))?$/
/**
 * Godot's function-call location form, `at: <function> (<path>:<line>[:<col>])`,
 * emitted by the script-error handler (`at: GDScript::reload (res://a.gd:6)`)
 * and by engine-internal failures (`at: load (modules/.../x.cpp:46)`). The
 * path must end in a Godot text-resource extension so C++ source locations
 * never become issue locations.
 */
const AT_CALL_RE = /^\s*at:\s+.*?\((.+?\.(?:gd|tscn|tres|res|cs|gdshader|shader)):(\d+)(?::(\d+))?\)\s*$/

/**
 * Parse Godot diagnostics from CLI output: `ERROR:` / `SCRIPT ERROR:` /
 * `WARNING:` lines, each optionally followed by an `at:` location line — either
 * `<path>:<line>[:<column>]` or `<function> (<path>:<line>[:<column>])` — with
 * ANSI sequences stripped first. An `at:` line with no pending issue is
 * ignored.
 *
 * @param text - the raw stdout or stderr text.
 * @returns the parsed issues in output order.
 */
export function parseGodotDiagnostics(text: string): GodotIssue[] {
  const issues: GodotIssue[] = []
  let pending: GodotIssue | undefined
  for (const rawLine of text.split('\n')) {
    const line = stripAnsi(rawLine).trim()
    if (line.length === 0) continue
    const issue = ISSUE_RE.exec(line)
    if (issue !== null) {
      pending = { kind: issue[1] === 'ERROR' ? 'error' : 'warning', message: issue[2] as string }
      issues.push(pending)
      continue
    }
    const at = AT_RE.exec(line) ?? AT_CALL_RE.exec(line)
    if (at !== null && pending !== undefined && pending.path === undefined) {
      // The regex guarantees the path and line groups; only the column group
      // is optional.
      const path = at[1] as string
      const lineNumber = at[2] as string
      const column = at[3]
      pending.path = path
      pending.line = Number.parseInt(lineNumber, 10)
      if (column !== undefined) pending.column = Number.parseInt(column, 10)
    }
  }
  return issues
}

/**
 * Engine teardown chatter a `--script` run prints as it exits: quitting the
 * editor's SceneTree early leaves the editor's own resources allocated, so
 * godot reports them as `... leaked at exit` — as `ERROR:` lines that describe
 * the engine's shutdown, never the user's project. Only the sweep run drops
 * them; the editor import pass does not emit them and file mode stays
 * faithful.
 */
const TEARDOWN_NOISE_RE = /leaked at exit|were leaked|scan thread aborted/i

/**
 * Drop godot's own teardown chatter from a sweep run's parsed issues.
 *
 * @param issues - the sweep run's parsed issues.
 * @returns only the issues that describe the project.
 */
export function dropTeardownNoise(issues: readonly GodotIssue[]): GodotIssue[] {
  return issues.filter(issue => !TEARDOWN_NOISE_RE.test(issue.message))
}

/** Parse both captured streams of one completed run into issues. */
function runIssues(run: GodotRun): GodotIssue[] {
  return [...parseGodotDiagnostics(run.stdout), ...parseGodotDiagnostics(run.stderr)]
}

/**
 * Extract the trailing engine output of the first failed run, so a non-zero
 * exit that produced no parseable issue still shows godot's own message
 * instead of a bare "No issues reported." (a crashed or misconfigured engine
 * is exactly that case). stderr wins over stdout; blank lines are dropped and
 * the tail is bounded by {@link VALIDATE_DIAGNOSTIC_LINES}.
 *
 * @param runs - the completed runs of one validation call, in call order.
 * @returns the bounded excerpt, or an empty string when every run succeeded.
 */
export function failedRunExcerpt(runs: readonly GodotRun[]): string {
  const failing = runs.find(run => run.signal !== null || run.exitCode !== 0)
  if (failing === undefined) return ''
  const text = (failing.stderr.trim().length > 0 ? failing.stderr : failing.stdout).trim()
  if (text.length === 0) return ''
  return text.split('\n').filter(line => line.trim().length > 0).slice(-VALIDATE_DIAGNOSTIC_LINES).join('\n')
}

/** The canonical `godot_validate` result. */
export interface ValidateResult {
  /** The resolved project root the validation ran against. */
  projectRoot: string
  /** Which mode the run used. */
  mode: 'project' | 'file' | 'scene'
  /** True when the run exited cleanly with no error-kind issues. */
  ok: boolean
  /** The parsed issues, display-mapped and retained within the inline cap. */
  issues: GodotIssue[]
  /** The process exit code, present when the process exited (omitted when killed by a signal). */
  exitCode?: number
  /** The trailing engine output of a failed run that produced no parsed issue. */
  diagnostics?: string
  /** True when more issues existed than the inline cap retains. */
  issuesTruncated: boolean
  /** True when the subprocess seam dropped stdout bytes past the budget. */
  stdoutTruncated: boolean
  /** True when the subprocess seam dropped stderr bytes past the budget. */
  stderrTruncated: boolean
}

/**
 * Format the model-facing `godot_validate` result text: a pass/fail head,
 * one `path:line:column [kind] message` line per retained issue, a raw engine
 * excerpt when a failed run produced no issue, and truncation notes.
 *
 * @param value - the canonical result.
 * @returns the model-facing text.
 */
export function renderValidateOutput(value: ValidateResult): string {
  const head = value.mode === 'scene'
    ? `Godot scene validation at ${value.projectRoot}: ${value.ok ? 'passed' : 'failed'}`
    : `Godot ${value.mode} validation at ${value.projectRoot}: ${value.ok ? 'passed' : 'failed'} (exit ${value.exitCode ?? 'killed'})`
  if (value.issues.length === 0) {
    const diagnostics = value.diagnostics !== undefined && value.diagnostics.length > 0 ? `\n${value.diagnostics}` : ''
    return `${head}\nNo issues reported.${diagnostics}`
  }
  const body = value.issues
    .map((issue) => {
      const where = [issue.path, issue.line, issue.column].filter(part => part !== undefined).join(':')
      return `  ${where} [${issue.kind}] ${issue.message}`
    })
    .join('\n')
  const notes: string[] = []
  if (value.issuesTruncated) notes.push(`(showing the first ${value.issues.length} issues)`)
  if (value.stdoutTruncated) notes.push('(stdout truncated)')
  if (value.stderrTruncated) notes.push('(stderr truncated)')
  const note = notes.length > 0 ? ` ${notes.join(' ')}` : ''
  return `${head}\n${body}${note}`
}

/**
 * Validate scenes without starting the engine.
 * @param path - a `.tscn` file or a directory, as `res://` or a filesystem path.
 * @param workdir - the session cwd a relative path resolves against.
 * @returns the aggregated result, one issue list across every scene read.
 */
export async function validateScenes(path: string, workdir: string): Promise<ValidateResult> {
  const projectRoot = await resolveProjectRoot(path.startsWith('res://') ? undefined : path, workdir)
  const target = path.startsWith('res://') ? resolve(projectRoot, path.slice('res://'.length)) : resolve(workdir, path)
  const scenes = await collectSceneFiles(target, projectRoot)
  const issues: GodotIssue[] = []
  for (const scene of scenes) {
    try {
      issues.push(...await validateSceneFile(scene.file, { path: scene.path, projectRoot }))
    } catch (error: unknown) {
      issues.push({ kind: 'error', message: `could not read the scene: ${(error as Error).message}`, path: scene.path })
    }
  }
  const retained = issues.slice(0, VALIDATE_MAX_ERRORS)
  return {
    projectRoot,
    mode: 'scene',
    ok: issues.every(issue => issue.kind !== 'error'),
    issues: retained,
    issuesTruncated: issues.length > retained.length,
    stdoutTruncated: false,
    stderrTruncated: false,
  }
}

/**
 * Pending-call presentation: a generic card titled by the mode and target.
 *
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the call runs.
 */
export function presentValidateCall(args: { path?: string; mode?: 'project' | 'file' | 'scene' }): GenericCallView {
  const mode = args.mode ?? 'project'
  const where = args.path !== undefined ? ` ${args.path}` : ' workspace'
  return { card: 'generic', title: `Validate Godot ${mode}${where}` }
}

/**
 * Completed-call presentation: a generic card reconstructed from the result's
 * `presentationMeta` (the retained issues), with editor-jump locations when
 * any issue carries a path. Malformed or absent metadata falls back to the
 * generic card (`undefined`).
 *
 * @param _args - the raw tool arguments; unused, the view derives from the result.
 * @param result - the final model-facing tool result carrying the projected metadata.
 * @returns the generic card view, or `undefined` for the fallback.
 */
export function presentValidateResult(_args: { path?: string; mode?: 'project' | 'file' | 'scene' }, result: ToolResult): GenericResultView | undefined {
  if (result.isError) return undefined
  return validateViewFromMeta(result.meta)
}

/**
 * Register the `godot_validate` tool and its system-prompt guidance.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param caps - per-call resolved caps thunk (settings section over the composition entry).
 */
export function applyValidateTool(ctx: Context, caps: () => ResolvedCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:godot',
    order: 120,
    text:
      'Use godot_validate after editing GDScript to get structured parse errors, godot_run_scene to execute a scene headless and capture its output, '
      + 'godot_format to format a script (returns the formatted text; apply it with write/edit), godot_inspect to read project/scene/resource structure, '
      + 'and godot_editor_script to run a res:// EditorScript in the project. Headless godot runs write the .godot cache and import artifacts.',
  })

  const tool = defineTool({
    name: 'godot_validate',
    description:
      'Validate a Godot project, a single GDScript file, or a scene, and return structured diagnostics. '
      + 'project mode imports and parses the whole project (slower, catches scene/resource errors too); file mode parses one script with --check-only; '
      + 'scene mode reads a .tscn (or every .tscn under a directory) without starting the engine and reports structural mistakes: '
      + 'a Control laid out with anchors inside a Container, a missing parent, a duplicate node path, a missing ext_resource, '
      + 'or a [connection] calling a method the target script does not declare. '
      + 'Returns issues with file, line, column, kind (error/warning), and message. project/file modes require a godot executable configured or on PATH.',
    parameters: {
      path: {
        type: 'string',
        description: 'Project root or .gd file. Defaults to the session workspace; a relative path resolves against it. Discovery walks up for project.godot.',
      },
      mode: {
        type: 'string',
        description: '`project` validates the whole project through the headless editor; `file` validates one script; '
          + '`scene` checks one .tscn (or every scene under a directory) structurally without the engine.',
        enum: ['project', 'file', 'scene'],
      },
    },
    timeoutMs: caps().timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectRoot: { type: 'string', required: true },
          mode: { type: 'string', enum: ['project', 'file', 'scene'], required: true },
          ok: { type: 'boolean', required: true },
          issues: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['error', 'warning'], required: true },
                message: { type: 'string', required: true },
                path: { type: 'string' },
                line: { type: 'number' },
                column: { type: 'number' },
              },
            },
          },
          exitCode: { type: 'number' },
          diagnostics: { type: 'string' },
          issuesTruncated: { type: 'boolean', required: true },
          stdoutTruncated: { type: 'boolean', required: true },
          stderrTruncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderValidateOutput(value) }],
      presentationMeta: (_args, value) => validateMeta(value),
    },
    async execute(args, exec) {
      const c = caps()
      const input = parseValidateArgs(args)
      const workdir = exec.agent?.session.header.cwd ?? process.cwd()
      if (input.mode === 'scene') {
        return await validateScenes(input.path as string, workdir)
      }
      let file = ''
      if (input.mode === 'file') {
        if (input.path === undefined) throw new Error('file mode requires a path')
        file = resolve(workdir, input.path)
      }
      const projectRoot = await resolveProjectRoot(input.path, workdir)
      const first = await runGodot(ctx, exec, 'godot_validate', c.godot, buildValidateCommand(input.mode, projectRoot, file), c)
      const marked: Array<{ run: GodotRun; dropNoise: boolean }> = [{ run: first, dropNoise: false }]
      if (input.mode === 'project') {
        marked.push({
          run: await withTempGdScript(SCRIPT_SWEEP_SOURCE, sweepPath =>
            runGodot(ctx, exec, 'godot_validate', c.godot, buildScriptSweepCommand(projectRoot, sweepPath), c)),
          dropNoise: true,
        })
      }
      const runs = marked.map(entry => entry.run)
      const parsed = marked.flatMap((entry) => {
        const issues = runIssues(entry.run)
        return entry.dropNoise ? dropTeardownNoise(issues) : issues
      })
      const issues = parsed
        .map((issue) => {
          const path = issue.path !== undefined ? resToRelative(issue.path, projectRoot) : undefined
          return { ...issue, ...(path !== undefined ? { path } : {}) }
        })
        .slice(0, c.validateMaxErrors)
      const issuesTruncated = parsed.length > issues.length
      const failed = runs.find(run => run.signal !== null || run.exitCode !== 0)
      const exitCode = (failed ?? first).exitCode
      const ok = runs.every(run => run.exitCode === 0 && run.signal === null) && issues.every(issue => issue.kind !== 'error')
      const diagnostics = failedRunExcerpt(runs)
      return {
        projectRoot,
        mode: input.mode,
        ok,
        issues,
        /* v8 ignore next 1 -- a signal-killed run cannot be driven deterministically in tests */
        ...(exitCode !== null ? { exitCode } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
        issuesTruncated,
        stdoutTruncated: runs.some(run => run.stdoutTruncated),
        stderrTruncated: runs.some(run => run.stderrTruncated),
      }
    },
    presentCall: presentValidateCall,
    presentResult: presentValidateResult,
  })
  ctx.tools.register(tool)
}

export type { ValidateMeta }
