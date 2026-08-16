/**
 * DebugController tests against the FakeGame replaying the T3.0 real-Godot
 * recording: connect/threadId, stop detection (breakpoint vs error), command
 * round-trips, the stack/vars snapshot flow, output/error collection with the
 * byte cap, timeouts, cancellation and idempotent teardown.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DebugController, type GodotRuntimeError } from '../src/controller.ts'
import { FakeGame } from './fixtures/fake-game.ts'

const here = dirname(fileURLToPath(import.meta.url))
const bin = readFileSync(join(here, 'fixtures', 't3-breakpoints.bin'))
const manifest = JSON.parse(readFileSync(join(here, 'fixtures', 't3-breakpoints.json'), 'utf8')) as {
  frames: { cmd: string; trigger: string; offset: number; len: number }[]
}

let game: FakeGame | undefined
let controller: DebugController | undefined

async function setup(options?: Partial<{ maxMessageBytes: number; maxOutputBytes: number }>): Promise<{
  game: FakeGame
  controller: DebugController
}> {
  game = new FakeGame(bin, manifest.frames)
  controller = new DebugController({
    maxMessageBytes: options?.maxMessageBytes ?? 16_000_000,
    maxOutputBytes: options?.maxOutputBytes ?? 1_000_000,
  })
  await controller.listen()
  await game.connect(controller.port) // the game connects INTO the controller
  await controller.waitForSetPid(5_000)
  return { game, controller }
}

afterEach(async () => {
  await controller?.dispose()
  await game?.dispose()
  controller = undefined
  game = undefined
})

describe('DebugController', () => {
  it('parses threadId from set_pid', async () => {
    const { controller: c } = await setup()
    expect(c.threadId).toBe(1)
  })

  it('detects a user breakpoint stop', async () => {
    const { controller: c } = await setup()
    const stop = await c.waitForStop(5_000)
    expect(stop).toEqual({ isUserBreakpoint: true, reason: 'Breakpoint' })
  })

  it('round-trips get_stack_dump and collects the snapshot frames', async () => {
    const { controller: c } = await setup()
    await c.waitForStop(5_000)
    c.send('get_stack_dump')
    c.send('get_stack_frame_vars', [0])
    const snapshot = await c.waitForSnapshot(5_000)
    expect(snapshot.dump[0]).toBe(6) // params[0] = total frame-triplet items
    expect(snapshot.dump.slice(1, 4)).toEqual(['res://player.gd', 10, 'run'])
    expect(snapshot.vars).toHaveLength(4)
    const names = snapshot.vars.map(v => v[0])
    expect(names).toEqual(['self', 'counter', 'name_tag', 'target'])
  })

  it('continues into the second stop and exits the paused state', async () => {
    const { controller: c } = await setup()
    await c.waitForStop(5_000)
    c.send('continue')
    const second = await c.waitForStop(5_000)
    expect(second).toEqual({ isUserBreakpoint: true, reason: 'Breakpoint' })
    c.send('continue')
    await c.waitForDebugExit(5_000)
  })

  it('collects output lines (splitting multi-line entries, stripping trailing NUL)', async () => {
    const { controller: c } = await setup()
    await c.waitForStop(5_000)
    c.send('continue')
    await c.waitForDebugExit(5_000)
    expect(c.output.some(line => line.includes('Godot Engine v4.7'))).toBe(true)
    expect(c.output.some(line => line.includes('counter=3'))).toBe(true)
    expect(c.output.some(line => line.includes('helper done'))).toBe(true)
    expect(c.output.some(line => line.includes('main: done'))).toBe(true)
    for (const line of c.output) expect(line.includes('\u0000')).toBe(false)
  })

  it('collects engine error messages with their structured fields', async () => {
    const { controller: c } = await setup()
    await c.waitForStop(5_000)
    const errs = c.errors.filter(e => e.file.includes('os_windows.cpp'))
    expect(errs).toHaveLength(1)
    const err = errs[0] as GodotRuntimeError
    expect(err.warning).toBe(false)
    expect(err.error).toBe('Parameter "cert_store" is null.')
    expect(err.desc).toContain('root certificate store')
    expect(err.stack).toEqual([])
  })

  it('stops collecting output once the byte cap is hit and flags truncation', async () => {
    const { controller: c } = await setup({ maxOutputBytes: 32 })
    await c.waitForStop(5_000)
    c.send('continue')
    await c.waitForDebugExit(5_000)
    expect(c.outputTruncated).toBe(true)
    expect(c.outputBytes).toBeGreaterThan(32)
    // Later output (after the banner overflowed the cap) is dropped.
    expect(c.output.some(line => line.includes('counter=3'))).toBe(false)
  })

  it('times out a stop wait with a named error', async () => {
    const { controller: c } = await setup()
    await c.waitForStop(5_000) // consume the buffered stop
    await expect(c.waitForStop(50)).rejects.toThrow(/debug_enter timed out after 50ms/)
  })

  it('aborts a stop wait on the caller signal', async () => {
    const { controller: c } = await setup()
    await c.waitForStop(5_000) // consume the buffered stop
    const signal = AbortSignal.abort()
    await expect(c.waitForStop(5_000, signal)).rejects.toThrow(/aborted/)
  })

  it('disposes idempotently', async () => {
    const { controller: c } = await setup()
    await c.dispose()
    await c.dispose()
  })
})
