/**
 * The model-facing Godot project tool suite (`godot_validate`,
 * `godot_run_scene`, `godot_format`, `godot_inspect`, `godot_editor_script`)
 * over headless Godot CLI subprocesses. This single plugin registers all five
 * tools; the godot binary is a host install (or a configured path), so —unlike
 * the packaged-ripgrep search suite— no binary ships inside the package.
 *
 * ## Spawn-backed, not a `ctx.fs` provider method
 *
 * Local Godot workflows are process-backed CLI runs, so the tools execute
 * through `ctx.subprocess.spawn()` with fixed godot argv templates — never
 * `ctx.shell`, never `ctx.shell.start()`, never a model-visible background
 * task. The tool layer owns schemas, argument validation, argv construction,
 * result parsing, retention, and timeout declaration; the subprocess seam
 * owns spawn execution, process-tree termination, environment scrubbing, and
 * raw output capture. The package injects `tools`, `systemPrompt`, and
 * `subprocess` — deliberately NOT `fs`; only `godot_inspect` and
 * `godot_format` touch the filesystem at all, through plain `node:fs` reads
 * of Godot's text formats (project/scene/resource parsing) and a temporary
 * formatting copy — the format tool never writes the user's file, so file
 * mutations stay on the policy-enforced `write`/`edit` surface.
 *
 * @module @deepseek-ai/dsh-tool-godot
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveExecutable } from './godot-core.ts'
import type { ResolvedCaps } from './godot-core.ts'
import { applyValidateTool } from './validate.ts'
import { applyRunSceneTool } from './run-scene.ts'
import { applyInspectTool } from './inspect.ts'
import { applyFormatTool } from './format.ts'
import { applyEditorScriptTool } from './editor-script.ts'

export {
  GodotError,
  MAX_PROJECT_ROOT_WALK,
  PROJECT_FILE,
  displayPath,
  findProjectRoot,
  resolveExecutable,
  resolveProjectRoot,
  resToRelative,
  runGodot,
} from './godot-core.ts'
export type { GodotCaps, GodotErrorCode, GodotExecutable, GodotRun, ResolvedCaps } from './godot-core.ts'
export { applyValidateTool, buildValidateCommand, parseGodotDiagnostics, parseValidateArgs, presentValidateCall, presentValidateResult, renderValidateOutput, stripAnsi } from './validate.ts'
export type { GodotIssue, ValidateInput, ValidateResult } from './validate.ts'
export { applyRunSceneTool, buildRunSceneCommand, parseRunSceneArgs, presentRunSceneCall, renderRunSceneOutput } from './run-scene.ts'
export type { RunSceneInput, RunSceneResult } from './run-scene.ts'
export { applyInspectTool, parseAttrs, parseInspectArgs, parseProjectFile, parseResourceFile, parseSceneFile, presentInspectCall, renderInspectOutput, resolveInspectTarget } from './inspect.ts'
export type { ExtResource, InspectInput, InspectResult, ProjectInfo, ResourceInfo, SceneInfo, SceneNode } from './inspect.ts'
export { applyFormatTool, buildFormatCommand, parseFormatArgs, presentFormatCall, presentFormatResult } from './format.ts'
export type { FormatInput, FormatResult } from './format.ts'
export { applyEditorScriptTool, buildEditorScriptCommand, parseEditorScriptArgs, presentEditorScriptCall, renderEditorScriptOutput, tryParseJson } from './editor-script.ts'
export type { EditorScriptInput, EditorScriptResult } from './editor-script.ts'
export { capUtf8, formatMeta, formatViewFromMeta, validateMeta, validateViewFromMeta } from './presentation.ts'
export type { FormatMeta, ValidateMeta } from './presentation.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-godot'

/** Services required by the godot tool suite. */
export const inject = ['tools', 'systemPrompt', 'subprocess']

/**
 * Plugin config. The executable paths, the format backend, and the call
 * timeout are volatile: the settings form edits them live, and every call
 * reads the reference again, so a saved value applies to the next call
 * without remounting. The remaining caps stay composition-level by design —
 * a registered tool's timeout declaration is read once at registration.
 */
export interface Config {
  /** Godot executable path or PATH-resolved command name (default `godot`). */
  executable: Volatile<string>
  /** Fixed argv elements inserted after the godot executable (deployment wrappers). */
  executableArgs: string[]
  /** gdformat executable path or PATH-resolved command name (default `gdformat`). */
  gdformatExecutable: Volatile<string>
  /** Fixed argv elements inserted after the gdformat executable. */
  gdformatArgs: string[]
  /** `godot_format` backend: `gdformat` (gdtoolkit, default) or `builtin` (embedded TextMate formatter, no Python). */
  formatBackend: Volatile<'gdformat' | 'builtin'>
  /** Builtin backend: max consecutive blank lines inside the file (default 2). */
  builtinMaxEmptyLines: number
  /** Builtin backend: remove extra space inside function parameter lists (default false). */
  builtinDenseFunctionParameters: boolean
  /** Builtin backend: spaces before an end-of-line comment (`'1'` or `'2'`, default `'1'`). */
  builtinSpacesBeforeEndOfLineComment: '1' | '2'
  /** Max bytes retained for one run's stdout (default 1 MiB). */
  stdoutMaxBytes: number
  /** Max bytes retained for one run's stderr (default 256 KiB). */
  stderrMaxBytes: number
  /** Max issues one `godot_validate` result retains inline (default 200). */
  validateMaxErrors: number
  /** Terminate-escalation grace (ms), bounded by `MAX_TIMER_DELAY_MS` (default 5000). */
  graceMs: number
  /** Cooperative tool-call timeout budget (ms) on all tools, enforced through `exec.signal` (default 60000). */
  timeoutMs: Volatile<number>
}

export const Config = z.object({
  executable: z.string().default('godot').volatile(),
  executableArgs: z.array(z.string()).default([]),
  gdformatExecutable: z.string().default('gdformat').volatile(),
  gdformatArgs: z.array(z.string()).default([]),
  formatBackend: z.union(['gdformat', 'builtin'] as const).default('gdformat').volatile(),
  builtinMaxEmptyLines: z.number().min(1).step(1).default(2),
  builtinDenseFunctionParameters: z.boolean().default(false),
  builtinSpacesBeforeEndOfLineComment: z.union(['1', '2'] as const).default('1'),
  stdoutMaxBytes: z.number().min(1).step(1).default(1_048_576),
  stderrMaxBytes: z.number().min(1).step(1).default(262_144),
  validateMaxErrors: z.number().min(1).step(1).default(200),
  graceMs: z.number().min(1).step(1).max(MAX_TIMER_DELAY_MS).default(5_000),
  timeoutMs: z.number().min(1).step(1).default(60_000).volatile(),
})

/**
 * Register the five godot tools. Registration is unconditional; a missing
 * godot executable surfaces as the structured `GODOT_UNAVAILABLE` error at
 * call time, never at load time. The volatile config references are read on
 * every call, so an executable saved in the settings card applies to the next
 * call without a reload.
 *
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 * @param config - resolved plugin configuration from schemastery.
 */
// oxlint-disable-next-line typescript/require-await -- async keeps a load-time config rejection a rejection, not a synchronous throw
export async function apply(ctx: Context, config: Config): Promise<void> {
  // A custom card renders this entry's fields in the Plugins page, so the
  // generic generated page is suppressed.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })

  const caps = (): ResolvedCaps => {
    const endComment = config.builtinSpacesBeforeEndOfLineComment
    return {
      godot: resolveExecutable(config.executable.get(), config.executableArgs, 'godot'),
      gdformat: resolveExecutable(config.gdformatExecutable.get(), config.gdformatArgs, 'gdformat'),
      formatBackend: config.formatBackend.get(),
      builtinMaxEmptyLines: config.builtinMaxEmptyLines,
      builtinDenseFunctionParameters: config.builtinDenseFunctionParameters,
      builtinSpacesBeforeEndOfLineComment: endComment === '2' ? 2 : 1,
      stdoutMaxBytes: config.stdoutMaxBytes,
      stderrMaxBytes: config.stderrMaxBytes,
      validateMaxErrors: config.validateMaxErrors,
      graceMs: config.graceMs,
      timeoutMs: config.timeoutMs.get(),
    }
  }

  applyValidateTool(ctx, caps)
  applyRunSceneTool(ctx, caps)
  applyInspectTool(ctx)
  applyFormatTool(ctx, caps)
  applyEditorScriptTool(ctx, caps)
}
