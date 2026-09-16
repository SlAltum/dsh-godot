/** The Godot card's staged form over the `godot` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  digitsField, GodotCardForm, selectField, textField,
  type GodotCardActions, type GodotCardShell, type GodotFieldState,
} from './godot-card-form.ts'

/**
 * Namespace of the Godot tooling capability. Spelled here rather than
 * imported: a client package must not depend on a Host package, and the
 * tool-godot package that owns the namespace spells the same value.
 */
export const GODOT_NS = 'godot'

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
export interface GodotCardState extends GodotCardShell {
  /** Godot editor executable path or PATH command name. */
  executable: GodotFieldState
  /** gdformat executable path or PATH command name. */
  gdformatExecutable: GodotFieldState
  /** Which format backend the tools use. */
  formatBackend: GodotFieldState
  /** Cooperative tool-call budget in milliseconds. */
  timeoutMs: GodotFieldState
}

/** The registration-side face the Godot card's slot entry injects. */
export interface GodotCardFace extends GodotCardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useGodotCard. */
    godotCard: SnapshotStore<GodotCardState>
  }
}

/** Bridges the `godot` scope onto the Godot card's staged form. */
export class GodotCardController {
  private readonly form: GodotCardForm
  private readonly store: SnapshotStore<GodotCardState>

  /** @param scope - the bound settings scope for the `godot` namespace. */
  constructor(scope: SettingsScope<GodotSettings>) {
    this.form = new GodotCardForm(scope, [
      textField('executable'),
      textField('gdformatExecutable'),
      selectField('formatBackend', ['gdformat', 'builtin']),
      digitsField('timeoutMs'),
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
}
