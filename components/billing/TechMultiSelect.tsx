'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Searchable, multi-select technician picker for dispatch. Replaces the flat wrap of name
 * buttons: type to filter, click to add/remove, selected techs show as removable chips, and
 * (when more than one is picked) a ★ marks the lead. Parent owns the crew state.
 *
 * Keyboard: type to filter · ↓/↑ move · Enter toggle the highlighted tech · Esc close.
 */

interface Tech { id: string; name: string }
interface CrewMember { technicianId: string; isLead: boolean }

export default function TechMultiSelect({
  technicians, crew, onToggle, onSetLead,
}: {
  technicians: Tech[]
  crew: CrewMember[]
  onToggle: (id: string) => void
  onSetLead: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedIds = useMemo(() => new Set(crew.map((c) => c.technicianId)), [crew])
  const nameById = useMemo(() => new Map(technicians.map((t) => [t.id, t.name])), [technicians])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return technicians
    return technicians.filter((t) => t.name.toLowerCase().includes(q))
  }, [query, technicians])

  useEffect(() => {
    if (!open) return
    // Capture phase: the modal card stops mousedown propagation, so a bubble-phase listener
    // never sees clicks made elsewhere inside the modal. Capture runs top-down, before that.
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { setOpen(true); return } setHighlight((h) => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { if (open && filtered[highlight]) { e.preventDefault(); onToggle(filtered[highlight].id) } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false) } }
  }

  const multi = crew.length > 1
  const base: React.CSSProperties = {
    width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
    borderRadius: 6, padding: '6px 9px', fontSize: 12.5, color: 'var(--text-primary)',
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
      {/* Selected chips */}
      {crew.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {crew.map((c) => (
            <span key={c.technicianId} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 9px',
              borderRadius: 999, fontSize: 12, background: 'var(--accent-soft-bg, var(--bg-nav))',
              border: '1px solid var(--accent)', color: 'var(--text-primary)',
            }}>
              {multi && (
                <button type="button" title={c.isLead ? 'Lead' : 'Make lead'} onClick={() => onSetLead(c.technicianId)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, color: c.isLead ? 'var(--accent)' : 'var(--dim,#bbb)' }}>★</button>
              )}
              <span>{nameById.get(c.technicianId) ?? c.technicianId}{multi && c.isLead ? ' · lead' : ''}</span>
              <button type="button" title="Remove" onClick={() => onToggle(c.technicianId)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, color: 'var(--text-muted)' }}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={query}
        placeholder={crew.length ? 'Add another technician…' : 'Search technicians…'}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        style={{ ...base, cursor: 'text', paddingRight: 26 }}
      />
      <span aria-hidden style={{ position: 'absolute', right: 9, bottom: 9, pointerEvents: 'none', color: 'var(--text-muted)', fontSize: 10 }}>▾</span>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-multiselectable
          style={{
            position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0,
            maxHeight: 240, overflowY: 'auto', margin: 0, padding: 4, listStyle: 'none',
            background: 'var(--bg-elevated, var(--bg-secondary))', border: '1px solid var(--border-emphasis)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
        >
          {filtered.length === 0 && <li style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>No matches</li>}
          {filtered.map((t, i) => {
            const isSel = selectedIds.has(t.id)
            const isHi = i === highlight
            return (
              <li
                key={t.id}
                role="option"
                aria-selected={isSel}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => { e.preventDefault(); onToggle(t.id) }}
                style={{
                  padding: '7px 10px', fontSize: 12.5, borderRadius: 5, cursor: 'pointer',
                  color: 'var(--text-primary)', background: isHi ? 'var(--bg-hover, var(--bg-nav))' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span aria-hidden style={{ width: 14, color: 'var(--accent)' }}>{isSel ? '✓' : ''}</span>
                <span>{t.name}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
