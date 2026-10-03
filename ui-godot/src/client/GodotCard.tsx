/** The Godot plugin's card: where the assistant finds Godot on this machine. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GodotCardFace } from './godot-card-controller.ts'
import css from './GodotCard.module.css'

/** Props the renderer binds for the Godot card. */
export type GodotCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.godot'>
  & InjectFace<GodotCardFace>

/** One labeled field: label column + (control + hint) + status chip column. */
interface FieldProps {
  /** Control id shared with its label. */
  id: string
  /** Field label. */
  label: string
  /** Control element. */
  control: ReactNode
  /** Optional helper line under the control. */
  hint?: string
  /** Status chips: override marker and reset. */
  chips: ReactNode[]
}

/** Render one labeled field. */
function Field(props: FieldProps) {
  // Every godot field passes a hint today; the undefined arm is defensive.
  /* v8 ignore next -- every godot field passes a hint (defensive arm) */
  const hint = props.hint === undefined ? null : <div className={css.hint}>{props.hint}</div>
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={props.id}>{props.label}</label>
      <div>
        {props.control}
        {hint}
      </div>
      {props.chips}
    </div>
  )
}

/**
 * Render the Godot card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function GodotCard(props: GodotCardProps) {
  const { t } = props
  const state = props.useGodotCard(snapshot => snapshot)
  // A card renders nothing while its namespace is unavailable, matching the
  // plugin-card chrome: a deployment that does not compose the owning plugin
  // should show no trace of it.
  if (!state.available) return null
  const disabled = !state.writable
  const chipFor = (field: 'executable' | 'gdformatExecutable' | 'formatBackend' | 'timeoutMs') => state[field].overridden
    ? [
      <span key="chip" className={css.chip}>{t('overridden')}</span>,
      <button
        key="reset"
        type="button"
        className={css.reset}
        disabled={disabled}
        onClick={() => { props.resetField(field) }}
      >
        {t('reset')}
      </button>,
    ]
    : []
  const timeoutInvalid = state.timeoutMs.invalid
  return (
    <li className={css.card}>
      <div className={css.head}>
        <span className={css.name}>{t('name')}</span>
        {!state.writable ? <span className={css.note}>{t('readOnly')}</span> : null}
      </div>
      <div className={css.desc}>{t('description')}</div>
      <Field
        id="plugin-config-godot-executable"
        label={t('executable')}
        chips={chipFor('executable')}
        hint={t('executableHint')}
        control={(
          <input
            id="plugin-config-godot-executable"
            className={css.control}
            value={state.executable.text}
            placeholder={t('executablePlaceholder')}
            disabled={disabled}
            onChange={(event) => { props.edit('executable', event.target.value) }}
          />
        )}
      />
      <Field
        id="plugin-config-godot-gdformat"
        label={t('gdformatExecutable')}
        chips={chipFor('gdformatExecutable')}
        hint={t('gdformatExecutableHint')}
        control={(
          <input
            id="plugin-config-godot-gdformat"
            className={css.control}
            value={state.gdformatExecutable.text}
            placeholder={t('gdformatExecutablePlaceholder')}
            disabled={disabled}
            onChange={(event) => { props.edit('gdformatExecutable', event.target.value) }}
          />
        )}
      />
      <Field
        id="plugin-config-godot-backend"
        label={t('formatBackend')}
        chips={chipFor('formatBackend')}
        hint={t('formatBackendHint')}
        control={(
          <select
            id="plugin-config-godot-backend"
            className={css.control}
            value={state.formatBackend.text}
            disabled={disabled}
            onChange={(event) => { props.edit('formatBackend', event.target.value) }}
          >
            <option value="gdformat">{t('formatBackendGdformat')}</option>
            <option value="builtin">{t('formatBackendBuiltin')}</option>
          </select>
        )}
      />
      <Field
        id="plugin-config-godot-timeout"
        label={t('timeoutMs')}
        chips={chipFor('timeoutMs')}
        hint={t('timeoutMsHint')}
        control={(
          <input
            id="plugin-config-godot-timeout"
            className={css.control}
            value={state.timeoutMs.text}
            placeholder={t('timeoutMsPlaceholder')}
            inputMode="numeric"
            data-invalid={timeoutInvalid || undefined}
            disabled={disabled}
            onChange={(event) => { props.edit('timeoutMs', event.target.value) }}
          />
        )}
      />
      <div className={css.actions}>
        {state.failed ? <span className={css.note}>{t('saveFailed')}</span> : null}
        <button
          type="button"
          className={`${css.btn} ${css.btnPrimary}`}
          disabled={disabled || !state.dirty || state.invalid || state.saving}
          onClick={props.save}
        >
          {t('save')}
        </button>
        <button
          type="button"
          className={css.btn}
          disabled={!state.dirty || state.saving}
          onClick={props.discard}
        >
          {t('discard')}
        </button>
      </div>
    </li>
  )
}
