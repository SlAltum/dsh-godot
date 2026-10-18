/**
 * The Godot card's controller: the four fields it projects over the composed
 * `tool-godot` entry's form, the writes a save sends, and the reset and
 * discard gestures.
 */

import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { GodotCardController, type GodotSettings } from '../src/client/godot-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubConfigForm<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
}

describe('GodotCardController', () => {
  it('projects the four fields and saves them in one write pass', async () => {
    const host = stubConfigForm<GodotSettings>()
    acceptWrites(host)
    const controller = new GodotCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { executable: 'godot', formatBackend: 'builtin', timeoutMs: 60_000 },
      base: { executable: 'godot', formatBackend: 'gdformat', timeoutMs: 60_000 },
      user: { formatBackend: 'builtin' },
    })
    const face = controller.inject()

    expect(face.hooks.godotCard.getSnapshot()).toMatchObject({
      available: true,
      writable: true,
      dirty: false,
      executable: { text: 'godot', overridden: false },
      gdformatExecutable: { text: '', overridden: false },
      formatBackend: { text: 'builtin', overridden: true },
      timeoutMs: { text: '60000', overridden: false },
    })

    face.edit('executable', 'C:\\Godot\\godot.exe')
    face.edit('timeoutMs', '9000')
    expect(face.hooks.godotCard.getSnapshot().dirty).toBe(true)

    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledTimes(1) })

    expect(host.mutate.mock.calls.map(([ops]) => ops)).toEqual([[
      { op: 'set', path: ['executable'], value: 'C:\\Godot\\godot.exe' },
      { op: 'set', path: ['timeoutMs'], value: 9_000 },
    ]])
    expect(face.hooks.godotCard.getSnapshot().dirty).toBe(false)

    controller.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('refuses a format backend the select does not list and blocks the save', async () => {
    const host = stubConfigForm<GodotSettings>()
    acceptWrites(host)
    const controller = new GodotCardController(host.scope)
    host.publish({ status: 'ready', writable: true, value: { formatBackend: 'gdformat' }, base: {}, user: {} })
    const face = controller.inject()

    face.edit('formatBackend', 'nope')

    expect(face.hooks.godotCard.getSnapshot().formatBackend).toMatchObject({ text: 'nope', invalid: true })
    expect(face.hooks.godotCard.getSnapshot().invalid).toBe(true)

    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()

    controller.dispose()
  })

  it('accepts a listed format backend edit', async () => {
    const host = stubConfigForm<GodotSettings>()
    acceptWrites(host)
    const controller = new GodotCardController(host.scope)
    host.publish({ status: 'ready', writable: true, value: { formatBackend: 'gdformat' }, base: {}, user: {} })
    const face = controller.inject()

    face.edit('formatBackend', 'builtin')

    expect(face.hooks.godotCard.getSnapshot().formatBackend).toMatchObject({ text: 'builtin', invalid: false })
    expect(face.hooks.godotCard.getSnapshot().dirty).toBe(true)
    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalled() })

    controller.dispose()
  })

  it('falls back to the first listed backend when the section carries an unknown one', () => {
    const host = stubConfigForm<GodotSettings>()
    const controller = new GodotCardController(host.scope)
    host.publish({ status: 'ready', writable: true, value: { formatBackend: 'future-mode' as NonNullable<GodotSettings['formatBackend']> }, base: {}, user: {} })

    expect(controller.inject().hooks.godotCard.getSnapshot().formatBackend.text).toBe('gdformat')

    controller.dispose()
  })

  it('stages a reset and applies it on save', async () => {
    const host = stubConfigForm<GodotSettings>()
    acceptWrites(host)
    const controller = new GodotCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { executable: 'C:\\Godot\\godot.exe' },
      base: { executable: 'godot' },
      user: { executable: 'C:\\Godot\\godot.exe' },
    })
    const face = controller.inject()

    face.resetField('executable')
    expect(face.hooks.godotCard.getSnapshot().executable.text).toBe('godot')

    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['executable'] }], undefined) })

    expect(face.hooks.godotCard.getSnapshot()).toMatchObject({
      dirty: false,
      executable: { text: 'godot', overridden: false },
    })

    controller.dispose()
  })

  it('discards staged edits without writing', () => {
    const host = stubConfigForm<GodotSettings>()
    const controller = new GodotCardController(host.scope)
    host.publish({ status: 'ready', writable: true, value: { executable: 'godot' }, user: {} })
    const face = controller.inject()

    face.edit('executable', 'C:\\Godot\\godot.exe')
    face.discard()

    expect(face.hooks.godotCard.getSnapshot().executable.text).toBe('godot')
    expect(host.mutate).not.toHaveBeenCalled()

    controller.dispose()
  })
})
