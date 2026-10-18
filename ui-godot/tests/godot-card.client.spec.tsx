// @vitest-environment jsdom
/**
 * What the Godot card shows: nothing while the namespace is unavailable, a
 * loading note before the first section, the four fields with their override
 * chips and resets, and a save footer that decides when staged edits are
 * written.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { GodotCard } from '../src/client/GodotCard.tsx'
import type { GodotCardProps } from '../src/client/GodotCard.tsx'
import type { GodotCardState } from '../src/client/godot-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

/** A settled form: nothing staged, everything served. */
const settled: SettingsFormShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

/** One control's state, defaulting to an inherited value. */
function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function cardActions() {
  return { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
}

function renderGodot(state: Partial<GodotCardState> = {}, view: 'summary' | 'page' = 'page') {
  const store = createSnapshotStore<GodotCardState>({
    ...settled,
    executable: field('godot'),
    gdformatExecutable: field(''),
    formatBackend: field('gdformat'),
    timeoutMs: field('60000'),
    ...state,
  })
  const actions = cardActions()
  const props = { ...actions, t, view, useGodotCard: bindSnapshotSelector(store) } as unknown as GodotCardProps
  render(<GodotCard {...props} />)
  return actions
}

describe('GodotCard', () => {
  it('renders nothing while the namespace is unavailable', () => {
    renderGodot({ available: false })

    expect(screen.queryByText(en.name)).toBeNull()
  })

  it('answers the list row with its one-liner only', () => {
    renderGodot({}, 'summary')

    expect(screen.getByText(en.description)).toBeTruthy()
    // The Plugins page renders this summary as the row's description: a form
    // here would put a second Godot card inside the row.
    expect(screen.queryByLabelText(en.executable)).toBeNull()
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
  })

  it('shows a read-only note and disables its controls on a read-only document', () => {
    renderGodot({ writable: false })

    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getByLabelText(en.executable)).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('renders the description and all four fields', () => {
    renderGodot()

    expect(screen.getByText(en.description)).toBeTruthy()
    expect(screen.getByLabelText(en.executable)).toHaveProperty('value', 'godot')
    expect(screen.getByLabelText(en.gdformatExecutable)).toHaveProperty('value', '')
    expect(screen.getByLabelText(en.formatBackend)).toHaveProperty('value', 'gdformat')
    expect(screen.getByLabelText(en.timeoutMs)).toHaveProperty('value', '60000')
  })

  it('stages an edit through the injected action and enables the save', () => {
    const actions = renderGodot()

    fireEvent.change(screen.getByLabelText(en.executable), { target: { value: 'C:\\Godot\\godot.exe' } })
    fireEvent.change(screen.getByLabelText(en.gdformatExecutable), { target: { value: 'C:\\gdformat\\gdformat.exe' } })
    fireEvent.change(screen.getByLabelText(en.formatBackend), { target: { value: 'builtin' } })
    fireEvent.change(screen.getByLabelText(en.timeoutMs), { target: { value: '9000' } })

    expect(actions.edit).toHaveBeenCalledWith('executable', 'C:\\Godot\\godot.exe')
    expect(actions.edit).toHaveBeenCalledWith('gdformatExecutable', 'C:\\gdformat\\gdformat.exe')
    expect(actions.edit).toHaveBeenCalledWith('formatBackend', 'builtin')
    expect(actions.edit).toHaveBeenCalledWith('timeoutMs', '9000')
  })

  it('renders the override chip and reset for a field the user layer carries', () => {
    const actions = renderGodot({ timeoutMs: field('9000', { overridden: true }) })

    const reset = screen.getByRole('button', { name: en.reset })
    fireEvent.click(reset)

    expect(actions.resetField).toHaveBeenCalledWith('timeoutMs')
    // The chip renders beside the reset button.
    expect(screen.getByText(en.overridden)).toBeTruthy()
  })

  it('renders no chip nor reset for an inherited field', () => {
    renderGodot()

    expect(screen.queryByText(en.overridden)).toBeNull()
    expect(screen.queryByRole('button', { name: en.reset })).toBeNull()
  })

  it('writes staged edits on save', () => {
    const actions = renderGodot({ dirty: true })

    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(actions.save).toHaveBeenCalled()
  })

  it('discards staged edits without writing', () => {
    const actions = renderGodot({ dirty: true })

    fireEvent.click(screen.getByRole('button', { name: en.discard }))

    expect(actions.discard).toHaveBeenCalled()
  })

  it('blocks the save while the timeout draft is invalid', () => {
    const actions = renderGodot({ dirty: true, invalid: true, timeoutMs: field('soon', { invalid: true }) })

    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('keeps the save disabled while a save is crossing the wire', () => {
    renderGodot({ dirty: true, saving: true })

    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('reports a save the Host did not land', () => {
    renderGodot({ failed: true })

    expect(screen.getByText(en.saveFailed)).toBeTruthy()
  })
})
