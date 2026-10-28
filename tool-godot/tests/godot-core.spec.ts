/**
 * Unit tests for the shared execution plumbing: executable resolution,
 * project-root discovery, display-path mapping, and the spawn helper over the
 * REAL local subprocess service with the fake godot CLI stub.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import {
  MAX_PROJECT_ROOT_WALK,
  PROJECT_FILE,
  displayPath,
  findProjectRoot,
  resolveExecutable,
  resolveProjectRoot,
  resToRelative,
  runGodot,
} from '@deepseek-ai/dsh-tool-godot'

const FAKE = fileURLToPath(new URL('./fixtures/fake-godot.mjs', import.meta.url))
const CAPS = { stdoutMaxBytes: 1_048_576, stderrMaxBytes: 262_144, graceMs: 3_000 }

describe('resolveExecutable', () => {
  it('falls back to the default command when unconfigured or blank', () => {
    expect(resolveExecutable(undefined, undefined, 'godot')).toEqual({ executable: 'godot', args: [] })
    expect(resolveExecutable('   ', ['--x'], 'godot')).toEqual({ executable: 'godot', args: ['--x'] })
  })

  it('uses the configured executable and argv prefix', () => {
    expect(resolveExecutable('C:\\Godot\\godot.exe', ['--wrapper'], 'godot')).toEqual({
      executable: 'C:\\Godot\\godot.exe',
      args: ['--wrapper'],
    })
  })
})

describe('findProjectRoot', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-godot-core-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('finds a root at the start directory', async () => {
    await writeFile(join(dir, PROJECT_FILE), 'config_version=5\n')
    expect(await findProjectRoot(dir)).toBe(dir)
  })

  it('walks up to an ancestor root', async () => {
    const nested = join(dir, 'a', 'b', 'c')
    await mkdir(nested, { recursive: true })
    await writeFile(join(dir, PROJECT_FILE), 'config_version=5\n')
    expect(await findProjectRoot(nested)).toBe(dir)
  })

  it('returns null without a root anywhere up the chain', async () => {
    expect(await findProjectRoot(dir)).toBeNull()
  })

  it('returns null for a missing start directory', async () => {
    expect(await findProjectRoot(join(dir, 'missing'))).toBeNull()
  })

  it('stops at the walk limit before reaching a deeper root', async () => {
    // dir/d0/d1/.../d11 with the root marker in d0, one level beyond the walk
    // limit measured from the leaf d11.
    let leaf = dir
    for (let i = 0; i <= MAX_PROJECT_ROOT_WALK + 1; i += 1) leaf = join(leaf, `d${i}`)
    await mkdir(leaf, { recursive: true })
    await writeFile(join(dir, 'd0', PROJECT_FILE), 'config_version=5\n')
    expect(await findProjectRoot(leaf)).toBeNull()
  })
})

describe('resolveProjectRoot', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-godot-root-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns the directory itself when it is the project root', async () => {
    await writeFile(join(dir, PROJECT_FILE), 'config_version=5\n')
    expect(await resolveProjectRoot(dir, dir)).toBe(dir)
  })

  it('discovers the root from a file path inside the project', async () => {
    await mkdir(join(dir, 'scripts'), { recursive: true })
    await writeFile(join(dir, PROJECT_FILE), 'config_version=5\n')
    const file = join(dir, 'scripts', 'main.gd')
    expect(await resolveProjectRoot(file, dir)).toBe(dir)
  })

  it('discovers the root from a missing path inside the project', async () => {
    await writeFile(join(dir, PROJECT_FILE), 'config_version=5\n')
    expect(await resolveProjectRoot(join(dir, 'no-such.gd'), dir)).toBe(dir)
  })

  it('falls back to the start directory when no root exists', async () => {
    const sub = join(dir, 'sub')
    await mkdir(sub, { recursive: true })
    expect(await resolveProjectRoot(sub, dir)).toBe(sub)
  })

  it('falls back to the parent for a missing path without a root', async () => {
    expect(await resolveProjectRoot(join(dir, 'missing.gd'), dir)).toBe(dir)
  })

  it('defaults to the workdir when no path is given', async () => {
    expect(await resolveProjectRoot(undefined, dir)).toBe(dir)
  })
})

describe('displayPath', () => {
  it('relativizes absolute paths inside the workdir', () => {
    const workdir = join('C:', 'proj')
    expect(displayPath(join(workdir, 'a.gd'), workdir)).toBe(join('a.gd'))
    expect(displayPath(workdir, workdir)).toBe('.')
  })

  it('keeps paths outside the workdir absolute', () => {
    expect(displayPath(join('D:', 'other', 'x.gd'), join('C:', 'proj'))).toBe(join('D:', 'other', 'x.gd'))
    // A same-drive sibling walks above the workdir; it stays absolute too.
    expect(displayPath(join('C:', 'proj', '..', 'x.gd'), join('C:', 'proj'))).toBe(join('C:', 'proj', '..', 'x.gd'))
  })

  it('passes relative paths through unchanged', () => {
    expect(displayPath('res://a.gd', 'C:\\proj')).toBe('res://a.gd')
  })
})

describe('resToRelative', () => {
  it('strips the res:// scheme', () => {
    expect(resToRelative('res://scripts/main.gd', 'C:\\proj')).toBe('scripts/main.gd')
  })

  it('relativizes absolute paths against the project root', () => {
    const root = join('C:', 'proj')
    expect(resToRelative(join(root, 'scripts', 'main.gd'), root)).toBe(join('scripts', 'main.gd'))
    expect(resToRelative(join('D:', 'other', 'x.gd'), root)).toBe(join('D:', 'other', 'x.gd'))
  })
})

describe('runGodot', () => {
  let ctx: Context
  let dir: string

  const fake = { executable: process.execPath, args: [FAKE] }
  const execFor = (signal: AbortSignal): never =>
    ({ signal, agent: { session: { header: { cwd: dir } } } }) as never

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-godot-run-'))
    ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('collects stdout and stderr with the exit code', async () => {
    await writeFile(join(dir, 'fake-godot-input.json'), JSON.stringify({ stdout: 'out\n', stderr: 'err\n', exit: 3 }))
    const run = await runGodot(ctx, execFor(new AbortController().signal), 'godot_validate', fake, ['--headless'], CAPS)
    expect(run.exitCode).toBe(3)
    expect(run.signal).toBeNull()
    expect(run.stdout).toBe('out\n')
    expect(run.stderr).toBe('err\n')
    expect(run.stdoutTruncated).toBe(false)
    expect(run.stderrTruncated).toBe(false)
    expect(run.workdir).toBe(dir)
  })

  it('falls back to the process cwd without an agent', async () => {
    // The fake reads its input file from the spawn cwd, which is now the
    // process cwd; with no input file it exits 0 silently.
    const exec = { signal: new AbortController().signal } as never
    const run = await runGodot(ctx, exec, 'godot_validate', fake, [], CAPS)
    expect(run.exitCode).toBe(0)
    expect(run.workdir).toBe(process.cwd())
  })

  it('marks output truncated past the capture budget', async () => {
    await writeFile(join(dir, 'fake-godot-input.json'), JSON.stringify({ stdout: 'x'.repeat(100), stderr: 'y'.repeat(100) }))
    const run = await runGodot(ctx, execFor(new AbortController().signal), 'godot_validate', fake, [], {
      stdoutMaxBytes: 8,
      stderrMaxBytes: 8,
      graceMs: 3_000,
    })
    expect(run.stdoutTruncated).toBe(true)
    expect(run.stderrTruncated).toBe(true)
  })

  it('terminates a run that exceeds its own deadline and keeps the output it produced', async () => {
    // A test scene that runs past its budget must still report what it printed:
    // the tool-call guard would replace the whole result instead. The budget
    // leaves room for Node to start and print under a loaded test runner.
    const slow = join(dir, 'slow.mjs')
    await writeFile(slow, 'process.stdout.write("started\\n"); setTimeout(() => {}, 10000)')
    const run = await runGodot(ctx, execFor(new AbortController().signal), 'godot_run_scene', { executable: process.execPath, args: [] }, [slow], CAPS, 2000)
    expect(run.timedOut).toBe(true)
    expect(run.stdout).toContain('started')
  })

  it('throws GODOT_ABORTED when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runGodot(ctx, execFor(controller.signal), 'godot_validate', fake, [], CAPS)).rejects.toMatchObject({
      code: 'GODOT_ABORTED',
    })
  })

  it('throws GODOT_ABORTED when the signal aborts mid-run', async () => {
    await writeFile(join(dir, 'fake-godot-input.json'), JSON.stringify({ delayMs: 300 }))
    const controller = new AbortController()
    const run = runGodot(ctx, execFor(controller.signal), 'godot_validate', fake, [], CAPS)
    await new Promise(resolve => setTimeout(resolve, 50))
    controller.abort()
    await expect(run).rejects.toMatchObject({ code: 'GODOT_ABORTED' })
  })

  it('throws GODOT_UNAVAILABLE when the executable cannot launch', async () => {
    await expect(
      runGodot(ctx, execFor(new AbortController().signal), 'godot_validate', { executable: 'no-such-binary-xyz-123', args: [] }, [], CAPS),
    ).rejects.toMatchObject({ code: 'GODOT_UNAVAILABLE' })
  })

  it('throws GODOT_UNAVAILABLE for a synchronous spawn rejection', async () => {
    // A NUL byte in argv makes Node's spawn() throw synchronously; the plain
    // argv contract has no shell layer that could quote it away.
    await expect(runGodot(ctx, execFor(new AbortController().signal), 'godot_validate', fake, ['\0'], CAPS)).rejects.toMatchObject({
      code: 'GODOT_UNAVAILABLE',
    })
  })
})
