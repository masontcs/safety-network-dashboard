'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import Toggle from '@/components/billing/Toggle'
import Select from '@/components/billing/Select'
import { rowOpen } from '@/components/billing/rowOpen'
import MoneyInput from '@/components/billing/MoneyInput'
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
  /** What the item IS. 'Sale' is only ever sold — priced on the item, never on a
   *  price list. Selling a rentable item doesn't make it Sale; that's a sale LINE. */
  category: BillingItemCategory
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

/**
 * A variation is a real physical difference (an orange cone, a large vest), so it can
 * move all three of the item's numbers independently — each is a +/- on a DIFFERENT
 * number, and they never touch each other.
 */
interface Variation { id?: string; name: string; costAdjCents: number; saleAdjCents: number }
const BLANK_VARIATION: Variation = { name: '', costAdjCents: 0, saleAdjCents: 0 }
interface DefaultRate { billingType: BillingType; rateCents: number }
interface ItemDetail extends Omit<ItemRow, 'variationCount' | 'defaultRateCount'> {
  variations: Variation[]
  defaultRates: DefaultRate[]
  usage: ItemUsage
}
/** Where an item is referenced. `canDelete` is false the moment it's used anywhere. */
interface ItemUsage {
  priceLists: number; ticketLedger: number; ticketLines: number
  accruals: number; invoiceLines: number
  blockers: string[]; canDelete: boolean
}
type StatusFilter = 'active' | 'archived' | 'all'

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

/**
 * One variation row, shared by the New and Edit forms so the two can't drift.
 *
 * Each adjustment moves a DIFFERENT number, so each is labelled with the number it
 * moves — "adj $" alone was ambiguous enough to be a trap:
 *   cost adj -> what a LOST unit bills at        (always relevant)
 *   rate adj -> the price-list rental rate       (only if the item is priced by a list)
 *   sale adj -> the sale price                   (only if the item is salable)
 * A field for a number the item doesn't have is a question with no answer, so each
 * only appears when it applies.
 */
/**
 * A variation moves the item's OWN numbers. There is no rate adjustment here: a rate
 * isn't a property of an item, it's a property of a price list — so a variation's rate
 * adjustment is set per price list, in the price-list editor.
 */
function VariationRow({ v, showSale, onChange, onRemove }: {
  v: Variation
  showSale: boolean
  onChange: (next: Variation) => void
  onRemove: () => void
}) {
  // MoneyInput, not a raw input: a controlled field that reformats cents -> "5.00" on
  // every keystroke overwrites what you're typing, so the value snaps after one digit and
  // the caret jumps to the end. MoneyInput holds the raw text while focused.
  // allowNegative because an adjustment legitimately goes both ways (a cheaper variant).
  const adj = (label: string, value: number, key: 'costAdjCents' | 'saleAdjCents') => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{label}</span>
      <MoneyInput
        valueCents={value === 0 ? null : value}
        allowNegative
        placeholder="0.00"
        ariaLabel={label}
        onChangeCents={(c) => onChange({ ...v, [key]: c ?? 0 })}
        style={{ ...inputStyle, width: 84 }}
      />
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        value={v.name}
        placeholder="Name (e.g. Orange)"
        aria-label="Variation name"
        onChange={(e) => onChange({ ...v, name: e.target.value })}
        style={{ ...inputStyle, maxWidth: 200 }}
      />
      {adj('cost adj $', v.costAdjCents, 'costAdjCents')}
      {showSale && adj('sale adj $', v.saleAdjCents, 'saleAdjCents')}
      <button style={ghostBtn} onClick={onRemove}>Remove</button>
    </div>
  )
}

export default function ItemsClient({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Archived items stay out of the way by default — that's the point of archiving.
  const [status, setStatus] = useState<StatusFilter>('active')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const [showNew, setShowNew] = useState(false)
  const [nCode, setNCode] = useState('')
  const [nName, setNName] = useState('')
  const [nCategory, setNCategory] = useState<BillingItemCategory>('Equipment')
  const [nCost, setNCost] = useState('0.00')
  const [nRentable, setNRentable] = useState(true)
  const [nSalable, setNSalable] = useState(false)
  const [nSalePrice, setNSalePrice] = useState('0.00')
  const [nTracked, setNTracked] = useState(false)
  const [nVars, setNVars] = useState<Variation[]>([])

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
    const byStatus = items.filter(
      (i) => status === 'all' || (status === 'active' ? i.isActive : !i.isActive)
    )
    if (!q) return byStatus
    return byStatus.filter(
      (i) =>
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
    )
  }, [items, search, status])

  const archivedCount = useMemo(() => items.filter((i) => !i.isActive).length, [items])

  async function createItem() {
    if (busy) return
    const equip = nCategory === 'Equipment'
    const saleOnly = nCategory === 'Sale'
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
          category: nCategory,
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
    setConfirmDelete(false)
    setEditCost(toDollars(d.costCents))
    setEditSalePrice(toDollars(d.salePriceCents))
  }

  /**
   * Archive / restore. Sends only isActive, so toggling an item's availability can never
   * be blocked by unrelated validation on fields the user didn't touch.
   */
  async function setArchived(item: { id: string; code: string }, archived: boolean) {
    if (busy) return
    setBusy(true); setActionError(null)
    try {
      const res = await fetch(`/api/billing/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !archived }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); return }
      setEditing(null)
      load()
    } catch { setActionError('Network error — please try again.') }
    finally { setBusy(false) }
  }

  /** Only offered for an item that has never been used; the server checks again anyway. */
  async function deleteItem() {
    if (!editing || busy) return
    setBusy(true); setActionError(null)
    try {
      const res = await fetch(`/api/billing/items/${editing.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) { setActionError(json.error); setConfirmDelete(false); return }
      setEditing(null)
      load()
    } catch { setActionError('Network error — please try again.') }
    finally { setBusy(false) }
  }

  async function saveEditor() {
    if (!editing || busy) return
    const equip = editing.category === 'Equipment'
    const saleOnly = editing.category === 'Sale'
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
              <Select ariaLabel="Category" value={nCategory} onChange={(v) => setNCategory(v as BillingItemCategory)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div><label style={labelStyle}>Cost ($)</label><input value={nCost} onChange={(e) => setNCost(e.target.value)} style={inputStyle} /></div>
          </div>

          {nCategory === 'Sale' ? (
            <div style={optionsRow}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Sale price</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>$</span>
                <input value={nSalePrice} onChange={(e) => setNSalePrice(e.target.value)} placeholder="sale price" style={{ ...inputStyle, width: 100 }} />
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Only ever sold — priced here, never on a price list. (A cone you sometimes sell stays Equipment.)
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
              {nCategory} is a charge item — billed as a {nCategory.toLowerCase()} line on a ticket, not rented or sold.
            </div>
          )}

          {/* Variations — addable at create time */}
          <div style={{ marginTop: 20 }}>
            <label style={labelStyle}>Variations (optional)</label>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 8 }}>
              A variation adjusts the item&apos;s numbers per unit (e.g. Orange: cost +$0.50, rate +$0.25). Each adjustment moves a different number and may be negative. Add them here or later via Edit.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {nVars.map((v, idx) => (
                <VariationRow
                  key={idx}
                  v={v}
                  showSale={nCategory === 'Sale' || (nCategory === 'Equipment' && nSalable)}
                  onChange={(next) => setNVars((r) => r.map((x, i) => (i === idx ? next : x)))}
                  onRemove={() => setNVars((r) => r.filter((_, i) => i !== idx))}
                />
              ))}
              <button style={{ ...ghostBtn, alignSelf: 'flex-start' }} onClick={() => setNVars((r) => [...r, { ...BLANK_VARIATION }])}>+ Add variation</button>
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
            A variation adjusts the item&apos;s numbers per unit — cost is what a lost unit bills at, rate is the
            price-list rental rate, sale is the sale price. Each may be negative. Default rates are the
            fallback used only when a price list prices no cell for this item.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div><label style={labelStyle}>Code</label><input value={editing.code} onChange={(e) => patchEdit({ code: e.target.value.toUpperCase() })} style={inputStyle} /></div>
            <div><label style={labelStyle}>Name</label><input value={editing.name} onChange={(e) => patchEdit({ name: e.target.value })} style={inputStyle} /></div>
            <div>
              <label style={labelStyle}>Category</label>
              <Select ariaLabel="Category" value={editing.category} onChange={(v) => {
                const cat = v as BillingItemCategory
                // Sale: sold, never rented, never tracked.
                if (cat === 'Sale') patchEdit({ category: cat, rentable: false, salable: true, tracked: false, taxable: true })
                // Switching to a charge category zeroes the goods flags.
                else if (cat !== 'Equipment') patchEdit({ category: cat, rentable: false, salable: false, tracked: false, taxable: false })
                else patchEdit({ category: cat })
              }}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div><label style={labelStyle}>Cost ($)</label><input value={editCost} onChange={(e) => setEditCost(e.target.value)} style={inputStyle} /></div>
          </div>

          <div style={optionsRow}>
            {editing.category === 'Sale' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Sale price</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>$</span>
                <input value={editSalePrice} onChange={(e) => setEditSalePrice(e.target.value)} placeholder="sale price" style={{ ...inputStyle, width: 100 }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>Only ever sold — priced here, never on a price list.</span>
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
                {editing.category} is a charge item — billed as a {editing.category.toLowerCase()} line on a ticket, not rented or sold.
              </span>
            )}
            <Toggle label="Active" checked={editing.isActive} onChange={(v) => patchEdit({ isActive: v })} />
          </div>

          {/* Variations */}
          <div style={{ marginTop: 22 }}>
            <label style={labelStyle}>Variations</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {editing.variations.map((v, idx) => (
                <VariationRow
                  key={v.id ?? `new-${idx}`}
                  v={v}
                  showSale={editing.category === 'Sale' || (editing.category === 'Equipment' && editing.salable)}
                  onChange={(next) => {
                    const rows = [...editing.variations]; rows[idx] = next; patchEdit({ variations: rows })
                  }}
                  onRemove={() => patchEdit({ variations: editing.variations.filter((_, i) => i !== idx) })}
                />
              ))}
              <button style={{ ...ghostBtn, alignSelf: 'flex-start' }}
                onClick={() => patchEdit({ variations: [...editing.variations, { ...BLANK_VARIATION }] })}>
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
                    <MoneyInput
                      valueCents={existing ? existing.rateCents : null}
                      placeholder="—"
                      ariaLabel={`${BILLING_TYPE_LABELS[bt]} default rate`}
                      onChangeCents={(c) => {
                        const rest = editing.defaultRates.filter((r) => r.billingType !== bt)
                        // Clearing the field removes the rate entirely — a blank cell means
                        // "no catalog fallback", which is not the same as a rate of $0.00.
                        patchEdit({ defaultRates: c == null ? rest : [...rest, { billingType: bt, rateCents: c }] })
                      }}
                      style={{ ...inputStyle, maxWidth: 100 }}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={saveEditor} disabled={busy} className="btn-primary" style={{ padding: '8px 18px', opacity: busy ? 0.5 : 1 }}>
              {busy ? 'Saving…' : 'Save item'}
            </button>
            <button onClick={() => setEditing(null)} style={ghostBtn}>Cancel</button>

            {/* Retiring an item lives on the right, away from Save — destructive actions
                shouldn't sit under the cursor's path to the primary button. */}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => setArchived(editing, editing.isActive)}
                disabled={busy}
                style={ghostBtn}
                title={editing.isActive
                  ? 'Hide from pickers. Existing tickets and invoices keep it.'
                  : 'Make selectable again.'}
              >
                {editing.isActive ? 'Archive' : 'Restore'}
              </button>

              {editing.usage.canDelete ? (
                confirmDelete ? (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Delete permanently?</span>
                    <button
                      onClick={deleteItem}
                      disabled={busy}
                      style={{ ...ghostBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    >
                      {busy ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button onClick={() => setConfirmDelete(false)} style={ghostBtn}>No</button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                    style={{ ...ghostBtn, color: 'var(--danger)' }}
                    title="This item has never been used, so it can be removed for good."
                  >
                    Delete
                  </button>
                )
              ) : (
                // Say WHY there's no delete button, rather than leaving a gap that reads
                // as a missing feature.
                <span style={{ fontSize: 11.5, color: 'var(--text-dim)', maxWidth: 320, textAlign: 'right' }}>
                  Can’t delete — {editing.usage.blockers.join(', ')}. Archive instead.
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" style={{ ...inputStyle, maxWidth: 300 }} />
          <Select
            ariaLabel="Status filter"
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            style={{ maxWidth: 150 }}
          >
            <option value="active">Active</option>
            <option value="archived">Archived{archivedCount > 0 ? ` (${archivedCount})` : ''}</option>
            <option value="all">All</option>
          </Select>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{filtered.length} of {items.length}</span>
        </div>

        {fetchError ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={40} />)}</div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '18px 2px' }}>
            {items.length === 0
              ? 'No items yet.'
              : status === 'archived' && !search.trim()
                ? 'No archived items.'
                : `No ${status === 'all' ? '' : status + ' '}items match that search.`}
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
                    <td style={{ ...tdStyle, fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {i.code}
                      {!i.isActive && (
                        <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: 'var(--pill-neutral-fg)', background: 'var(--pill-neutral-bg)', padding: '1px 6px', borderRadius: 999, marginLeft: 6 }}>ARCHIVED</span>
                      )}
                    </td>
                    <td style={tdStyle}>{i.name}</td>
                    <td style={tdStyle}>{i.category}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${toDollars(i.costCents)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {i.salable ? `$${toDollars(i.salePriceCents)}` : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 11, color: 'var(--text-muted)' }}>
                      {i.category !== 'Equipment' && i.category !== 'Sale' ? (
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
                      {isAdmin && (
                        <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button style={ghostBtn} onClick={(e) => { e.stopPropagation(); openEditor(i.id) }}>Edit</button>
                          <button
                            style={ghostBtn}
                            title={i.isActive ? 'Hide from pickers; existing records keep it' : 'Make selectable again'}
                            onClick={(e) => { e.stopPropagation(); setArchived(i, i.isActive) }}
                          >
                            {i.isActive ? 'Archive' : 'Restore'}
                          </button>
                        </span>
                      )}
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
