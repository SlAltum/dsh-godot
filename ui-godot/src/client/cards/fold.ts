/** The fold state one tool card keeps per call. */
//
// Stored outside React because the transcript re-creates a toolview on every
// streaming render: a row's own `useState` is thrown away as fast as the reader
// opens it, which makes a click look like it did nothing. Keyed by call id, so
// a remounted row comes back the way the reader left it.

import { useState } from 'react'

const OPEN_CALLS = new Set<string>()

/**
 * Set a call's fold state from outside the component.
 *
 * A card's own controls go through {@link useCardFold}; this exists so a test or
 * a preview can render the report without simulating the click.
 */
export function setCardOpen(callId: string, open: boolean): void {
  if (open) OPEN_CALLS.add(callId)
  else OPEN_CALLS.delete(callId)
}

/** One card's fold state, stored per call rather than per component instance. */
export function useCardFold(callId: string): {
  readonly expanded: boolean
  readonly toggle: () => void
} {
  const [, bump] = useState(0)
  const write = (open: boolean): void => {
    if (open) OPEN_CALLS.add(callId)
    else OPEN_CALLS.delete(callId)
    bump(count => count + 1)
  }
  return {
    expanded: OPEN_CALLS.has(callId),
    toggle: () => { write(!OPEN_CALLS.has(callId)) },
  }
}
