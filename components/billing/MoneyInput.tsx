'use client'

import { useState } from 'react'

/**
 * A dollar-amount input backed by integer cents.
 *
 * The caret bug it fixes: a plain controlled input that reformats cents -> "5.00"
 * on every keystroke overwrites what the user is typing, so after one digit the
 * value snaps to "5.00" and the caret jumps to the end. Here the field holds the
 * user's *raw text* while focused and only shows the formatted amount once they
 * leave — so typing, clicking mid-field, and selecting all work normally.
 *
 * Reports changes as integer cents (or null when the field is empty).
 */
export default function MoneyInput({
  valueCents,
  onChangeCents,
  disabled = false,
  placeholder = '—',
  style,
  ariaLabel,
  title,
}: {
  valueCents: number | null | undefined
  onChangeCents: (cents: number | null) => void
  disabled?: boolean
  placeholder?: string
  style?: React.CSSProperties
  ariaLabel?: string
  title?: string
}) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')

  const fmt = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2))
  const parse = (s: string): number | null => {
    const t = s.trim()
    if (t === '') return null
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) return null
    return Math.round(n * 100) // integer cents, rounded once
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      placeholder={placeholder}
      // While focused the draft string is the single source of truth (only
      // keystrokes change it), so the caret never jumps. Blurred, we show the
      // canonical formatted amount.
      value={focused ? draft : fmt(valueCents)}
      onFocus={() => { setDraft(valueCents == null ? '' : String(valueCents / 100)); setFocused(true) }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value
        // Permit only a partial decimal (digits and at most one dot) or empty.
        if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
        setDraft(raw)
        onChangeCents(parse(raw))
      }}
      style={style}
    />
  )
}
