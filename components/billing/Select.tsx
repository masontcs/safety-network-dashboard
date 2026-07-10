'use client'

/**
 * A drop-in replacement for a native <select> that strips the OS chrome and
 * uses our own chevron + focus ring (`.bx-select` in billing.css). Same API as
 * a native select — pass <option> children — so swapping is mechanical.
 *
 * For long option lists (items, customers) use Combobox instead; this is for
 * short, fixed enum lists (status, category, billing type).
 */

const baseStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function Select({
  value,
  onChange,
  disabled = false,
  children,
  style,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  children: React.ReactNode
  style?: React.CSSProperties
  ariaLabel?: string
}) {
  return (
    <select
      className="bx-select"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...baseStyle, ...style }}
    >
      {children}
    </select>
  )
}
