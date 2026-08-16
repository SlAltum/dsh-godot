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

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
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

/**
 * The `godot` settings namespace: the GUI-editable overlay on this plugin's
 * config, owned here so the client card and the settings service agree on
 * the spelling.
 */
export const GODOT_SETTINGS_NAMESPACE = settingsNamespace('godot')

/** Services required by the godot tool suite. */
export const inject = ['tools', 'systemPrompt', 'subprocess']

/** Plugin config; every field has a default. */
export interface Config {
  /** Godot executable path or PATH-resolved command name (default `godot`). */
  executable?: string
  /** Fixed argv elements inserted after the godot executable (deployment wrappers). */
  executableArgs?: string[]
  /** gdformat executable path or PATH-resolved command name (default `gdformat`). */
  gdformatExecutable?: string
  /** Fixed argv elements inserted after the gdformat executable. */
  gdformatArgs?: string[]
  /** `godot_format` backend: `gdformat` (gdtoolkit, default) or `builtin` (embedded TextMate formatter, no Python). */
  formatBackend?: 'gdformat' | 'builtin'
  /** Builtin backend: max consecutive blank lines inside the file (default 2). */
  builtinMaxEmptyLines?: number
  /** Builtin backend: remove extra space inside function parameter lists (default false). */
  builtinDenseFunctionParameters?: boolean
  /** Builtin backend: spaces before an end-of-line comment (`'1'` or `'2'`, default `'1'`). */
  builtinSpacesBeforeEndOfLineComment?: '1' | '2'
  /** Max bytes retained for one run's stdout (default 1 MiB). */
  stdoutMaxBytes?: number
  /** Max bytes retained for one run's stderr (default 256 KiB). */
  stderrMaxBytes?: number
  /** Max issues one `godot_validate` result retains inline (default 200). */
  validateMaxErrors?: number
  /** Terminate-escalation grace (ms), bounded by `MAX_TIMER_DELAY_MS` (default 5000). */
  graceMs?: number
  /** Cooperative tool-call timeout budget (ms) on all tools, enforced through `exec.signal` (default 60000). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  executable: z.string().default('godot'),
  executableArgs: z.array(z.string()).default([]),
  gdformatExecutable: z.string().default('gdformat'),
  gdformatArgs: z.array(z.string()).default([]),
  formatBackend: z.union(['gdformat', 'builtin'] as const).default('gdformat'),
  builtinMaxEmptyLines: z.number().default(2),
  builtinDenseFunctionParameters: z.boolean().default(false),
  builtinSpacesBeforeEndOfLineComment: z.union(['1', '2'] as const).default('1'),
  stdoutMaxBytes: z.number().default(1_048_576),
  stderrMaxBytes: z.number().default(262_144),
  validateMaxErrors: z.number().default(200),
  graceMs: z.number().default(5_000),
  timeoutMs: z.number().default(60_000),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Every cap counts items/bytes/milliseconds — a positive integer, or retention arithmetic misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-godot: ${name} must be a positive integer`)
  }
}

/** Validate one resolved config (composition or settings section) beyond what the schema can express. */
function assertServiceableConfig(value: ResolvedConfig): void {
  assertPositiveInteger('stdoutMaxBytes', value.stdoutMaxBytes)
  assertPositiveInteger('stderrMaxBytes', value.stderrMaxBytes)
  assertPositiveInteger('validateMaxErrors', value.validateMaxErrors)
  assertPositiveInteger('graceMs', value.graceMs)
  assertPositiveInteger('builtinMaxEmptyLines', value.builtinMaxEmptyLines)
  if (value.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-godot: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  assertPositiveInteger('timeoutMs', value.timeoutMs)
}

/**
 * Register the five godot tools. Registration is unconditional; a missing
 * godot executable surfaces as the structured `GODOT_UNAVAILABLE` error at
 * call time, never at load time. The `godot` settings namespace overlays the
 * composition entry: every call re-reads the authoritative config (settings
 * section when one is attached, the composition entry otherwise), so
 * executable changes made in the GUI apply to the next call without a
 * reload.
 *
 * The settings section is attached through `internal/service` events rather
 * than `installSettingsSection`'s `ctx.inject`: in a composed Loader tree the
 * settings provider can register after this plugin's apply ran, and the
 * `ctx.inject` child fiber is then not reliably re-evaluated (observed
 * deterministically failing for function-style plugins while Service-style
 * consumers such as bash-local attach fine). The event fires on every
 * service registration, which the settings provider's construction triggers,
 * so the attach is eventual and race-free.
 *
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 * @param config - resolved plugin configuration from schemastery.
 */
// oxlint-disable-next-line typescript/require-await -- async keeps a load-time config rejection a rejection, not a synchronous throw
export async function apply(ctx: Context, config: Config): Promise<void> {
  // schemastery (Config) has already filled every defaulted field.
  const entry = config as ResolvedConfig
  assertServiceableConfig(entry)

  // The authoritative config source: the settings section while one is
  // attached, the composition entry otherwise.
  let source: () => ResolvedConfig = () => entry
  let attached = false

  const attach = (): void => {
    if (attached) return
    const settings = ctx.get('settings') as { register<T>(ns: unknown, schema: z<T>, options?: { base?: T; validate?: (value: T) => void }): SettingsScope<T> } | undefined
    if (settings === undefined) return
    let scope: SettingsScope<Config> | undefined
    try {
      scope = settings.register<Config>(GODOT_SETTINGS_NAMESPACE, Config, {
        base: entry,
        validate: (value: Config) => {
          assertServiceableConfig(value as ResolvedConfig)
        },
      })
    } catch (error) {
      /* v8 ignore start -- a duplicate registration needs a settings-provider
         reload mid-session, which tests cannot stage deterministically. */
      ctx.logger.warn(`tool-godot: settings registration skipped: ${String(error)}`)
      return
      /* v8 ignore stop */
    }
    attached = true
    source = () => scope.get() as ResolvedConfig
    // Every cap is read through the getter on each call; nothing derived
    // needs rebuilding when the document changes.
    scope.watch(() => {})
  }

  // Attach immediately when the settings service already exists, and listen
  // for its registration when the provider mounts later (composed trees
  // activate entries concurrently, so the provider may appear after apply).
  // The service's unload notification carries `undefined` and detaches back
  // to the composition entry.
  attach()
  ctx.on('internal/service', (name, value) => {
    if (name !== 'settings') return
    if (value === undefined || value === null) {
      attached = false
      source = () => entry
      return
    }
    attach()
  })

  const caps = (): ResolvedCaps => {
    const cfg = source()
    return {
      godot: resolveExecutable(cfg.executable, cfg.executableArgs, 'godot'),
      gdformat: resolveExecutable(cfg.gdformatExecutable, cfg.gdformatArgs, 'gdformat'),
      formatBackend: cfg.formatBackend,
      builtinMaxEmptyLines: cfg.builtinMaxEmptyLines,
      builtinDenseFunctionParameters: cfg.builtinDenseFunctionParameters,
      builtinSpacesBeforeEndOfLineComment: cfg.builtinSpacesBeforeEndOfLineComment === '2' ? 2 : 1,
      stdoutMaxBytes: cfg.stdoutMaxBytes,
      stderrMaxBytes: cfg.stderrMaxBytes,
      validateMaxErrors: cfg.validateMaxErrors,
      graceMs: cfg.graceMs,
      timeoutMs: cfg.timeoutMs,
    }
  }

  applyValidateTool(ctx, caps)
  applyRunSceneTool(ctx, caps)
  applyInspectTool(ctx)
  applyFormatTool(ctx, caps)
  applyEditorScriptTool(ctx, caps)
}
