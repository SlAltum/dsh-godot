/**
 * Cross-restart session registry: one JSON record per running game, written
 * where a restarted host can find it.
 *
 * A sandbox game outlives the call that started it — that is what "long-lived"
 * means — so a host killed without running its disposal leaves a game window and
 * a listening bridge behind. Each record names the pid, the bridge port and the
 * temp directory; the next host sweeps the directory before starting anything:
 * a dead game loses its leftover scripts, a live one whose bridge still answers
 * is terminated, and a live pid whose port is silent is left alone because the
 * pid was reused by something that is not ours.
 * @module @deepseek-ai/dsh-tool-godot-ego/session-registry
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One running session as the next host needs to see it. */
export interface SessionRecord {
  readonly sessionId: string
  /** The host process that owns this session; a live owner means the record is not ours to sweep. */
  readonly ownerPid: number
  readonly workspace: string
  readonly pid: number | null
  readonly port: number | null
  readonly projectRoot: string
  readonly tempDir: string
  readonly startedAt: string
}

/** What one sweep did. */
export interface SweepReport {
  /** Records examined and removed. */
  readonly swept: number
  /** Live games terminated because their bridge answered. */
  readonly terminated: number
  /** Live pids left running because the recorded bridge port was silent. */
  readonly kept: number
}

/** Everything the sweep touches, injected so the decision is testable. */
export interface SweepDeps {
  readonly dir: string
  /** Whether the recorded pid still exists. */
  isAlive(pid: number): boolean
  /** Whether something listens on the recorded bridge port. */
  isListening(port: number): Promise<boolean>
  /** Terminate one process (best effort). */
  terminate(pid: number): void
  /** Delete a directory tree (best effort). */
  removeDir(dir: string): Promise<void>
}

/** Budget for the bridge-port probe: a local listener answers or it does not. */
const PROBE_TIMEOUT_MS = 400

/**
 * Where records live: a deployment-configured directory, else the host's cache.
 * @param configured - the `stateDir` config value; empty derives the default.
 * @returns an absolute directory path.
 */
export function sessionRecordDir(configured: string): string {
  if (configured !== '') return configured
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'cache', 'godot-ego')
}

/**
 * Record one running session so a later host can find it.
 * @param dir - the registry directory.
 * @param record - the session facts.
 */
export async function writeSessionRecord(dir: string, record: SessionRecord): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${record.sessionId}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/**
 * Drop one session's record; a missing record is not an error.
 * @param dir - the registry directory.
 * @param sessionId - the session that ended.
 */
export async function clearSessionRecord(dir: string, sessionId: string): Promise<void> {
  await rm(join(dir, `${sessionId}.json`), { force: true })
}

/**
 * Reclaim or terminate every session a dead host left behind.
 * @param deps - the directory and the process/socket seams.
 * @returns what the sweep did.
 */
export async function sweepSessions(deps: SweepDeps): Promise<SweepReport> {
  const names = await readdir(deps.dir).catch(() => [] as string[])
  let swept = 0
  let terminated = 0
  let kept = 0
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(deps.dir, name)
    const record = await readRecord(path)
    if (record === undefined) {
      swept += 1
      await rm(path, { force: true })
      continue
    }
    // Another live host owns this one: it is a peer, not a leftover.
    if (deps.isAlive(record.ownerPid)) continue
    swept += 1
    if (record.pid !== null && deps.isAlive(record.pid)) {
      // The port is the identity: a record whose bridge still listens is the
      // game this record describes, whatever pid happened to take its place.
      if (record.port !== null && await deps.isListening(record.port)) {
        deps.terminate(record.pid)
        terminated += 1
      } else {
        kept += 1
      }
    }
    await deps.removeDir(record.tempDir)
    await rm(path, { force: true })
  }
  return { swept, terminated, kept }
}

/** Production seams: real pid liveness, a real port probe, a real terminate. */
export function sessionSweepDeps(dir: string): SweepDeps {
  return {
    dir,
    isAlive(pid: number): boolean {
      try {
        process.kill(pid, 0)
        return true
      } catch (error: unknown) {
        // EPERM means the pid exists but belongs to another user.
        return (error as { code?: string }).code === 'EPERM'
      }
    },
    isListening(port: number): Promise<boolean> {
      return new Promise((resolve) => {
        const socket = connect({ port, host: '127.0.0.1' })
        const settle = (answer: boolean): void => {
          socket.destroy()
          resolve(answer)
        }
        socket.setTimeout(PROBE_TIMEOUT_MS, () => { settle(false) })
        socket.once('connect', () => { settle(true) })
        socket.once('error', () => { settle(false) })
      })
    },
    terminate(pid: number): void {
      try {
        // ponytail: one pid, no tree — Godot spawns no helper processes. Switch
        // to taskkill /T if a future Godot starts one.
        process.kill(pid)
      } catch {
        // Already gone: the record is what needed cleaning.
      }
    },
    removeDir(target: string): Promise<void> {
      return rm(target, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/** Parse one record file; `undefined` when it is unreadable or malformed. */
async function readRecord(path: string): Promise<SessionRecord | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<SessionRecord>
    if (typeof raw.sessionId !== 'string' || typeof raw.tempDir !== 'string') return undefined
    return {
      sessionId: raw.sessionId,
      ownerPid: typeof raw.ownerPid === 'number' ? raw.ownerPid : 0,
      workspace: typeof raw.workspace === 'string' ? raw.workspace : '',
      pid: typeof raw.pid === 'number' ? raw.pid : null,
      port: typeof raw.port === 'number' ? raw.port : null,
      projectRoot: typeof raw.projectRoot === 'string' ? raw.projectRoot : '',
      tempDir: raw.tempDir,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
    }
  } catch {
    return undefined
  }
}
