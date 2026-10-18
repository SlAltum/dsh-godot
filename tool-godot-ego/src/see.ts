/**
 * `godot_see`: capture one frame and hand it to the model as an image block.
 *
 * Three tiers (plan D15): the engine already encoded the frame as WebP
 * (preview default), JPEG, or PNG (pixel tier, explicit). Delivery has three
 * gates — a mounted attachment store, a model route that declares image input,
 * and the store's media/byte limits — and any failure degrades to "write a
 * temp file and name it" rather than failing the call (plan B3).
 * @module @deepseek-ai/dsh-tool-godot-ego/see
 */

import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ResolvedEgoConfig } from './config.ts'
import { EgoGodotError } from './errors.ts'
import type { GameSessionRegistry } from './session-service.ts'

/** Attachment metadata carried through the tool result (JSON-safe). */
export interface SeeImageValue {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
}

/** What `godot_see` returns to the model. */
export interface SeeResult {
  readonly frame: number
  readonly width: number
  readonly height: number
  readonly bytes: number
  readonly path?: string
  readonly image?: SeeImageValue
  readonly note?: string
}

/** `godot_see` arguments. */
export interface SeeArgs {
  format?: 'png' | 'jpg' | 'webp'
  quality?: number
  maxWidth?: number
  target?: string
  ifUnchanged?: 'skip'
}

const MEDIA: Record<'png' | 'jpg' | 'webp', ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

/**
 * Re-brand the stored reference into the image block shape.
 * @param image - the stored metadata.
 */
function imageRef(image: SeeImageValue): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType as ImageMediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
  }
}

/** The slice of `exec.agent` the vision gate reads. */
interface AgentRouteView {
  session?: { requestHeader?: () => { config?: { provider?: string; model?: string } } }
  options?: { provider?: string; model?: string }
}

/**
 * Whether the calling model route explicitly declares image input.
 * @param ctx - plugin context (optional `llm`).
 * @param exec - the tool execution context.
 */
async function imageCapable(ctx: Context, exec: { agent?: unknown; signal: AbortSignal }): Promise<boolean> {
  const agent = exec.agent as AgentRouteView | undefined
  const routed = agent?.session?.requestHeader?.().config
  const provider = routed?.provider ?? agent?.options?.provider
  const model = routed?.model ?? agent?.options?.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) return false
  const info = await llm.resolveModelInfo(provider, model, exec.signal)
  return info.inputModalities?.includes('image') === true
}

/** Model-facing line beside the image block. */
function formatSee(value: SeeResult): string {
  const saved = value.path === undefined ? '' : ` · saved to ${value.path}`
  const note = value.note === undefined ? '' : ` · ${value.note}`
  return `${value.width}x${value.height} · ${value.bytes} B · frame ${value.frame}${saved}${note}`
}

/**
 * Build the `godot_see` tool definition.
 * @param ctx - plugin context (optional `attachments`/`llm`).
 * @param registry - the plugin-owned session registry.
 * @param config - resolved plugin config (preview width default).
 * @returns the tool definition.
 */
export function seeTool(ctx: Context, registry: GameSessionRegistry, config: ResolvedEgoConfig): ToolDefinition {
  const lastFrame = new Map<string, number>()
  return defineTool({
    name: 'godot_see',
    description: 'Capture the current frame of the running game and return it as an image. '
      + 'The default preview is a WebP downscaled to the configured width; pass format: "png" for pixel-exact checks. '
      + 'Use target to crop one Control (cheaper and sharper than the whole frame) and ifUnchanged: "skip" to avoid resending an identical frame.',
    parameters: {
      format: { type: 'string', enum: ['png', 'jpg', 'webp'], description: 'Image encoding: webp (default preview), jpg, or png for pixel-exact work.' },
      quality: { type: 'number', description: 'Lossy quality for jpg/webp, 0.01-1.0 (engine default 0.85).' },
      maxWidth: { type: 'number', description: 'Downscale width in pixels; defaults to the configured preview width.' },
      target: { type: 'string', description: 'Control path to crop to (for example, "Main/HUD/StartButton").' },
      ifUnchanged: { type: 'string', enum: ['skip'], description: '`skip` returns text only when the frame number did not change.' },
    },
    timeoutMs: 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          frame: { type: 'number', required: true },
          width: { type: 'number', required: true },
          height: { type: 'number', required: true },
          bytes: { type: 'number', required: true },
          path: { type: 'string' },
          note: { type: 'string' },
          image: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'number', required: true },
              width: { type: 'number', required: true },
              height: { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value: SeeResult) => {
        const text: ContentBlock = { type: 'text', text: formatSee(value) }
        return value.image === undefined ? [text] : [text, { type: 'image', attachment: imageRef(value.image) }]
      },
    },
    async execute(args: SeeArgs, exec): Promise<SeeResult> {
      const workspace = exec.agent?.session.header.cwd ?? process.cwd()
      const session = registry.get(workspace)
      if (session === undefined) {
        throw new EgoGodotError('no running game session; call godot_play first', 'GODOT_EGO_NO_SESSION')
      }
      const format = args.format ?? 'webp'
      const reply = await session.request('shot', {
        format,
        maxWidth: args.maxWidth ?? config.maxWidth,
        ...(args.quality !== undefined ? { quality: args.quality } : {}),
        ...(args.target !== undefined ? { target: args.target } : {}),
      }, exec.signal)
      const payload = reply.payload
      const size = Array.isArray(payload.size) ? payload.size : []
      const width = typeof size[0] === 'number' ? size[0] : 0
      const height = typeof size[1] === 'number' ? size[1] : 0
      const bytes = typeof payload.bytes === 'number' ? payload.bytes : 0
      const frame = typeof payload.frame === 'number' ? payload.frame : 0
      const previous = lastFrame.get(workspace)
      lastFrame.set(workspace, frame)
      if (args.ifUnchanged === 'skip' && previous === frame) {
        return { frame, width, height, bytes, note: 'unchanged since the previous capture' }
      }
      const data = Buffer.from(typeof payload.data === 'string' ? payload.data : '', 'base64')
      const mediaType = MEDIA[format]
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        return await fallback(data, format, { frame, width, height, bytes }, 'no attachment store is mounted')
      }
      if (!(await imageCapable(ctx, exec))) {
        return await fallback(data, format, { frame, width, height, bytes }, 'the current model route does not declare image input')
      }
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        return await fallback(data, format, { frame, width, height, bytes }, `${mediaType} is not accepted by this deployment`)
      }
      if (data.length > attachments.imageLimits.maxImageBytes) {
        return await fallback(data, format, { frame, width, height, bytes }, 'the frame exceeds the deployment image byte limit')
      }
      const saved = await attachments.saveImage({ data, mediaType, name: `godot-${frame}.${format}` })
      return {
        frame,
        width,
        height,
        bytes,
        image: {
          attachmentId: saved.attachmentId,
          mediaType: saved.mediaType,
          bytes: saved.bytes,
          width: saved.width,
          height: saved.height,
        },
      }
    },
  })
}

/** Degrade to a temp file plus a note naming why the image was not attached. */
async function fallback(
  data: Buffer,
  format: 'png' | 'jpg' | 'webp',
  base: { frame: number; width: number; height: number; bytes: number },
  reason: string,
): Promise<SeeResult> {
  const path = join(tmpdir(), `dsh-godot-ego-${base.frame}.${format}`)
  await writeFile(path, data)
  return { ...base, path, note: reason }
}
