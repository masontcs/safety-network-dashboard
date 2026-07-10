'use client'

/**
 * An iOS-style switch for on/off state. Accent-orange when on, with the
 * design-system focus ring. Renders an accessible role=switch button; the
 * visual (track + sliding knob) lives in billing.css as `.bx-switch`.
 *
 * Pass a `label` to get a clickable label beside the switch. Wrap several in a
 * flex row for a compact flags group.
 */
export default function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  hint,
  ariaLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
  hint?: string
  ariaLabel?: string
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="bx-switch"
    />
  )

  if (!label && !hint) return sw

  return (
    <label
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 9,
        cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none',
      }}
    >
      {sw}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
        {label && <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>}
        {hint && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{hint}</span>}
      </span>
    </label>
  )
}
