/**
 * `godot_wait_for`: poll the running game until one condition holds. The
 * condition reads either a top-level `state` field (`frames`, `fps`,
 * `nodeCount`, `paused`, `scene`) or one node property; no bridge change is
 * involved, so it works with every protocol version this package speaks.
 * @module @deepseek-ai/dsh-tool-godot-ego/wait-for
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { EgoGodotError } from './errors.ts'
import { formatValue } from './node.ts'
import type { GameSessionRegistry, EgoSessionHandle } from './session-service.ts'
import { sessionFor } from './tool-support.ts'

/** Default total wait budget. */
const DEFAULT_TIMEOUT_MS = 10_000

/** Default pause between two observations. */
const DEFAULT_INTERVAL_MS = 200

/** `godot_wait_for` arguments. */
export interface WaitForArgs {
  path?: string
  property?: string
  equals?: string | number | boolean
  exists?: boolean
  timeoutMs?: number
  intervalMs?: number
}

/** What `godot_wait_for` returns to the model. */
export interface WaitForResult {
  readonly property: string
  readonly value: string | number | boolean
  readonly elapsedMs: number
}

/** Sleep for a bounded interval. */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

/** Reject a non-positive budget. */
function assertBudget(name: string, value: number): void {
  if (value < 1) throw new Error(`${name} must be positive`)
}

/** Read one node property through the bridge. */
async function readNodeProperty(
  session: EgoSessionHandle,
  path: string,
  property: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const reply = await session.request('node', { path, props: [property], maxProps: 1 }, signal)
  if (typeof reply.payload.error === 'string') {
    throw new EgoGodotError(`no node at "${path}" in the current scene`, 'GODOT_EGO_REJECTED')
  }
  const rows: unknown[] = Array.isArray(reply.payload.props) ? reply.payload.props as unknown[] : []
  const row = rows.find(candidate => (candidate as Record<string, unknown>).name === property) as Record<string, unknown> | undefined
  return row === undefined ? undefined : row.value
}

/** Whether one node currently exists in the scene. */
async function nodeExists(session: EgoSessionHandle, path: string, signal: AbortSignal | undefined): Promise<boolean> {
  const reply = await session.request('node', { path, maxProps: 0 }, signal)
  return typeof reply.payload.error !== 'string'
}

/** One resolved wait condition. */
interface WaitCondition {
  readonly label: string
  readonly expected: string | number | boolean
  read(): Promise<unknown>
}

/** Validate the arguments and build the condition. */
function conditionOf(session: EgoSessionHandle, args: WaitForArgs, signal: AbortSignal | undefined): WaitCondition {
  if (args.exists !== undefined) {
    if (args.path === undefined) throw new Error('exists requires path')
    if (args.property !== undefined || args.equals !== undefined) {
      throw new Error('exists cannot be combined with property or equals')
    }
    const path = args.path
    return { label: path, expected: args.exists, read: () => nodeExists(session, path, signal) }
  }
  if (args.property === undefined) throw new Error('wait_for requires property and equals, or path and exists')
  if (args.equals === undefined) throw new Error('wait_for requires equals together with property')
  const property = args.property
  const path = args.path
  return {
    label: path === undefined ? `state.${property}` : `${path}.${property}`,
    expected: args.equals,
    read: () => path === undefined
      ? session.request('state', {}, signal).then(reply => reply.payload[property])
      : readNodeProperty(session, path, property, signal),
  }
}

/**
 * Build the `godot_wait_for` tool definition.
 * @param registry - the plugin-owned session registry.
 * @returns the tool definition.
 */
export function waitForTool(registry: GameSessionRegistry): ToolDefinition {
  return defineTool({
    name: 'godot_wait_for',
    description: 'Wait until a value in the running game equals an expected value, or until a node appears or disappears. '
      + 'With path and property, poll one node property (for example, path "Main/Score", property "text", equals "3"); '
      + 'without path, poll a state field (frames, fps, nodeCount, paused, scene). '
      + 'Pass path with exists true/false to wait for a node to appear or disappear. '
      + 'Fails with a timeout that reports the last observed value.',
    parameters: {
      path: { type: 'string', description: 'Node path to read a property from or to wait for.' },
      property: { type: 'string', description: 'Property or state field name; omitted with exists.' },
      equals: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
        description: 'Expected value; compared with strict equality.',
      },
      exists: { type: 'boolean', description: 'Wait for the node at path to exist (true) or disappear (false).' },
      timeoutMs: { type: 'integer', description: 'Total wait budget in milliseconds (default 10000).' },
      intervalMs: { type: 'integer', description: 'Pause between two observations in milliseconds (default 200).' },
    },
    timeoutMs: 120_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          property: { type: 'string', required: true },
          value: { type: 'json', required: true },
          elapsedMs: { type: 'number', required: true },
        },
      },
      render: (args, value: WaitForResult) => [{
        type: 'text',
        text: args.exists === undefined
          ? `${args.path === undefined ? 'state' : args.path}.${value.property} = ${formatValue(value.value)} after ${value.elapsedMs} ms`
          : `${args.path} ${value.value === true ? 'exists' : 'is absent'} after ${value.elapsedMs} ms`,
      }],
    },
    async execute(args: WaitForArgs, exec): Promise<WaitForResult> {
      const session = sessionFor(registry, exec)
      const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const intervalMs = args.intervalMs ?? DEFAULT_INTERVAL_MS
      assertBudget('timeoutMs', timeoutMs)
      assertBudget('intervalMs', intervalMs)
      const condition = conditionOf(session, args, exec.signal)
      const started = Date.now()
      const deadline = started + timeoutMs
      let last: unknown
      for (;;) {
        last = await condition.read()
        if (Object.is(last, condition.expected)) {
          return {
            property: args.property ?? 'exists',
            value: last as string | number | boolean,
            elapsedMs: Date.now() - started,
          }
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          const target = args.exists === undefined
            ? `"${condition.label}" never reached ${JSON.stringify(condition.expected)}`
            : `"${condition.label}" did not ${args.exists ? 'appear' : 'disappear'}`
          throw new EgoGodotError(
            `${target} within ${timeoutMs} ms (last ${formatValue(last)})`,
            'GODOT_EGO_TIMEOUT',
          )
        }
        await delay(Math.min(intervalMs, remaining))
      }
    },
  })
}
