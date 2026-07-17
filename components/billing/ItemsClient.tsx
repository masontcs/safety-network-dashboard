'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import Toggle from '@/components/billing/Toggle'
import Select from '@/components/billing/Select'
import { rowOpen } from '@/components/billing/rowOpen'
import { CATEGORIES, BILLING_TYPES, BILLING_TYPE_LABELS } from '@/lib/billing/constants'
import type { BillingItemCategory, BillingType } from '@/lib/supabase/database.types'

/**
 * The item catalog. Items are the general library price lists are built from.
 * All money is entered in dollars and converted to integer cents once, here.
 */

interface ItemRow {
  id: string
  code: string
  name: string
  /** null = sale-only. A category only exists to pick a price-list tier, and a
   *  sale-only item is priced by its own sale price and never sits on a list. */
  category: BillingItemCategory | null
  costCents: number
  rentable: boolean
  salable: boolean
  salePriceCents: number | null
  taxable: boolean
  tracked: boolean
  isActive: boolean
  variationCount: number
  defaultRateCount: number
}

interface Variation { id?: string; name: string; adjCents: number }
interface DefaultRate { billingType: BillingType; rateCents: number }
interface ItemDetail extends Omit<ItemRow, 'variationCount' | 'defaultRateCount'> {
  variations: Variation[]
  defaultRates: DefaultRate[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))',
  color: 'var(--text-primary)', verticalAlign: 'middle',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6,
  padding: '6px 12px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
}
// On/off controls live in their own row, separated from the text fields above.
const optionsRow: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 32px',
  marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle, var(--border-emphasis))',
}

// Money helpers — dollars in the UI, integer cents everywhere else. Round once.
const toCents = (dollars: string) => Math.round(Number(dollars) * 100)
const toDollars = (cents: number | null | undefined) => ((cents ?? 0) / 100).toFixed(2)
const validMoney = (s: string) => Number.isFinite(Number(s)) && Number(s) >= 0

export default function ItemsClient({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const [showNew, setShowNew] = useState(false)
  const [nCode, setNCode] = useState('')
  const [nName, setNName] = useState('')
  // '' = sale only (no category)
  const [nCategory, setNCategory] = useState<BillingItemCategory | ''>('Equipment')
  const [nCost, setNCost] = useState('0.00')
  const [nRentable, setNRentable] = useState(true)
  const [nSalable, setNSalable] = useState(false)
  const [nSalePrice, setNSalePrice] = useState('0.00')
  const [nTracked, setNTracked] = useState(false)
  const [nVars, setNVars] = useState<{ name: string; adjCents: number }[]>([])

  const [editing, setEditing] = useState<ItemDetail | null>(null)
  const [editCost, setEditCost] = useState('0.00')
  const [editSalePrice, setEditSalePrice] = useState('0.00')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/billing/items')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setItems(json.data)
        setFetchError(null)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.category ?? 'sale only').toLowerCase().includes(q)
    )
  }, [items, search])

  async function createItem() {
    if (busy) return
    const equip = nCategory === 'Equipment'
    const saleOnly = nCategory === ''
    if (!validMoney(nCost)) { setActionError('Cost must be a valid amount'); return }
    if ((saleOnly || (equip && nSalable)) && !validMoney(nSalePrice)) { setActionError('Sale price must be a valid amount'); return }
    if (equip && !nRentable && !nSalable) { setActionError('An equipment item must be rentable or salable.'); return }
    setBusy(true); setActionError(null)
    try {
      const res = await fetch('/api/billing/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: nCode, name: nName,
          category: saleOnly ? null : nCategory,
          costCents: toCents(nCost),
          rentable: equip ? nRentable : false,
          salable: equip ? nSalable : false,
          salePriceCents: saleOnly || (equip && nSalable) ? toCents(nSalePrice) : null,
          tracked: equip ? nTracked : false,
          variations: nVars.filter((v) => v.name.trim()),
        }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setNCode(''); setNName(''); setNCost('0.00'); setNRentable(true); setNSalable(false); setNSalePrice('0.00'); setNTracked(false); setNVars([])
      setShowNew(false); load()
    } catch { setActionError('Network error — please try again.') }
    finally { setBusy(false) }
  }

  async function openEditor(id: string) {
    setActionError(null)
    const res = await fetch(`/api/billing/items/${id}`)
    const json = await res.json()
    if (!json.success) { setActionError(json.error); return }
    const d = json.data as ItemDetail
    setEditing(d)
    setEditCost(toDollars(d.costCents))
    setEditSalePrice(toDollars(d.salePriceCents))
  }

  async function saveEditor() {
    if (!editing || busy) return
    const equip = editing.category === 'Equipment'
    const saleOnly = editing.category === null
    if (!editing.code.trim()) { setActionError('Item code cannot be empty'); return }
    if (!validMoney(editCost)) { setActionError('Cost must be a valid amount'); return }
    if ((saleOnly || (equip && editing.salable)) && !validMoney(editSalePrice)) { setActionError('Sale price must be a valid amount'); return }
    if (equip && !editing.rentable && !editing.salable) { setActionError('An equipment item must be rentable or salable.'); return }
    setBusy(true); setActionError(null)
    try {
      const res = await fetch(`/api/billing/items/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: editing.code,
          name: editing.name,
          category: editing.category,
          costCents: toCents(editCost),
          rentable: editing.rentable,
          salable: editing.salable,
          salePriceCents: saleOnly || editing.salable ? toCents(editSalePrice) : null,
          taxable: editing.taxable,
          tracked: editing.tracked,
          isActive: editing.isActive,
          variations: editing.variations,
          defaultRates: editing.defaultRates,
        }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setEditing(null); load()
    } catch { setActionError('Network error — please try again.') }
    finally { setBusy(false) }
  }

  function patchEdit(next: Partial<ItemDetail>) {
    setEditing((e) => (e ? { ...e, ...next } : e))
  }

  const canCreate = !!(nCode.trim() && nName.trim()) && !busy

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Items</div>
        {isAdmin && (
          <button onClick={() => setShowNew((v) => !v)} className="btn-primary" style={{ marginLeft: 'auto', padding: '8px 16px' }}>
            + New item
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -12 }}>
        The general library price lists are built from. Lost or stolen units bill at <strong>cost</strong>,
        never sale price, and are never taxed.
      </div>

      {actionError && (
        <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>
          {actionError}
        </div>
      )}

      {showNew && isAdmin && (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16, color: 'var(--text-primary)' }}>New item</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div><label style={labelStyle}>Code</label><input value={nCode} onChange={(e) => setNCode(e.target.value)} placeholder="CONE28" style={inputStyle} /></div>
            <div><label style={labelStyle}>Name</label><input value={nName} onChange={(e) => setNName(e.target.value)} placeholder='28" Cone' style={inputStyle} /></div>
            <div>
              <label style={labelStyle}>Category</label>
              <Select ariaLabel="Category" value={nCategory} onChange={(v) => setNCategory(v as BillingItemCategory | '')}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="">Sale only</option>
              </Select>
            </div>
            <div><label style={labelStyle}>Cost ($)</label><input value={nCost} onChange={(e) => setNCost(e.target.value)} style={inputStyle} /></div>
          </div>

          {nCategory === '' ? (
            <div style={optionsRow}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Sale price</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>$</span>
                <input value={nSalePrice} onChange={(e) => setNSalePrice(e.target.value)} placeholder="sale price" style={{ ...inputStyle, width: 100 }} />
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Sold, never rented — so it needs no category and never goes on a price list.
              </span>
            </div>
          ) : nCategory === 'Equipment' ? (
            <div style={optionsRow}>
              <Toggle label="Rentable" hint={nRentable ? 'can be rented' : 'sale-only'} checked={nRentable} onChange={setNRentable} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Toggle label="Salable" checked={nSalable} onChange={setNSalable} />
                {nSalable && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>$</span>
                    <input value={nSalePrice} onChange={(e) => setNSalePrice(e.target.value)} placeholder="sale price" style={{ ...inputStyle, width: 100 }} />
                  </span>
                )}
              </div>
              <Toggle label="Tracked" hint="needs equipment ID" checked={nTracked} onChange={setNTracked} />
            </div>
          ) : (
            <div style={{ ...optionsRow, fontSize: 12.5, color: 'var(--text-muted)' }}>
              {nCategory} is a charge item — billed as a {String(nCategory).toLowerCase()} line on a ticket, not rented or sold.
            </div>
          )}

          {/* Variations — addable at create time */}
          <div style={{ marginTop: 20 }}>
            <label style={labelStyle}>Variations (optional)</label>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 8 }}>
              Each variation carries a per-unit adjustment from the item&apos;s price (e.g. Detour +$2.00). Add them here or later via Edit.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {nVars.map((v, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={v.name} placeholder="Name (e.g. Detour)"
                    onChange={(e) => setNVars((r) => r.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                    style={{ ...inputStyle, maxWidth: 240 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>adj $</span>
                  <input value={(v.adjCents / 100).toFixed(2)}
                    onChange={(e) => { const n = Number(e.target.value); if (!Number.isFinite(n)) return; setNVars((r) => r.map((x, i) => i === idx ? { ...x, adjCents: Math.round(n * 100) } : x)) }}
                    style={{ ...inputStyle, maxWidth: 100 }} />
                  <button style={ghostBtn} onClick={() => setNVars((r) => r.filter((_, i) => i !== idx))}>Remove</button>
                </div>
              ))}
              <button style={{ ...ghostBtn, alignSelf: 'flex-start' }} onClick={() => setNVars((r) => [...r, { name: '', adjCents: 0 }])}>+ Add variation</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={createItem} disabled={!canCreate} className="btn-primary" style={{ padding: '8px 18px', opacity: canCreate ? 1 : 0.5 }}>Create item</button>
            <button onClick={() => { setShowNew(false); setNVars([]) }} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: 'var(--text-primary)' }}>
            Edit {editing.code}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
            Variations carry a per-unit adjustment from the item&apos;s resolved price. Default rates are the
            fallback used only when a price list prices no cell for this item.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div><label style={labelStyle}>Code</label><input value={editing.code} onChange={(e) => patchEdit({ code: e.target.value.toUpperCase() })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Name</label><input value={editing.name} onChange={(e) => patchEdit({ name: e.target.value })} style={inputStyle} /></div>
            <div>
              <label style={labelStyle}>Category</label>
              <Select ariaLabel="Category" value={editing.category ?? ''} onChange={(v) => {
                const cat = (v === '' ? null : v) as BillingItemCategory | null
                // Sale only: sold, never rented, never tracked — and no category.
                if (cat === null) patchEdit({ category: null, rentable: false, salable: true, tracked: false, taxable: true })
                // Switching to a charge category zeroes the goods flags.
                else if (cat !== 'Equipment') patchEdit({ category: cat, rentable: false, salable: false, tracked: false, taxable: false })
                else patchEdit({ category: cat })
              }}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="">Sale only</option>
              </Select>
            </div>
            <div><label style={labelStyle}>Cost ($)</label><input value={editCost} onChange={(e) => setEditCost(e.target.value)} style={inputStyle} /></div>
          </div>

          <div style={optionsRow}>
            {editing.category === null ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Sale price</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>$</span>
                <input value={editSalePrice} onChange={(e) => setEditSalePrice(e.target.value)} placeholder="sale price" style={{ ...inputStyle, width: 100 }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>Sold, never rented — no category needed.</span>
              </span>
            ) : editing.category === 'Equipment' ? (
              <>
                <Toggle label="Rentable" hint={editing.rentable ? 'can be rented' : 'sale-only'} checked={editing.rentable} onChange={(v) => patchEdit({ rentable: v })} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Toggle label="Salable" checked={editing.salable} onChange={(v) => patchEdit({ salable: v, taxable: v })} />
                  {editing.salable && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>$</span>
                      <input value={editSalePrice} onChange={(e) => setEditSalePrice(e.target.value)} placeholder="sale price" style={{ ...inputStyle, width: 100 }} />
                    </span>
                  )}
                </div>
                <Toggle label="Tracked" hint="needs equipment ID" checked={editing.tracked} onChange={(v) => patchEdit({ tracked: v })} />
              </>
            ) : (
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {editing.category} is a charge item — billed as a {editing.category?.toLowerCase()} line on a ticket, not rented or sold.
              </span>
            )}
            <Toggle label="Active" checked={editing.isActive} onChange={(v) => patchEdit({ isActive: v })} />
          </div>

          {/* Variations */}
          <div style={{ marginTop: 22 }}>
            <label style={labelStyle}>Variations</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {editing.variations.map((v, idx) => (
                <div key={v.id ?? `new-${idx}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={v.name} placeholder="Name (e.g. Detour)"
                    onChange={(e) => {
                      const next = [...editing.variations]; next[idx] = { ...v, name: e.target.value }; patchEdit({ variations: next })
                    }}
                    style={{ ...inputStyle, maxWidth: 260 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>adj $</span>
                  <input value={(v.adjCents / 100).toFixed(2)}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      const next = [...editing.variations]; next[idx] = { ...v, adjCents: Math.round(n * 100) }; patchEdit({ variations: next })
                    }}
                    style={{ ...inputStyle, maxWidth: 110 }} />
                  <button style={ghostBtn}
                    onClick={() => patchEdit({ variations: editing.variations.filter((_, i) => i !== idx) })}>
                    Remove
                  </button>
                </div>
              ))}
              <button style={{ ...ghostBtn, alignSelf: 'flex-start' }}
                onClick={() => patchEdit({ variations: [...editing.variations, { name: '', adjCents: 0 }] })}>
                + Add variation
              </button>
            </div>
          </div>

          {/* Catalog default rates */}
          <div style={{ marginTop: 22 }}>
            <label style={labelStyle}>Catalog default rates (fallback only)</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
              {BILLING_TYPES.map((bt) => {
                const existing = editing.defaultRates.find((r) => r.billingType === bt)
                return (
                  <div key={bt} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>{BILLING_TYPE_LABELS[bt]}</span>
                    <input
                      value={existing ? (existing.rateCents / 100).toFixed(2) : ''}
                      placeholder="—"
                      onChange={(e) => {
                        const raw = e.target.value.trim()
                        const rest = editing.defaultRates.filter((r) => r.billingType !== bt)
                        if (raw === '') { patchEdit({ defaultRates: rest }); return }
                        const n = Number(raw)
                        if (!Number.isFinite(n) || n < 0) return
                        patchEdit({ defaultRates: [...rest, { billingType: bt, rateCents: Math.round(n * 100) }] })
                      }}
                      style={{ ...inputStyle, maxWidth: 100 }}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button onClick={saveEditor} disabled={busy} className="btn-primary" style={{ padding: '8px 18px', opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Saving…' : 'Save item'}
            </button>
            <button onClick={() => setEditing(null)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" style={{ ...inputStyle, maxWidth: 300 }} />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{filtered.length} of {items.length}</span>
        </div>

        {fetchError ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={40} />)}</div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>
            {items.length === 0 ? 'No items yet.' : 'No items match that search.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Code', 'Name', 'Category', 'Cost', 'Sale', 'Flags', 'Variations', ''].map((h, i) => (
                    <th key={i} style={{ ...thStyle, textAlign: ['Cost', 'Sale', 'Variations'].includes(h) ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr
                    key={i.id}
                    {...rowOpen(isAdmin ? () => openEditor(i.id) : undefined)}
                    style={{ opacity: i.isActive ? 1 : 0.5, cursor: isAdmin ? 'pointer' : 'default' }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{i.code}</td>
                    <td style={tdStyle}>{i.name}</td>
                    <td style={tdStyle}>{i.category ?? <span style={{ color: 'var(--text-dim)' }}>Sale only</span>}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${toDollars(i.costCents)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {i.salable ? `$${toDollars(i.salePriceCents)}` : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 11, color: 'var(--text-muted)' }}>
                      {i.category !== 'Equipment' && i.category !== null ? (
                        <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: 'var(--pill-neutral-fg)', background: 'var(--pill-neutral-bg)', padding: '1px 6px', borderRadius: 999 }}>CHARGE</span>
                      ) : (
                        <>
                          {!i.rentable && (
                            <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: 'var(--pill-pending-fg)', background: 'var(--pill-pending-bg)', padding: '1px 6px', borderRadius: 999, marginRight: 6 }}>SALE-ONLY</span>
                          )}
                          {[i.tracked && 'tracked', i.taxable && 'taxable'].filter(Boolean).join(' · ') || (i.rentable ? '—' : '')}
                        </>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i.variationCount || '—'}</td>
                    <td style={tdStyle}>
                      {isAdmin && <button style={ghostBtn} onClick={(e) => { e.stopPropagation(); openEditor(i.id) }}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
