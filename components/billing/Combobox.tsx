'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'

export interface ComboboxOption {
  value: string
  label: string
  /** Optional extra text searched against but shown dimmed (e.g. a code). */
  hint?: string
}

/**
 * Searchable single-select. Behaves like a native <select> (controlled by
 * value + onChange with string values, '' = nothing selected) but lets the
 * user type to filter — needed anywhere the option list can grow large
 * (items, customers, profiles).
 *
 * Keyboard: type to filter · ↑/↓ move · Enter select · Esc close/revert.
 * a11y: role=combobox + listbox/option, aria-expanded/activedescendant.
 */
export default function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  style,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
  ariaLabel?: string
}) {
  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Keep the input text in sync with the selected label while the menu is closed.
  useEffect(() => {
    if (!open) setQuery(selected?.label ?? '')
  }, [selected, open])

  // If the query still equals the current selection, show everything (browse);
  // otherwise treat it as a filter term.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || (selected && query === selected.label)) return options
    return options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q))
  }, [query, options, selected])

  // Close on outside click. Capture phase, so it still fires inside a modal whose card stops
  // mousedown propagation (a bubble-phase listener would never see the click).
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [open])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const openMenu = useCallback(() => {
    if (disabled) return
    setOpen(true)
    const idx = filtered.findIndex((o) => o.value === value)
    setHighlight(idx >= 0 ? idx : 0)
  }, [disabled, filtered, value])

  const pick = useCallback((opt: ComboboxOption) => {
    onChange(opt.value)
    setQuery(opt.label)
    setOpen(false)
    inputRef.current?.blur()
  }, [onChange])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) return openMenu()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) { e.preventDefault(); pick(filtered[highlight]) }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); setQuery(selected?.label ?? '') }
    }
  }

  const base: React.CSSProperties = {
    width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
    borderRadius: 6, padding: '6px 9px', fontSize: 12.5, color: 'var(--text-primary)',
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="combobox-list"
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={open && filtered[highlight] ? `cb-opt-${filtered[highlight].value}` : undefined}
        disabled={disabled}
        value={open ? query : selected?.label ?? ''}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); setHighlight(0) }}
        onFocus={openMenu}
        onClick={openMenu}
        onKeyDown={onKeyDown}
        style={{ ...base, ...style, cursor: disabled ? 'not-allowed' : 'text', paddingRight: 26 }}
      />
      <span aria-hidden style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)', fontSize: 10 }}>▾</span>

      {open && (
        <ul
          ref={listRef}
          id="combobox-list"
          role="listbox"
          style={{
            position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0,
            maxHeight: 240, overflowY: 'auto', margin: 0, padding: 4, listStyle: 'none',
            background: 'var(--bg-elevated, var(--bg-secondary))', border: '1px solid var(--border-emphasis)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
        >
          {filtered.length === 0 && (
            <li style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>No matches</li>
          )}
          {filtered.map((o, i) => {
            const isSel = o.value === value
            const isHi = i === highlight
            return (
              <li
                key={o.value}
                id={`cb-opt-${o.value}`}
                role="option"
                aria-selected={isSel}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                style={{
                  padding: '7px 10px', fontSize: 12.5, borderRadius: 5, cursor: 'pointer',
                  color: 'var(--text-primary)',
                  background: isHi ? 'var(--bg-hover, var(--bg-nav))' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                {o.hint && <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>{o.hint}</span>}
                <span>{o.label}</span>
                {isSel && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>✓</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
