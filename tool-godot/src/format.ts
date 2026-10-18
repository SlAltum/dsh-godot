/**
 * The model-facing `godot_format` tool: format one GDScript file and return
 * the formatted text. The default backend runs `gdformat` (gdtoolkit) on a
 * temporary copy; the `builtin` backend formats in-process with an embedded
 * TextMate-based formatter (`gdscript-format.ts`) and needs no Python. The
 * tool is deliberately READ-ONLY: it never writes the target file, so file
 * mutations stay on the policy-enforced `write`/`edit` surface and the model
 * applies the change. This module owns the schema, argument validation, the
 * temp-copy flow, rendering, and the diff-card presentation.
 *
 * @module @deepseek-ai/dsh-tool-godot/format
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffResultView, GenericCallView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { GodotError, displayPath, runGodot } from './godot-core.ts'
import type { ResolvedCaps } from './godot-core.ts'
import { formatGdscript } from './gdscript-format.ts'
import { formatMeta, formatViewFromMeta } from './presentation.ts'

/** The gdformat exit that means "formatter itself failed" vs "file invalid". */
const GDFORMAT_INFRA_RE = /Traceback|No module named|not found/i

/** Validated `godot_format` arguments. */
export interface FormatInput {
  file: string
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `file`. Throws a plain `Error` (an ordinary tool argument error)
 * otherwise.
 *
 * @param args - the schema-validated arguments.
 * @returns the accepted input.
 */
export function parseFormatArgs(args: { file: string }): FormatInput {
  if (args.file.trim().length === 0) throw new Error('file must be a non-empty string')
  return { file: args.file }
}

/**
 * Build the gdformat argv: the temporary copy path. Every value is a plain
 * argv element.
 *
 * @param tmpFile - the temporary copy to format in place.
 * @returns the complete argv (excluding the executable itself).
 */
export function buildFormatCommand(tmpFile: string): string[] {
  return [tmpFile]
}

/** The canonical `godot_format` result. */
export interface FormatResult {
  /** The display path of the formatted file. */
  file: string
  /** The formatted text (from the temporary copy). */
  formatted: string
  /**
   * The original file text, carried only so the pure `presentationMeta`
   * projection can derive the diff card's before-image; the model-facing
   * render does not show it.
   */
  original: string
  /** True when formatting changed the file's text. */
  changed: boolean
}

/**
 * Pending-call presentation: a generic card titled by the file.
 *
 * @param args - the raw tool arguments.
 * @returns the generic card view shown while the call runs.
 */
export function presentFormatCall(args: { file: string }): GenericCallView {
  return { card: 'generic', title: `Format GDScript ${args.file}` }
}

/**
 * Completed-call presentation: a diff card reconstructed from the result's
 * `presentationMeta` (the before/after text). Malformed or absent metadata
 * falls back to the generic card (`undefined`).
 *
 * @param _args - the raw tool arguments; unused, the view derives from the result.
 * @param result - the final model-facing tool result carrying the projected metadata.
 * @returns the diff card view, or `undefined` for the fallback.
 */
export function presentFormatResult(_args: { file: string }, result: ToolResult): DiffResultView | undefined {
  if (result.isError) return undefined
  return formatViewFromMeta(result.meta)
}

/**
 * Register the `godot_format` tool.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param caps - per-call resolved caps thunk (settings section over the composition entry).
 */
export function applyFormatTool(ctx: Context, caps: () => ResolvedCaps): void {
  const tool = defineTool({
    name: 'godot_format',
    description:
      'Format a GDScript file and return the formatted text plus whether it changed. '
      + 'The default backend is gdformat (gdtoolkit); the builtin backend (formatBackend: builtin) uses an embedded '
      + 'TextMate-based formatter and needs no Python. The tool never writes the file itself: apply the returned '
      + 'text with the write or edit tool so file policy applies.',
    parameters: {
      file: {
        type: 'string',
        required: true,
        description: 'Path to the .gd file to format (absolute or relative to the session workspace).',
      },
    },
    timeoutMs: caps().timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', required: true },
          formatted: { type: 'string', required: true },
          original: { type: 'string', required: true },
          changed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Formatted ${value.file}${value.changed ? ' (changed)' : ' (already formatted)'}:\n${value.formatted}` }],
      presentationMeta: (_args, value) => formatMeta(value),
    },
    async execute(args, exec) {
      const c = caps()
      const input = parseFormatArgs(args)
      const workdir = exec.agent?.session.header.cwd ?? process.cwd()
      const target = isAbsolute(input.file) ? input.file : resolve(workdir, input.file)
      let original: string
      try {
        original = await readFile(target, 'utf8')
      } catch (error) {
        throw new GodotError(`cannot read ${target}`, 'GODOT_PARSE_ERROR', { cause: error })
      }
      if (c.formatBackend === 'builtin') {
        const formatted = await formatGdscript(original, {
          maxEmptyLines: c.builtinMaxEmptyLines,
          denseFunctionParameters: c.builtinDenseFunctionParameters,
          spacesBeforeEndOfLineComment: c.builtinSpacesBeforeEndOfLineComment,
        })
        return { file: displayPath(target, workdir), formatted, original, changed: formatted !== original }
      }
      const tmpFile = join(tmpdir(), `dsh-godot-format-${process.pid}-${randomUUID()}.gd`)
      await writeFile(tmpFile, original, 'utf8')
      try {
        const run = await runGodot(ctx, exec, 'godot_format', c.gdformat, buildFormatCommand(tmpFile), c)
        /* v8 ignore next 1 -- a signal-killed gdformat run cannot be driven deterministically in tests */
        if (run.exitCode !== 0 || run.signal !== null) {
          if (GDFORMAT_INFRA_RE.test(run.stderr)) {
            throw new GodotError(`gdformat failed to run: ${run.stderr.trim()}`, 'GODOT_FORMAT_UNAVAILABLE')
          }
          throw new GodotError(`gdformat rejected ${target}: ${run.stderr.trim()}`, 'GODOT_PARSE_ERROR')
        }
        let formatted: string
        /* v8 ignore start -- the temp file was written by this tool; an
           unreadable-after-write race cannot be driven in tests. */
        try {
          formatted = await readFile(tmpFile, 'utf8')
        } catch (error) {
          throw new GodotError('gdformat produced no readable output', 'GODOT_FORMAT_UNAVAILABLE', { cause: error })
        }
        /* v8 ignore stop */
        return { file: displayPath(target, workdir), formatted, original, changed: formatted !== original }
      } finally {
        /* v8 ignore start -- rm(force: true) cannot reject for a missing temp file; the guard is defensive. */
        await rm(tmpFile, { force: true }).catch(() => {})
        /* v8 ignore stop */
      }
    },
    presentCall: presentFormatCall,
    presentResult: presentFormatResult,
  })
  ctx.tools.register(tool)
}
