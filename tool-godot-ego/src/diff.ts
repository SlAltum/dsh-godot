/**
 * `godot_diff`: compare the current frame with the previous one inside the
 * engine (`Image.compute_image_metrics`). The host never decodes pixels; the
 * bridge keeps the last captured frame, so a `godot_see` (or an earlier
 * `godot_diff`) must have run first.
 * @module @deepseek-ai/dsh-tool-godot-ego/diff
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GameSessionRegistry } from './session-service.ts'
import { sessionFor } from './tool-support.ts'

/** `godot_diff` arguments. */
export interface DiffArgs {
  useLuma?: boolean
}

/** What `godot_diff` returns to the model. */
export interface DiffResult {
  readonly mean: number
  readonly mean_squared: number
  readonly peak_snr: number
  readonly frame: number
}

/** Read one numeric metric, defaulting to 0 when the engine omitted it. */
function metricOf(metrics: Readonly<Record<string, unknown>>, key: string): number {
  const value = metrics[key]
  return typeof value === 'number' ? value : 0
}

/**
 * Build the `godot_diff` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function diffTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_diff',
    description: 'Measure how much the frame changed since the previous capture. '
      + 'Returns mean absolute difference, mean squared difference, peak SNR, and the frame number; '
      + 'a still scene reports mean 0. Call godot_see first so the bridge has a frame to compare against.',
    parameters: {
      useLuma: { type: 'boolean', description: 'Compare luminance instead of per-channel values (default true).' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mean: { type: 'number', required: true },
          mean_squared: { type: 'number', required: true },
          peak_snr: { type: 'number', required: true },
          frame: { type: 'number', required: true },
        },
      },
      render: (_args, value: DiffResult) => [{
        type: 'text',
        text: `mean ${String(value.mean)} · mse ${String(value.mean_squared)} · psnr ${String(value.peak_snr)} dB · frame ${value.frame}`,
      }],
    },
    async execute(args: DiffArgs, exec): Promise<DiffResult> {
      const session = sessionFor(registry, exec)
      const reply = await session.request('shotdiff', { useLuma: args.useLuma ?? true }, exec.signal)
      const metrics = typeof reply.payload.metrics === 'object' && reply.payload.metrics !== null
        ? reply.payload.metrics as Readonly<Record<string, unknown>>
        : {}
      return {
        mean: metricOf(metrics, 'mean'),
        mean_squared: metricOf(metrics, 'mean_squared'),
        peak_snr: metricOf(metrics, 'peak_snr'),
        frame: typeof reply.payload.frame === 'number' ? reply.payload.frame : 0,
      }
    },
  })
}
