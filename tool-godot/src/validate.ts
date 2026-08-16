/**
 * The model-facing `godot_validate` tool: validate a whole Godot project
 * (headless editor import + parse, `--editor --quit`) or one GDScript file
 * (`--check-only --script`) and return structured parse errors. Execution
 * spawns the configured godot executable through the subprocess seam with a
 * plain argv vector; this module owns the model-facing schema, argument
 * validation, argv construction, Godot diagnostics parsing, rendering, and
 * presentation.
 *
 * @module @deepseek-ai/dsh-tool-godot/validate
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericResultView, GenericCallView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { resToRelative, resolveProjectRoot, runGodot } from './godot-core.ts'
import type { ResolvedCaps } from './godot-core.ts'
import { validateMeta, validateViewFromMeta } from './presentation.ts'
import type { ValidateMeta } from './presentation.ts'

/** Default cap on issues one `godot_validate` result retains inline. */
export const VALIDATE_MAX_ERRORS = 200

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
  mode: 'project' | 'file'
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `path` when given. Throws a plain `Error` (an ordinary tool argument
 * error) otherwise.
 *
 * @param args - the schema-validated arguments.
 * @returns the accepted input.
 */
export function parseValidateArgs(args: { path?: string; mode?: 'project' | 'file' }): ValidateInput {
  if (args.path !== undefined && args.path.trim().length === 0) throw new Error('path must be a non-empty string when given')
  return { ...(args.path !== undefined ? { path: args.path } : {}), mode: args.mode ?? 'project' }
}

/**
 * Build the godot argv for one validation run. `project` mode boots the
 * headless editor against the project root and quits, which imports assets
 * and parses every script; `file` mode parses one script via `--check-only`.
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
 * Parse Godot diagnostics from CLI output: `ERROR:` / `SCRIPT ERROR:` /
 * `WARNING:` lines, each optionally followed by an `   at: <path>:<line>`
 * (or `:line:column`) location line, with ANSI sequences stripped first.
 * An `at:` line with no pending issue is ignored.
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
    const at = AT_RE.exec(line)
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

/** The canonical `godot_validate` result. */
export interface ValidateResult {
  /** The resolved project root the validation ran against. */
  projectRoot: string
  /** Which mode the run used. */
  mode: 'project' | 'file'
  /** True when the run exited cleanly with no error-kind issues. */
  ok: boolean
  /** The parsed issues, display-mapped and retained within the inline cap. */
  issues: GodotIssue[]
  /** The process exit code, present when the process exited (omitted when killed by a signal). */
  exitCode?: number
  /** True when more issues existed than the inline cap retains. */
  issuesTruncated: boolean
  /** True when the subprocess seam dropped stdout bytes past the budget. */
  stdoutTruncated: boolean
  /** True when the subprocess seam dropped stderr bytes past the budget. */
  stderrTruncated: boolean
}

/**
 * Format the model-facing `godot_validate` result text: a pass/fail head,
 * one `path:line:column [kind] message` line per retained issue, and
 * truncation notes.
 *
 * @param value - the canonical result.
 * @returns the model-facing text.
 */
export function renderValidateOutput(value: ValidateResult): string {
  const head = `Godot ${value.mode} validation at ${value.projectRoot}: ${value.ok ? 'passed' : 'failed'} (exit ${value.exitCode ?? 'killed'})`
  if (value.issues.length === 0) return `${head}\nNo issues reported.`
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
 * Pending-call presentation: a generic card titled by the mode and target.
 *
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the call runs.
 */
export function presentValidateCall(args: { path?: string; mode?: 'project' | 'file' }): GenericCallView {
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
export function presentValidateResult(_args: { path?: string; mode?: 'project' | 'file' }, result: ToolResult): GenericResultView | undefined {
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
      'Validate a Godot project or a single GDScript file with the headless Godot editor and return structured parse errors. '
      + 'project mode imports and parses the whole project (slower, catches scene/resource errors too); file mode parses one script with --check-only. '
      + 'Returns issues with file, line, column, kind (error/warning), and message. Requires a godot executable configured or on PATH.',
    parameters: {
      path: {
        type: 'string',
        description: 'Project root or .gd file. Defaults to the session workspace; a relative path resolves against it. Discovery walks up for project.godot.',
      },
      mode: {
        type: 'string',
        description: 'project validates the whole project via the headless editor; file validates one script.',
        enum: ['project', 'file'],
      },
    },
    timeoutMs: caps().timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectRoot: { type: 'string', required: true },
          mode: { type: 'string', enum: ['project', 'file'], required: true },
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
      let file = ''
      if (input.mode === 'file') {
        if (input.path === undefined) throw new Error('file mode requires a path')
        file = resolve(workdir, input.path)
      }
      const projectRoot = await resolveProjectRoot(input.path, workdir)
      const run = await runGodot(ctx, exec, 'godot_validate', c.godot, buildValidateCommand(input.mode, projectRoot, file), c)
      const parsed = [...parseGodotDiagnostics(run.stdout), ...parseGodotDiagnostics(run.stderr)]
      const issues = parsed
        .map((issue) => {
          const path = issue.path !== undefined ? resToRelative(issue.path, projectRoot) : undefined
          return { ...issue, ...(path !== undefined ? { path } : {}) }
        })
        .slice(0, c.validateMaxErrors)
      const issuesTruncated = parsed.length > issues.length
      const ok = run.exitCode === 0 && run.signal === null && issues.every(issue => issue.kind !== 'error')
      return {
        projectRoot,
        mode: input.mode,
        ok,
        issues,
        /* v8 ignore next 1 -- a signal-killed run cannot be driven deterministically in tests */
        ...(run.exitCode !== null ? { exitCode: run.exitCode } : {}),
        issuesTruncated,
        stdoutTruncated: run.stdoutTruncated,
        stderrTruncated: run.stderrTruncated,
      }
    },
    presentCall: presentValidateCall,
    presentResult: presentValidateResult,
  })
  ctx.tools.register(tool)
}

export type { ValidateMeta }
