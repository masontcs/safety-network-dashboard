import type { HTMLAttributes, KeyboardEvent } from 'react'

/**
 * Props that make a table row open on click — the whole row becomes the
 * affordance, not just an Edit button or link. Pass the open handler, or
 * `undefined` when the user lacks permission: the row then renders inert
 * (no click, no keyboard, no pointer cursor) so nothing happens for them.
 *
 * Set the pointer cursor in the caller's own style with the same enabled flag,
 * e.g. `cursor: canOpen ? 'pointer' : 'default'`, so it merges with row styles.
 *
 * Nested buttons/links inside the row must call `e.stopPropagation()` so their
 * own action fires instead of the row's.
 */
export function rowOpen(onOpen: (() => void) | undefined): HTMLAttributes<HTMLTableRowElement> {
  if (!onOpen) return {}
  return {
    onClick: onOpen,
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
    },
  }
}
