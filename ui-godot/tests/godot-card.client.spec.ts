/**
 * The Godot card's staged form and controller: what a draft shows before it
 * is written, which wire call a save reaches, and what happens to drafts the
 * Host did not accept.
 */

import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  digitsField, GodotCardForm, selectField, textField,
} from '../src/client/godot-card-form.ts'
import { GodotCardController, type GodotSettings } from '../src/client/godot-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubSettingsScope<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({ value: { ...section(), [field]: value } as T, user: { ...layer(), [field]: value } })
  })
  host.unset.mockImplementation((field: string) => {
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    const base = host.scope.getSnapshot().base as Record<string, unknown> | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] } as T, user })
  })
}

describe('GodotCardForm', () => {
  function form() {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new GodotCardForm(host.scope, [
      textField('executable'), textField('gdformatExecutable'),
      selectField('formatBackend', ['gdformat', 'builtin']), digitsField('timeoutMs'),
    ])
    host.publish({
      status: 'ready',
      writable: true,
      value: { executable: 'godot', formatBackend: 'gdformat', timeoutMs: 60_000 },
      base: { executable: 'godot', formatBackend: 'gdformat', timeoutMs: 60_000 },
      user: {},
    })
    return { host, subject }
  }

  it('shows the effective value and stays clean until something is staged', () => {
    const { subject } = form()

    expect(subject.field('executable')).toEqual({ text: 'godot', overridden: false, invalid: false })
    expect(subject.field('timeoutMs')).toEqual({ text: '60000', overridden: false, invalid: false })
    expect(subject.shell()).toMatchObject({ available: true, loading: false, writable: true, dirty: false, invalid: false })
  })

  it('marks a field the user layer carries as overridden', () => {
    const { host, subject } = form()

    host.publish({ value: { executable: 'godot' }, user: { executable: 'godot' } })

    expect(subject.field('executable').overridden).toBe(true)
  })

  it('writes nothing until the form is saved', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('executable', 'C:\\Godot\\godot.exe')

    expect(subject.field('executable')).toEqual({ text: 'C:\\Godot\\godot.exe', overridden: true, invalid: false })
    expect(subject.shell().dirty).toBe(true)
    expect(host.set).not.toHaveBeenCalled()

    await subject.save()

    expect(host.set.mock.calls).toEqual([['executable', 'C:\\Godot\\godot.exe']])
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false, saving: false })
  })

  it('drops a draft that settles back on the value already shown', async () => {
    const { host, subject } = form()

    subject.actions().edit('executable', 'C:\\Godot\\godot.exe')
    subject.actions().edit('executable', 'godot')

    expect(subject.shell().dirty).toBe(false)
    await subject.save()

    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses to save while a draft is not a value the field accepts', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', 'soon')

    expect(subject.field('timeoutMs')).toEqual({ text: 'soon', overridden: false, invalid: true })
    expect(subject.shell()).toMatchObject({ dirty: true, invalid: true })

    await subject.save()

    expect(host.set).not.toHaveBeenCalled()
    expect(subject.field('timeoutMs').text).toBe('soon')
  })

  it('accepts only listed values in a select field', () => {
    const { subject } = form()

    subject.actions().edit('formatBackend', 'builtin')
    expect(subject.field('formatBackend')).toMatchObject({ text: 'builtin', invalid: false })

    subject.actions().edit('formatBackend', 'nope')
    expect(subject.field('formatBackend')).toMatchObject({ text: 'nope', invalid: true })
  })

  it('falls back to the first listed value when the section carries an unknown one', () => {
    const { host, subject } = form()

    host.publish({ value: { formatBackend: 'future-mode' } })

    expect(subject.field('formatBackend').text).toBe('gdformat')
  })

  it('stages a reset that clears the field only once saved', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ value: { executable: 'C:\\Godot\\godot.exe' }, user: { executable: 'C:\\Godot\\godot.exe' } })

    subject.actions().resetField('executable')

    // The badge previews the save: the field will no longer be overridden.
    expect(subject.field('executable')).toEqual({ text: 'godot', overridden: false, invalid: false })
    expect(host.unset).not.toHaveBeenCalled()

    await subject.save()

    expect(host.unset.mock.calls).toEqual([['executable']])
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false })
  })

  it('treats resetting an inherited field as no change at all', async () => {
    const { host, subject } = form()

    subject.actions().resetField('executable')

    expect(subject.shell().dirty).toBe(false)
    await subject.save()

    expect(host.unset).not.toHaveBeenCalled()
  })

  it('clears a number field by emptying it', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ user: { timeoutMs: 9_000 } })

    subject.actions().edit('timeoutMs', '')

    expect(subject.field('timeoutMs')).toEqual({ text: '', overridden: false, invalid: false })
    await subject.save()

    expect(host.unset.mock.calls).toEqual([['timeoutMs']])
  })

  it('writes the trimmed text of a text field', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('executable', '  C:\\Godot\\godot.exe  ')
    await subject.save()

    expect(host.set.mock.calls).toEqual([['executable', 'C:\\Godot\\godot.exe']])
  })

  it('clears a text field by emptying it', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ user: { executable: 'C:\\Godot\\godot.exe' } })

    subject.actions().edit('executable', '   ')
    await subject.save()

    expect(host.unset.mock.calls).toEqual([['executable']])
  })

  it('keeps the drafts a save did not land, and reports the failure', async () => {
    const { host, subject } = form()

    subject.actions().edit('executable', 'C:\\Godot\\godot.exe')
    await subject.save()

    expect(host.set).toHaveBeenCalledWith('executable', 'C:\\Godot\\godot.exe')
    expect(subject.shell()).toMatchObject({ dirty: true, failed: true, saving: false })
    expect(subject.field('executable').text).toBe('C:\\Godot\\godot.exe')
  })

  it('reports a reset the Host did not apply as a failure', async () => {
    const { host, subject } = form()
    host.publish({ user: { executable: 'C:\\Godot\\godot.exe' } })

    subject.actions().resetField('executable')
    await subject.save()

    expect(host.unset).toHaveBeenCalledWith('executable')
    expect(subject.shell().failed).toBe(true)
  })

  it('clears the failure as soon as the user edits again', async () => {
    const { subject } = form()

    subject.actions().edit('executable', 'C:\\Godot\\godot.exe')
    await subject.save()
    expect(subject.shell().failed).toBe(true)

    subject.actions().edit('executable', 'C:\\Godot\\godot2.exe')

    expect(subject.shell().failed).toBe(false)
  })

  it('discards every staged edit', async () => {
    const { host, subject } = form()

    subject.actions().edit('executable', 'C:\\Godot\\godot.exe')
    subject.actions().discard()

    expect(subject.field('executable').text).toBe('godot')
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false })

    // A discard with nothing staged publishes nothing.
    const before = subject.shell()
    subject.actions().discard()
    expect(subject.shell()).toEqual(before)

    await subject.save()
    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses a second save while one is in flight', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('executable', 'C:\\Godot\\godot.exe')
    const first = subject.save()
    expect(subject.shell().saving).toBe(true)
    const second = subject.save()
    await Promise.all([first, second])

    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('publishes a projection whenever the scope or a draft changes', () => {
    const { host, subject } = form()
    const store = subject.bind(() => subject.field('executable').text)
    expect(store.getSnapshot()).toBe('godot')

    host.publish({ value: { executable: 'C:\\Godot\\godot.exe' } })
    expect(store.getSnapshot()).toBe('C:\\Godot\\godot.exe')

    subject.actions().edit('executable', 'godot2')
    expect(store.getSnapshot()).toBe('godot2')
  })

  it('refuses to address a field the card never declared', () => {
    const { subject } = form()

    expect(() => subject.field('nope')).toThrow('godot card has no field nope')
  })

  it('renders an absent section value as an empty draft', () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new GodotCardForm(host.scope, [textField('executable')])

    host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: undefined })

    expect(subject.field('executable').text).toBe('')
    expect(subject.shell().available).toBe(true)
  })

  it('stays unavailable while the namespace is not served, and loading before the first section', () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new GodotCardForm(host.scope, [textField('executable')])

    host.publish({ status: 'loading' })
    expect(subject.shell()).toMatchObject({ available: false, loading: true, writable: false })

    host.publish({ status: 'unavailable' })
    expect(subject.shell()).toMatchObject({ available: false, loading: false, writable: false })
  })
})

describe('GodotCardController', () => {
  it('projects the four fields and saves them in one write pass', async () => {
    const host = stubSettingsScope<GodotSettings>()
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
      formatBackend: { text: 'builtin', overridden: true },
      timeoutMs: { text: '60000', overridden: false },
    })

    face.edit('executable', 'C:\\Godot\\godot.exe')
    face.edit('timeoutMs', '9000')
    expect(face.hooks.godotCard.getSnapshot().dirty).toBe(true)

    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(2) })

    expect(host.set.mock.calls).toEqual([['executable', 'C:\\Godot\\godot.exe'], ['timeoutMs', 9_000]])
    expect(face.hooks.godotCard.getSnapshot().dirty).toBe(false)
  })

  it('stages a reset and applies it on save', async () => {
    const host = stubSettingsScope<GodotSettings>()
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
    await vi.waitFor(() => { expect(host.unset).toHaveBeenCalledWith('executable') })

    expect(face.hooks.godotCard.getSnapshot()).toMatchObject({
      dirty: false,
      executable: { text: 'godot', overridden: false },
    })
  })

  it('discards staged edits without writing', () => {
    const host = stubSettingsScope<GodotSettings>()
    const controller = new GodotCardController(host.scope)
    host.publish({ status: 'ready', writable: true, value: { executable: 'godot' }, user: {} })
    const face = controller.inject()

    face.edit('executable', 'C:\\Godot\\godot.exe')
    face.discard()

    expect(face.hooks.godotCard.getSnapshot().executable.text).toBe('godot')
    expect(host.set).not.toHaveBeenCalled()
  })
})
