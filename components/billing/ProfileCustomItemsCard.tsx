'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Custom items for ONE billing profile — negotiated Lump Sum / Labor lines made just for
 * this contract. They carry their own price (per variation, or a single rate) and only ever
 * appear on this profile's tickets. Global catalog items are managed on the Items screen.
 */

interface Variation { id: string; name: string; ownRateCents: number | null }
interface ScopedItem { id: string; code: string; name: string; category: string; ownRateCents: number | null; variations: Variation[] }

const money = (c: number | null) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`)
const toCents = (s: string) => Math.round(parseFloat(s || '0') * 100)

export default function ProfileCustomItemsCard({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<ScopedItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // form — editId null = creating, else editing that item
  const [editId, setEditId] = useState<string | null>(null)
  const [category, setCategory] = useState<'Lump Sum' | 'Labor'>('Lump Sum')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [useVars, setUseVars] = useState(false)
  const [rate, setRate] = useState('0.00')
  const [vars, setVars] = useState<{ id?: string; name: string; rate: string }[]>([{ name: '', rate: '0.00' }])

  const load = useCallback(async () => {
    try {
      setErr(null)
      const j = await fetch(`/api/billing/profiles/${profileId}/items`).then((r) => r.json())
      if (!j.success) throw new Error(j.error)
      setItems(j.data)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load custom items.') }
  }, [profileId])
  useEffect(() => { load() }, [load])

  function reset() {
    setEditId(null); setName(''); setCode(''); setRate('0.00'); setUseVars(false); setVars([{ name: '', rate: '0.00' }]); setCategory('Lump Sum')
  }

  function startEdit(it: ScopedItem) {
    setErr(null)
    setEditId(it.id)
    setCategory(it.category === 'Labor' ? 'Labor' : 'Lump Sum')
    setName(it.name); setCode(it.code)
    if (it.variations.length > 0) {
      setUseVars(true)
      setVars(it.variations.map((v) => ({ id: v.id, name: v.name, rate: ((v.ownRateCents ?? 0) / 100).toFixed(2) })))
    } else {
      setUseVars(false); setRate(((it.ownRateCents ?? 0) / 100).toFixed(2)); setVars([{ name: '', rate: '0.00' }])
    }
    setOpen(true)
  }

  async function save() {
    if (busy) return
    // Validate up front so failures show a clear message right here, not a silent no-op.
    // (The variation names/prices are what people miss most.)
    if (!name.trim()) { setErr('A name is required.'); return }
    if (!code.trim()) { setErr('A code is required.'); return }
    const cleanVars = useVars ? vars.filter((v) => v.name.trim()) : []
    if (useVars) {
      if (cleanVars.length === 0) { setErr('Add at least one variation with a name and price — or uncheck “has variations” to use a single price.'); return }
      const badRate = cleanVars.find((v) => !Number.isFinite(parseFloat(v.rate)) || parseFloat(v.rate) < 0)
      if (badRate) { setErr(`Enter a price of zero or more for “${badRate.name.trim()}”.`); return }
    } else if (!Number.isFinite(parseFloat(rate)) || parseFloat(rate) < 0) {
      setErr('Enter a price of zero or more.'); return
    }

    setBusy(true); setErr(null)
    const body = useVars
      ? { category, name, code, variations: cleanVars.map((v) => ({ id: v.id, name: v.name.trim(), ownRateCents: toCents(v.rate) })) }
      : { category, name, code, variations: [], ownRateCents: toCents(rate) }
    const url = editId ? `/api/billing/profiles/${profileId}/items/${editId}` : `/api/billing/profiles/${profileId}/items`
    try {
      const j = await fetch(url, {
        method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((r) => r.json())
      if (!j.success) { setErr(j.error); return }
      reset(); setOpen(false); load()
    } catch { setErr('Network error — please try again.') }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this custom item?')) return
    const j = await fetch(`/api/billing/profiles/${profileId}/items/${id}`, { method: 'DELETE' }).then((r) => r.json())
    if (!j.success) { setErr(j.error); return }
    load()
  }

  return (
    <div className="card">
      <div className="bx-cardhead" style={{ marginBottom: 6 }}>
        <h3>Custom items</h3>
        <button className="bx-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { if (open) { reset(); setOpen(false) } else { reset(); setOpen(true) } setErr(null) }}>{open ? 'Cancel' : '+ New item'}</button>
      </div>
      <div className="bx-sub" style={{ marginBottom: 12 }}>Lump-sum or labor lines priced just for this profile. They only appear on this profile’s tickets.</div>

      {err && <div className="bx-note amber" style={{ marginBottom: 12 }}>{err}</div>}

      {open && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div><label className="bx-lbl">Category</label>
              <select className="bx-f bx-select" value={category} onChange={(e) => setCategory(e.target.value as 'Lump Sum' | 'Labor')}>
                <option>Lump Sum</option><option>Labor</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}><label className="bx-lbl">Name</label><input className="bx-f" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Overhead sign package" /></div>
            <div style={{ width: 130 }}><label className="bx-lbl">Code</label><input className="bx-f" style={{ width: '100%' }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="MASTEC-OH1" /></div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
            <input type="checkbox" checked={useVars} onChange={(e) => setUseVars(e.target.checked)} /> This item has variations (each with its own price)
          </label>

          {!useVars ? (
            <div style={{ width: 140 }}><label className="bx-lbl">Price ($)</label><input className="bx-f" style={{ width: '100%' }} value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="bx-lbl" style={{ margin: 0 }}>Variations</label>
              {vars.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <input className="bx-f" style={{ flex: 1 }} value={v.name} onChange={(e) => setVars((vs) => vs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder={`Variation ${i + 1} name`} />
                  <input className="bx-f" style={{ width: 120 }} value={v.rate} onChange={(e) => setVars((vs) => vs.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} placeholder="$" />
                  <button className="bx-btn ghost sm" onClick={() => setVars((vs) => vs.filter((_, j) => j !== i))} disabled={vars.length === 1}>✕</button>
                </div>
              ))}
              <button className="bx-btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setVars((vs) => [...vs, { name: '', rate: '0.00' }])}>+ Add variation</button>
            </div>
          )}

          {/* Errors also show right here — the card-top note is easy to miss below a long form. */}
          {err && <div className="bx-note amber" style={{ margin: 0 }}>{err}</div>}
          <button className="bx-btn accent" style={{ alignSelf: 'flex-start' }} onClick={save} disabled={busy || !name.trim() || !code.trim()}>{busy ? 'Saving…' : editId ? 'Save changes' : 'Create item'}</button>
        </div>
      )}

      {items === null ? (
        <div className="bx-sub">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bx-empty">No custom items for this profile yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Code', 'Name', 'Category', 'Price', ''].map((h) => <th key={h} style={{ textAlign: h === 'Price' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{it.code}</td>
                <td>{it.name}</td>
                <td><span className="tag t-gray">{it.category}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {it.variations.length > 0
                    ? `${it.variations.length} variation${it.variations.length > 1 ? 's' : ''}`
                    : money(it.ownRateCents)}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="bx-btn ghost sm" onClick={() => startEdit(it)}>Edit</button>
                  <button className="bx-btn ghost sm" style={{ marginLeft: 6 }} onClick={() => remove(it.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
