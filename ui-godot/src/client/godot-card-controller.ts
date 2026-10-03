/** The Godot card's staged form over the composed `tool-godot` entry's config. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField, settingsTextField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Profile entry id of the Godot tool package. Spelled here rather than
 * imported: a client package must not depend on a Host package, and the base
 * bundle composes the tool under this id.
 */
export const GODOT_NS = 'tool-godot'

/** The Godot fields this card edits — a subset of the served schema by design. */
export interface GodotSettings {
  /** Godot editor executable path or PATH command name. */
  executable?: string
  /** gdformat executable path or PATH command name. */
  gdformatExecutable?: string
  /** Which `godot_format` backend the tools use. */
  formatBackend?: 'gdformat' | 'builtin'
  /** Cooperative tool-call budget in milliseconds. */
  timeoutMs?: number
}

/** What the Godot card renders. */
export interface GodotCardState extends SettingsFormShell {
  /** Godot editor executable path or PATH command name. */
  executable: SettingsFieldState
  /** gdformat executable path or PATH command name. */
  gdformatExecutable: SettingsFieldState
  /** Which format backend the tools use. */
  formatBackend: SettingsFieldState
  /** Cooperative tool-call budget in milliseconds. */
  timeoutMs: SettingsFieldState
}

/** The registration-side face the Godot card's slot entry injects. */
export interface GodotCardFace extends SettingsFormActions {
  hooks: {
    /** Card snapshot bound by the renderer as useGodotCard. */
    godotCard: SnapshotStore<GodotCardState>
  }
}

/**
 * A single-choice field backed by a fixed value set (the format-backend
 * select). The select can only produce listed values, but the spec still
 * refuses anything else so a stray draft cannot reach the Host.
 * @param field - field name inside the entry section.
 * @param values - the accepted values, first being the format default.
 * @returns the field's conversion spec.
 */
function settingsSelectField(field: string, values: readonly [string, ...string[]]): SettingsFieldSpec {
  const fallback = values[0]
  return {
    field,
    format: value => values.includes(value as string) ? value as string : fallback,
    parse: text => (values.includes(text) ? { kind: 'set', value: text } : undefined),
  }
}

/** Bridges the `tool-godot` entry's form onto the Godot card's staged form. */
export class GodotCardController {
  private readonly form: SettingsFormModel<GodotSettings>
  private readonly store: SnapshotStore<GodotCardState>

  /** @param scope - the shared configuration form of the composed Godot tool entry. */
  constructor(scope: SettingsFormScope<GodotSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsTextField('executable'),
      settingsTextField('gdformatExecutable'),
      settingsSelectField('formatBackend', ['gdformat', 'builtin']),
      settingsNumberField('timeoutMs'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): GodotCardState {
    return {
      ...this.form.shell(),
      executable: this.form.field('executable'),
      gdformatExecutable: this.form.field('gdformatExecutable'),
      formatBackend: this.form.field('formatBackend'),
      timeoutMs: this.form.field('timeoutMs'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): GodotCardFace {
    return { hooks: { godotCard: this.store }, ...this.form.actions() }
  }

  /** Release the form subscription. */
  dispose(): void { this.form.dispose() }
}
