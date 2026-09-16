/**
 * A fake subprocess seam for runDebug tests: resolveExecutable is identity,
 * spawn records the argv and returns a controllable handle (done facts,
 * collected streams, terminate). The fake game replays the T3.0 recordings.
 */

import type { SubprocessLike } from '@deepseek-ai/dsh-lsp-godot'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

export interface SpawnedFacts {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export class FakeSubprocess implements SubprocessLike {
  readonly spawns: { argv: readonly string[]; handle: FakeHandle }[] = []
  versionLine = '4.7.stable.mono.official.5b4e0cb0f'

  async resolveExecutable(command: string): Promise<string> {
    return command
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = new FakeHandle(spec, this.versionLine)
    this.spawns.push({ argv: spec.argv, handle })
    // The version probe resolves immediately with the configured line; the
    // game spawn stays open until the test settles or terminates it.
    if (spec.argv.includes('--version')) {
      queueMicrotask(() => {
        handle.exitNow({ exitCode: 0, signal: null })
      })
    }
    return handle
  }
}

export class FakeHandle implements SubprocessHandle {
  terminated = false
  readonly collected: SubprocessHandle['collected']
  private resolveDone!: (facts: SpawnedFacts) => void
  readonly done: Promise<SpawnedFacts> = new Promise((resolve) => {
    this.resolveDone = resolve
  })
  readonly control = undefined
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined

  constructor(
    spec: SubprocessSpawnSpec,
    versionLine: string,
  ) {
    const text = spec.argv.includes('--version') ? `${versionLine}\n` : ''
    const stream = () => ({ readFrom: () => ({ text, nextOffset: 0, lossy: false }) })
    this.collected = {
      stdout: stream(),
      stderr: stream(),
    }
  }

  /** Tests settle the process exit. */
  exitNow(facts: SpawnedFacts): void {
    this.resolveDone(facts)
  }

  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.resolveDone({ exitCode: null, signal: 'SIGTERM' })
  }

  async waitForExit(): Promise<boolean> {
    await this.done
    return true
  }
}
