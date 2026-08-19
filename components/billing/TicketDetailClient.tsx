'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'
import Tabs from '@/components/billing/Tabs'
import Combobox from '@/components/billing/Combobox'
import Select from '@/components/billing/Select'
import TicketPhotosTab from '@/components/billing/TicketPhotosTab'
import TicketLaborTab from '@/components/billing/TicketLaborTab'
import TicketCrewCard from '@/components/billing/TicketCrewCard'
import { rowOpen } from '@/components/billing/rowOpen'
import { BILLING_TYPE_LABELS } from '@/lib/billing/constants'
import type { BillingType } from '@/lib/supabase/database.types'

interface PickerItem { id: string; code: string; name: string; category: string; tracked: boolean; rentable: boolean; salable: boolean; salePriceCents: number | null; ownerProfileId: string | null; variations: { id: string; name: string }[] }
interface LedgerEvent { id: string; eventType: string; date: string; qty: number; equipmentId: string | null; billingType: string | null; item: { id: string; code: string; name: string; tracked: boolean } | null; variation: { id: string; name: string } | null }
// Item-priced kinds (labor, lump sum) store no rate; the API resolves it live from the
// price list and sets rateFromPriceList so we can show the number while marking it as
// derived (not entered/locked). null still means genuinely unpriced.
interface Line { id: string; kind: string; description: string; qty: number; units: number; unitRateCents: number | null; amountCents: number | null; taxable: boolean; itemCode: string | null; rateFromPriceList?: boolean }
interface Ticket {
  id: string; ticketNumber: string; date: string; status: string; locked: boolean
  voided: boolean; voidedAt: string | null
  featureAdd: boolean; featureReturn: boolean; featureDtc: boolean
  billingType: BillingType | null; recurring: boolean; notes: string | null
  job: { id: string; number: string; name: string | null } | null
  profileId: string | null
  entityCode: string; customer: string | null
  statuses: string[]; billingTypes: BillingType[]
  pickupsMissingBillingType: number
  ledger: LedgerEvent[]; lines: Line[]
  /** What's still out on the JOB (not just this ticket) — the pool a return draws from. */
  onRent: { itemId: string; variationId: string | null; code: string; name: string; variation: string | null; qty: number }[]
  isAdmin: boolean
}

const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '6px 9px', fontSize: 12.5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '7px 10px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)' }
const ghost: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }
const money = (c: number) => `$${(c / 100).toFixed(2)}`
/** Shown when an item-priced line can't be priced yet (no rate on the list for it). */
const noRate = <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>no list rate</span>
/**
 * A money cell. `derived` marks a number resolved live from the price list (not entered),
 * shown in the accent colour with a tooltip so the office knows where it came from.
 */
const moneyCell = (c: number | null, derived = false) =>
  c === null ? noRate : <span title={derived ? 'From the price list' : undefined} style={derived ? { color: 'var(--accent)' } : undefined}>{money(c)}</span>
/** Charge kinds whose item + rate come from the catalog and its price list. */
const ITEM_PRICED_CATEGORY: Record<string, string | undefined> = { labor: 'Labor', lump_sum: 'Lump Sum' }

export default function TicketDetailClient({ ticketId }: { ticketId: string }) {
  const [t, setT] = useState<Ticket | null>(null)
  const [items, setItems] = useState<PickerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'details' | 'equipment' | 'sale' | 'labor' | 'lump_sum' | 'misc' | 'photos'>('details')

  // details form
  const [add, setAdd] = useState(false); const [ret, setRet] = useState(false); const [dtc, setDtc] = useState(false)
  const [date, setDate] = useState(''); const [notes, setNotes] = useState('')

  // ledger add form (billing type is the per-item cadence, only for pickups)
  const [lItem, setLItem] = useState(''); const [lVar, setLVar] = useState(''); const [lType, setLType] = useState('pickup')
  const [lDate, setLDate] = useState(''); const [lQty, setLQty] = useState('1'); const [lEquip, setLEquip] = useState(''); const [lBt, setLBt] = useState('')
  // return grid: qty typed per on-rent row, keyed `${itemId}|${variationId ?? ''}`
  const [retQty, setRetQty] = useState<Record<string, string>>({}); const [retDate, setRetDate] = useState('')
  // ledger inline edit
  const [editEv, setEditEv] = useState<string | null>(null)
  const [evQty, setEvQty] = useState(''); const [evDate, setEvDate] = useState(''); const [evEquip, setEvEquip] = useState('')
  // After a date edit, offer to match the rest of the ticket's items to it.
  const [datePrompt, setDatePrompt] = useState<{ date: string; count: number } | null>(null)

  // line add form
  const [cItem, setCItem] = useState(''); const [cVar, setCVar] = useState(''); const [cDesc, setCDesc] = useState(''); const [cQty, setCQty] = useState('1'); const [cRate, setCRate] = useState('0.00')
  // line inline edit
  const [editLn, setEditLn] = useState<string | null>(null)
  const [lnQty, setLnQty] = useState(''); const [lnRate, setLnRate] = useState(''); const [lnDesc, setLnDesc] = useState('')

  // Refresh the ticket. `silent` (the default, used after every mutation) keeps the
  // current view on screen instead of flashing the skeleton — billing is fast-paced and
  // the blank-then-repaint after each line edit is what felt choppy. The item catalog is
  // static for the life of this screen, so it's fetched ONCE below, never on refresh.
  const load = useCallback((silent = true) => {
    if (!silent) setLoading(true)
    return fetch(`/api/billing/tickets/${ticketId}`).then((r) => r.json()).then((tk) => {
      if (!tk.success) throw new Error(tk.error)
      const d = tk.data as Ticket
      setT(d)
      setAdd(d.featureAdd); setRet(d.featureReturn); setDtc(d.featureDtc)
      setDate(d.date); setNotes(d.notes ?? '')
      // Default the Add-item date: existing items' date if any, else the ticket date.
      // Functional setter (not a `lDate` read) so `load` doesn't depend on lDate — that
      // dependency made load re-create itself after the first fetch and double-load.
      setLDate((cur) => cur || (d.ledger.length ? d.ledger[d.ledger.length - 1].date : d.date))
      setRetDate((cur) => cur || d.date) // returns default to the ticket's own date
      setErr(null)
    }).catch((e: Error) => setErr(e.message)).finally(() => { if (!silent) setLoading(false) })
  }, [ticketId])

  // Catalog is fetched once — it doesn't change while editing a ticket.
  useEffect(() => {
    fetch('/api/billing/items/picker').then((r) => r.json()).then((it) => { if (it.success) setItems(it.data) }).catch(() => {})
  }, [])

  useEffect(() => { load(false) }, [load])

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json()
      if (!json.success) { setMsg(json.error); return false }
      return true
    } catch { setMsg('Network error — please try again.'); return false }
    finally { setBusy(false) }
  }

  async function toggleVoid() {
    const wantVoid = !t?.voided
    if (wantVoid && !window.confirm('Void this ticket? Its equipment, labor and charges will stop counting toward any invoice or quantity. You can restore it later.')) return
    if (await call(`/api/billing/tickets/${ticketId}`, 'PATCH', { action: wantVoid ? 'void' : 'unvoid' })) { setMsg(wantVoid ? 'Ticket voided.' : 'Ticket restored.'); load() }
  }

  async function saveDetails() {
    if (dtc && (add || ret)) { setMsg('DTC cannot be combined with Add or Return'); return }
    if (!add && !ret && !dtc) { setMsg('Pick at least one feature'); return }
    if (await call(`/api/billing/tickets/${ticketId}`, 'PATCH', { ticketDate: date, featureAdd: add, featureReturn: ret, featureDtc: dtc, notes })) { setMsg('Saved.'); load() }
  }
  async function setStatus(status: string) { if (await call(`/api/billing/tickets/${ticketId}`, 'PATCH', { status })) load() }

  /** Set an equipment item's cadence directly from its ledger row (pickup only). */
  async function setLedgerBillingType(id: string, bt: string) {
    if (await call(`/api/billing/tickets/${ticketId}/ledger`, 'PATCH', { eventId: id, billingType: bt || null })) load()
  }

  async function addLedger() {
    const qty = parseInt(lQty, 10)
    // Returning/losing picks from what's on rent (item+variation packed into one value);
    // a pickup picks any rentable item.
    const isReturn = lType === 'return' || lType === 'lost'
    const out = isReturn ? (t?.onRent ?? []).find((r) => `${r.itemId}|${r.variationId ?? ''}` === lItem) : null
    if (isReturn && !out) { setMsg('Pick something that’s on rent'); return }
    if (!isReturn && !items.find((i) => i.id === lItem)) { setMsg('Pick an item'); return }
    if (!(qty > 0)) { setMsg('Quantity must be greater than zero'); return }
    if (out && qty > out.qty) { setMsg(`Only ${out.qty} of that is on rent — you can’t ${lType} ${qty}.`); return }

    const payload = {
      itemId: out ? out.itemId : lItem,
      variationId: out ? out.variationId : (lVar || null),
      // DTC rows are always a daily pickup — the engine bills the day at the daily rate.
      eventType: isDtc ? 'pickup' : lType, eventDate: lDate, qty,
      equipmentId: lEquip || null,
      billingType: isDtc ? 'daily' : (lType === 'pickup' ? (lBt || null) : null),
    }
    if (await call(`/api/billing/tickets/${ticketId}/ledger`, 'POST', payload)) { setLQty('1'); setLEquip(''); setLBt(''); setLItem(''); load() }
  }

  /** Fill every return field with the full quantity that's out — "they brought it all back". */
  function fillAllReturns() {
    const next: Record<string, string> = {}
    for (const r of t?.onRent ?? []) next[`${r.itemId}|${r.variationId ?? ''}`] = String(r.qty)
    setRetQty(next)
  }

  /** Post the whole return grid in one request. */
  async function submitReturns() {
    const rows = (t?.onRent ?? [])
      .map((r) => ({ r, qty: parseInt(retQty[`${r.itemId}|${r.variationId ?? ''}`] ?? '', 10) }))
      .filter(({ qty }) => Number.isFinite(qty) && qty > 0)
    if (rows.length === 0) { setMsg('Enter a quantity to return.'); return }
    const over = rows.find(({ r, qty }) => qty > r.qty)
    if (over) { setMsg(`Only ${over.r.qty} of ${over.r.code} on rent — you can’t return ${over.qty}.`); return }

    const payload = { eventDate: retDate || lDate, returns: rows.map(({ r, qty }) => ({ itemId: r.itemId, variationId: r.variationId, qty })) }
    if (await call(`/api/billing/tickets/${ticketId}/ledger`, 'POST', payload)) { setRetQty({}); load() }
  }
  async function removeLedger(id: string) { if (await call(`/api/billing/tickets/${ticketId}/ledger?eventId=${id}`, 'DELETE')) load() }
  function startEditEv(e: LedgerEvent) { setEditEv(e.id); setEvQty(String(e.qty)); setEvDate(e.date); setEvEquip(e.equipmentId ?? '') }
  async function saveEv() {
    const newDate = evDate
    // How many OTHER items on the ticket don't already share this date?
    const mismatched = t ? t.ledger.filter((x) => x.id !== editEv && x.date !== newDate).length : 0
    if (await call(`/api/billing/tickets/${ticketId}/ledger`, 'PATCH', { eventId: editEv, qty: parseInt(evQty, 10), eventDate: newDate, equipmentId: evEquip || null })) {
      setEditEv(null)
      if (mismatched > 0) setDatePrompt({ date: newDate, count: mismatched })
      load()
    }
  }
  // Set every item on the ticket to the same date (the "match the rest" prompt).
  async function applyDateToAll() {
    if (!datePrompt) return
    const date = datePrompt.date
    setDatePrompt(null)
    if (await call(`/api/billing/tickets/${ticketId}/ledger`, 'PUT', { eventDate: date })) load()
  }

  async function addLine(kind: 'sale' | 'labor' | 'lump_sum' | 'misc') {
    // Sale, labor and lump sum are all item-based; only misc is typed by hand.
    const payload = kind === 'misc'
      ? { kind, description: cDesc, qty: parseFloat(cQty), unitRateCents: Math.round(parseFloat(cRate) * 100) }
      : { kind, itemId: cItem, qty: parseFloat(cQty), variationId: cVar || null }
    if (await call(`/api/billing/tickets/${ticketId}/lines`, 'POST', payload)) { setCDesc(''); setCQty('1'); setCRate('0.00'); setCItem(''); setCVar(''); load() }
  }
  async function removeLine(id: string) { if (await call(`/api/billing/tickets/${ticketId}/lines?lineId=${id}`, 'DELETE')) load() }
  // Item-priced lines have no rate to seed (null) — only misc's rate is ever editable.
  function startEditLn(l: Line) { setEditLn(l.id); setLnQty(String(l.qty)); setLnRate(((l.unitRateCents ?? 0) / 100).toFixed(2)); setLnDesc(l.description) }
  async function saveLn(l: Line) {
    const payload: Record<string, unknown> = { lineId: l.id, qty: parseFloat(lnQty) }
    // Only misc owns its description and rate; sale/labor/lump sum get both from the
    // catalog item and its price list, so only the quantity is editable.
    if (l.kind === 'misc') { payload.unitRateCents = Math.round(parseFloat(lnRate) * 100); payload.description = lnDesc }
    if (await call(`/api/billing/tickets/${ticketId}/lines`, 'PATCH', payload)) { setEditLn(null); load() }
  }

  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {err}</div>
  if (loading || !t) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Skeleton height={40} /><Skeleton height={44} /><Skeleton height={200} /></div>

  const locked = t.locked
  const disabled = locked || busy
  /**
   * Returning/losing draws from what's actually out on the job, so the picker switches from
   * "any rentable item" to "what's on rent", keyed by item+variation. You can't hand back
   * something that never went out.
   */
  const returnMode = lType === 'return' || lType === 'lost'
  // DTC (day-charge) tickets never start an ongoing rental: every equipment row is just a
  // one-day charge billed at the daily rate. So we don't ask for an event (it's always a
  // pickup) or a cadence (it's always daily) — those choices only exist for Add/Return.
  const isDtc = t?.featureDtc ?? false
  const onRentKeyOf = (itemId: string, variationId: string | null) => `${itemId}|${variationId ?? ''}`
  const pickedOut = returnMode ? t?.onRent.find((r) => onRentKeyOf(r.itemId, r.variationId) === lItem) ?? null : null
  const pickItem = items.find((i) => i.id === (returnMode ? pickedOut?.itemId : lItem))
  const rentItems = items.filter((i) => i.rentable) // equipment ledger = rentals only
  const saleItems = items.filter((i) => i.salable)
  const statusColors: Record<string, string> = { active: 'var(--pill-neutral-fg)', in_review: 'var(--pill-pending-fg)', final_edit: 'var(--pill-paid-fg)', invoiced: 'var(--accent)' }

  const chargeBlurb: Record<'sale' | 'labor' | 'lump_sum' | 'misc', string> = {
    sale: 'Sold goods. Only sales are taxed.',
    labor: 'Billed labor — pick a Labor item; its rate comes from the price list. Until invoicing rolls the time above up for you, these lines are added by hand, and they never change the recorded time.',
    lump_sum: 'Lump-sum charges — pick a Lump Sum item; its rate comes from the price list.',
    misc: 'Miscellaneous, one-off charges — the only kind typed by hand.',
  }

  // One charge kind's tab: its lines + a kind-locked add form. Shares the line
  // edit state (only one line is ever edited at a time).
  const renderChargeTab = (kind: 'sale' | 'labor' | 'lump_sum' | 'misc') => {
    if (!t) return null
    const rows = t.lines.filter((l) => l.kind === kind)
    const isSale = kind === 'sale'
    const label = kind === 'lump_sum' ? 'lump sum' : kind
    // Labor / Lump Sum pick a catalog item of that category; the price list prices it.
    const itemCategory = ITEM_PRICED_CATEGORY[kind]
    // Global items (no owner) plus THIS ticket's profile's custom items — never another profile's.
    const chargeItems = itemCategory
      ? items.filter((i) => i.category === itemCategory && (i.ownerProfileId == null || i.ownerProfileId === t.profileId))
      : []
    // Only misc is typed by hand.
    const isTyped = kind === 'misc'
    // When the picked item has variations, the variation IS the priced unit — offer it.
    const pickedChargeItem = items.find((i) => i.id === cItem) ?? null
    const chargeVariations = pickedChargeItem?.variations ?? []
    return (
      <div className="card">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>{chargeBlurb[kind]}</div>

        {rows.length > 0 ? (
          <div style={{ overflowX: 'auto', marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Description', 'Qty', 'Rate', 'Amount', ...(isSale ? ['Tax'] : []), ''].map((h, hi) => <th key={hi} style={{ ...th, textAlign: ['Qty', 'Rate', 'Amount'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((l) => editLn === l.id ? (
                  <tr key={l.id}>
                    <td style={td}>{isTyped ? <input value={lnDesc} onChange={(e) => setLnDesc(e.target.value)} style={inputStyle} /> : l.description}</td>
                    <td style={{ ...td, textAlign: 'right' }}><input value={lnQty} onChange={(e) => setLnQty(e.target.value)} style={{ ...inputStyle, width: 60, textAlign: 'right' }} /></td>
                    <td style={{ ...td, textAlign: 'right' }}>{isTyped ? <input value={lnRate} onChange={(e) => setLnRate(e.target.value)} style={{ ...inputStyle, width: 80, textAlign: 'right' }} /> : moneyCell(l.unitRateCents, l.rateFromPriceList)}</td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text-dim)' }}>—</td>
                    {isSale && <td style={td}>{l.taxable ? 'yes' : '—'}</td>}
                    <td style={td}><div style={{ display: 'flex', gap: 4 }}><button onClick={() => saveLn(l)} disabled={busy} style={{ ...ghost, borderColor: 'var(--accent)', color: 'var(--accent)', padding: '4px 8px' }}>Save</button><button onClick={() => setEditLn(null)} style={{ ...ghost, padding: '4px 8px' }}>✕</button></div></td>
                  </tr>
                ) : (
                  <tr key={l.id} {...rowOpen(!locked ? () => startEditLn(l) : undefined)} style={{ cursor: locked ? 'default' : 'pointer' }}>
                    <td style={td}>{l.description}{l.itemCode ? <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{l.itemCode}</span> : null}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.qty}{l.units > 1 ? ` × ${l.units}` : ''}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{moneyCell(l.unitRateCents, l.rateFromPriceList)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{moneyCell(l.amountCents, l.rateFromPriceList)}</td>
                    {isSale && <td style={{ ...td, color: 'var(--text-dim)' }}>{l.taxable ? 'yes' : '—'}</td>}
                    <td style={td}>{!locked && <div style={{ display: 'flex', gap: 4 }}><button onClick={(ev) => { ev.stopPropagation(); startEditLn(l) }} disabled={busy} style={{ ...ghost, padding: '4px 8px' }}>Edit</button><button onClick={(ev) => { ev.stopPropagation(); removeLine(l.id) }} disabled={busy} style={{ ...ghost, padding: '4px 8px' }}>✕</button></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14 }}>No {label} charges yet.</div>
        )}

        {!locked && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle, var(--border-emphasis))', paddingTop: 14 }}>
            {isSale && (
              <div style={{ minWidth: 260 }}><label style={labelStyle}>Salable item</label>
                <Combobox ariaLabel="Salable item" value={cItem} onChange={(v) => { setCItem(v); setCVar('') }} options={saleItems.map((i) => ({ value: i.id, label: `${i.name} (${money(i.salePriceCents ?? 0)})`, hint: i.code }))} />
              </div>
            )}
            {itemCategory && (
              <div style={{ minWidth: 260 }}><label style={labelStyle}>{itemCategory} item</label>
                <Combobox
                  ariaLabel={`${itemCategory} item`}
                  placeholder={chargeItems.length ? 'Select…' : `No ${itemCategory} items in the catalog`}
                  disabled={chargeItems.length === 0}
                  value={cItem}
                  onChange={(v) => { setCItem(v); setCVar('') }}
                  options={chargeItems.map((i) => ({ value: i.id, label: i.name, hint: i.code }))}
                />
              </div>
            )}
            {!isTyped && chargeVariations.length > 0 && (
              <div style={{ minWidth: 150 }}><label style={labelStyle}>Variation</label>
                <Combobox ariaLabel="Variation" value={cVar} onChange={setCVar} style={inputStyle}
                  options={chargeVariations.map((v) => ({ value: v.id, label: v.name }))} />
              </div>
            )}
            {isTyped && (
              <>
                <div style={{ minWidth: 200 }}><label style={labelStyle}>Description</label><input value={cDesc} onChange={(e) => setCDesc(e.target.value)} style={inputStyle} /></div>
                <div style={{ width: 100 }}><label style={labelStyle}>Rate ($)</label><input value={cRate} onChange={(e) => setCRate(e.target.value)} style={inputStyle} /></div>
              </>
            )}
            <div style={{ width: 70 }}><label style={labelStyle}>Qty</label><input value={cQty} onChange={(e) => setCQty(e.target.value)} style={inputStyle} /></div>
            <button onClick={() => addLine(kind)} disabled={busy || (!isTyped && !cItem)} style={{ ...ghost, height: 30 }}>+ Add</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1000 }}>
      {datePrompt && (
        <div
          onClick={() => setDatePrompt(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 380, width: '100%', background: 'var(--bg-surface)' }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>Match the other items?</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 18 }}>
              Set the date on the other {datePrompt.count} item{datePrompt.count > 1 ? 's' : ''} on this ticket to {datePrompt.date} too?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDatePrompt(null)} style={ghost}>Just this one</button>
              <button onClick={applyDateToAll} disabled={busy} className="btn-primary" style={{ padding: '8px 16px', opacity: busy ? 0.5 : 1 }}>Yes, update all</button>
            </div>
          </div>
        </div>
      )}
      <div>
        <Link href={t.job ? `/billing/jobs/${t.job.id}` : '/billing/tickets'} style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← {t.job ? `Job ${t.job.number}` : 'Tickets'}
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums', textDecoration: t.voided ? 'line-through' : undefined, color: t.voided ? 'var(--text-muted)' : undefined }}>{t.ticketNumber}</span>
          {t.voided
            ? <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--pill-overdue-fg)', background: 'var(--pill-overdue-bg)', padding: '2px 8px', borderRadius: 999, letterSpacing: '0.04em' }}>VOID</span>
            : <span style={{ fontSize: 11, fontWeight: 600, color: statusColors[t.status], textTransform: 'capitalize' }}>{t.status.replace('_', ' ')}</span>}
          {!t.voided && t.recurring && <span title="Equipment still out" style={{ fontSize: 10, fontWeight: 600, color: 'var(--pill-pending-fg)', background: 'var(--pill-pending-bg)', padding: '2px 8px', borderRadius: 999 }}>RECURRING</span>}
          {!t.voided && locked && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>🔒 locked</span>}
          {/* Void / restore is admin-only. Voiding a locked/invoiced ticket is blocked server-side. */}
          {t.isAdmin && (
            <button onClick={toggleVoid} disabled={busy} style={{ ...ghost, marginLeft: 'auto', color: t.voided ? 'var(--accent)' : 'var(--pill-overdue-fg)', borderColor: t.voided ? 'var(--accent)' : 'var(--pill-overdue-fg)' }}>
              {t.voided ? 'Restore ticket' : 'Void ticket'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t.customer ?? '—'} · {t.job?.name ?? t.job?.number ?? '—'} · {t.entityCode}</div>
      </div>

      {t.voided && (
        <div style={{ fontSize: 12.5, color: 'var(--alert-danger-fg)', background: 'var(--alert-danger-bg)', borderRadius: 6, padding: '10px 12px', lineHeight: 1.5 }}>
          This ticket is <strong>voided</strong> — its equipment, labor and charges don’t count toward any invoice or on-rent quantity. Restore it to make changes.
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: msg === 'Saved.' ? 'var(--alert-success-fg)' : 'var(--alert-danger-fg)', padding: '8px 10px', background: msg === 'Saved.' ? 'var(--alert-success-bg)' : 'var(--alert-danger-bg)', borderRadius: 6 }}>{msg}</div>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'details', label: 'Details' },
        { id: 'equipment', label: 'Equipment', badge: t.ledger.length },
        { id: 'sale', label: 'Sale', badge: t.lines.filter((l) => l.kind === 'sale').length },
        { id: 'labor', label: 'Labor', badge: t.lines.filter((l) => l.kind === 'labor').length },
        { id: 'lump_sum', label: 'Lump sum', badge: t.lines.filter((l) => l.kind === 'lump_sum').length },
        { id: 'misc', label: 'Misc', badge: t.lines.filter((l) => l.kind === 'misc').length },
        { id: 'photos', label: 'Photos' },
      ]} />

      {tab === 'details' && <TicketCrewCard ticketId={ticketId} canEdit={t.isAdmin && !locked} />}

      {tab === 'details' && (
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Features</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {([['Add', add, () => { setAdd(!add); if (!add) setDtc(false) }], ['Return', ret, () => { setRet(!ret); if (!ret) setDtc(false) }], ['DTC', dtc, () => { const n = !dtc; setDtc(n); if (n) { setAdd(false); setRet(false) } }]] as const).map(([lbl, on, toggle]) => (
                  <button key={lbl} disabled={disabled} onClick={toggle} style={{ ...ghost, ...(on ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 500 } : {}) }}>{lbl}</button>
                ))}
              </div>
            </div>
            <div><label style={labelStyle}>Ticket date</label><input type="date" value={date} disabled={disabled} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></div>
          </div>
          <div style={{ marginTop: 12 }}><label style={labelStyle}>Notes</label><textarea value={notes} disabled={disabled} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {!locked && <button onClick={saveDetails} disabled={busy} className="btn-primary" style={{ padding: '7px 16px', opacity: busy ? 0.5 : 1 }}>Save details</button>}
            <span style={{ flex: 1 }} />
            {t.status === 'active' && <button onClick={() => setStatus('in_review')} disabled={busy} style={ghost}>Move to review</button>}
            {t.status === 'in_review' && <>
              {/* The correction loop: back to 'active' is what puts the ticket back in
                  the crew's app so they can add what they missed and resubmit. Named
                  for what it does, not for the status it sets. */}
              <button onClick={() => setStatus('active')} disabled={busy} style={{ ...ghost, borderColor: 'var(--accent)', color: 'var(--accent)' }}>↩ Reopen for crew</button>
              <button onClick={() => setStatus('final_edit')} disabled={busy} className="btn-primary" style={{ padding: '7px 16px' }}>Final edit (lock)</button>
            </>}
            {t.status === 'final_edit' && <button onClick={() => setStatus('in_review')} disabled={busy} style={ghost}>Reopen to review</button>}
          </div>
          {t.status === 'in_review' && (
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>
              Submitted by the crew. <strong>Reopen for crew</strong> puts it back in their app to add anything missing —
              they&apos;ll submit it again.{t.pickupsMissingBillingType > 0 && ` Set a billing type on ${t.pickupsMissingBillingType} equipment item${t.pickupsMissingBillingType === 1 ? '' : 's'} before final edit.`}
            </div>
          )}
          {t.status === 'active' && (
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8 }}>
              Visible to the assigned crew — they can add labor and equipment until the lead submits it.
            </div>
          )}
        </div>
      )}

      {tab === 'equipment' && (
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>The quantity ledger. Rentals are computed from this at invoice time (pickup and return day both billed). Lost units leave the pool and bill at cost.</div>

          {/* Everything still out on the JOB, listed for direct entry — type quantities
              against the rows you're handing back and post them in one go. Beats picking
              items out of a dropdown one at a time when a job comes off rent. */}
          {t.onRent.length > 0 && (
            <div style={{ border: '1px solid var(--border-subtle, var(--border-emphasis))', borderRadius: 8, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>On rent for this job</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Enter what came back</span>
                {!locked && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      Date
                      <input type="date" value={retDate} onChange={(e) => setRetDate(e.target.value)} style={{ ...inputStyle, width: 140 }} />
                    </label>
                    <button onClick={fillAllReturns} disabled={busy} title="Fill every row with the full quantity out" style={ghost}>Returned all</button>
                    <button onClick={submitReturns} disabled={busy} className="btn-primary" style={{ padding: '6px 14px', opacity: busy ? 0.5 : 1 }}>Record returns</button>
                  </span>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr>{['Item', 'Variation', 'Out', 'Returning'].map((h) => <th key={h} style={{ ...th, textAlign: h === 'Out' || h === 'Returning' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {t.onRent.map((r) => {
                      const key = `${r.itemId}|${r.variationId ?? ''}`
                      const typed = parseInt(retQty[key] ?? '', 10)
                      const tooMany = Number.isFinite(typed) && typed > r.qty
                      return (
                        <tr key={key}>
                          <td style={td}><span style={{ fontWeight: 500 }}>{r.code}</span><span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{r.name}</span></td>
                          <td style={{ ...td, color: 'var(--text-muted)' }}>{r.variation ?? '—'}</td>
                          <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.qty}</td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <input
                              value={retQty[key] ?? ''}
                              disabled={locked || busy}
                              placeholder="0"
                              aria-label={`Quantity of ${r.code} returned`}
                              onChange={(e) => setRetQty((q) => ({ ...q, [key]: e.target.value }))}
                              style={{
                                ...inputStyle, width: 80, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                borderColor: tooMany ? 'var(--danger)' : undefined,
                                color: tooMany ? 'var(--danger)' : undefined,
                              }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {t.ledger.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr>{['Date', 'Event', 'Item', 'Variation', 'Qty', 'Billing', 'Equip ID', ''].filter((h) => !isDtc || (h !== 'Event' && h !== 'Billing')).map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {t.ledger.map((e) => editEv === e.id ? (
                    <tr key={e.id}>
                      <td style={td}><input type="date" value={evDate} onChange={(ev) => setEvDate(ev.target.value)} style={{ ...inputStyle, width: 140 }} /></td>
                      {!isDtc && <td style={{ ...td, textTransform: 'capitalize' }}>{e.eventType}</td>}
                      <td style={td}>{e.item?.code ?? '—'}</td>
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{e.variation?.name ?? '—'}</td>
                      <td style={td}><input value={evQty} onChange={(ev) => setEvQty(ev.target.value)} style={{ ...inputStyle, width: 60 }} /></td>
                      {!isDtc && <td style={{ ...td, color: 'var(--text-muted)' }}>{e.eventType === 'pickup' ? (e.billingType ? BILLING_TYPE_LABELS[e.billingType as BillingType] : '—') : '—'}</td>}
                      <td style={td}>{e.item?.tracked ? <input value={evEquip} onChange={(ev) => setEvEquip(ev.target.value)} style={{ ...inputStyle, width: 110 }} /> : '—'}</td>
                      <td style={td}><div style={{ display: 'flex', gap: 4 }}><button onClick={saveEv} disabled={busy} style={{ ...ghost, borderColor: 'var(--accent)', color: 'var(--accent)', padding: '4px 8px' }}>Save</button><button onClick={() => setEditEv(null)} style={{ ...ghost, padding: '4px 8px' }}>✕</button></div></td>
                    </tr>
                  ) : (
                    <tr key={e.id} {...rowOpen(!locked ? () => startEditEv(e) : undefined)} style={{ cursor: locked ? 'default' : 'pointer' }}>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{e.date}</td>
                      {!isDtc && <td style={{ ...td, textTransform: 'capitalize', color: e.eventType === 'pickup' ? 'var(--pill-paid-fg)' : e.eventType === 'lost' ? 'var(--pill-overdue-fg)' : 'var(--text-secondary)' }}>{e.eventType}</td>}
                      <td style={td}>{e.item?.code ?? '—'}</td>
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{e.variation?.name ?? '—'}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{e.qty}</td>
                      {/* The cadence lives per equipment item. Set it right here on the pickup;
                          return/lost rows don't bill a cadence. DTC has no cadence column at all. */}
                      {!isDtc && (
                      <td style={td} onClick={(ev) => ev.stopPropagation()}>
                        {e.eventType === 'pickup' ? (
                          <Select
                            ariaLabel={`Billing type for ${e.item?.code ?? 'item'}`}
                            value={e.billingType ?? ''}
                            disabled={locked || busy}
                            onChange={(v) => setLedgerBillingType(e.id, v)}
                            style={{ ...inputStyle, width: 110, borderColor: e.billingType ? undefined : 'var(--pill-pending-fg)' }}
                          >
                            <option value="">Set…</option>
                            {t.billingTypes.map((bt) => <option key={bt} value={bt}>{BILLING_TYPE_LABELS[bt]}</option>)}
                          </Select>
                        ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                      </td>
                      )}
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{e.equipmentId ?? '—'}</td>
                      <td style={td}>{!locked && <div style={{ display: 'flex', gap: 4 }}><button onClick={(ev) => { ev.stopPropagation(); startEditEv(e) }} disabled={busy} style={{ ...ghost, padding: '4px 8px' }}>Edit</button><button onClick={(ev) => { ev.stopPropagation(); removeLedger(e.id) }} disabled={busy} style={{ ...ghost, padding: '4px 8px' }}>✕</button></div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!locked && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle, var(--border-emphasis))', paddingTop: 14 }}>
              <div style={{ minWidth: 240 }}>
                <label style={labelStyle}>{returnMode ? 'On rent' : 'Item'}</label>
                <Combobox
                  ariaLabel={returnMode ? 'Item on rent' : 'Item'}
                  value={lItem}
                  onChange={(v) => { setLItem(v); setLVar('') }}
                  // Returning/losing can only draw from what's actually out, so the options
                  // ARE the on-rent pool, each showing how many are available.
                  options={returnMode
                    ? t.onRent.map((r) => ({
                        value: `${r.itemId}|${r.variationId ?? ''}`,
                        label: `${r.name}${r.variation ? ` (${r.variation})` : ''}`,
                        hint: `${r.qty} out · ${r.code}`,
                      }))
                    : rentItems.map((i) => ({ value: i.id, label: i.name, hint: i.code }))}
                />
              </div>
              {/* In return mode the variation is part of what you picked off the on-rent
                  list, so there's nothing left to choose. */}
              {!returnMode && pickItem && pickItem.variations.length > 0 && (
                <div style={{ minWidth: 150 }}><label style={labelStyle}>Variation</label>
                  <Combobox ariaLabel="Variation" value={lVar} onChange={setLVar} style={inputStyle} options={pickItem.variations.map((v) => ({ value: v.id, label: v.name }))} />
                </div>
              )}
              {/* Switching event type changes what the picker lists (catalog vs on-rent), so
                  the previous selection is meaningless — clear it. DTC is always a daily
                  pickup, so neither event nor cadence is asked. */}
              {!isDtc && (
                <div style={{ width: 120 }}><label style={labelStyle}>Event</label><Select ariaLabel="Event" value={lType} onChange={(v) => { setLType(v); setLItem(''); setLVar('') }} style={inputStyle}><option value="pickup">Pickup</option><option value="return">Return</option><option value="lost">Lost</option></Select></div>
              )}
              {!isDtc && lType === 'pickup' && (
                <div style={{ width: 120 }}><label style={labelStyle}>Billing</label>
                  <Select ariaLabel="Billing type" value={lBt} onChange={setLBt} style={inputStyle}>
                    <option value="">Set later</option>
                    {t.billingTypes.map((bt) => <option key={bt} value={bt}>{BILLING_TYPE_LABELS[bt]}</option>)}
                  </Select>
                </div>
              )}
              <div style={{ width: 140 }}><label style={labelStyle}>Date</label><input type="date" value={lDate} onChange={(e) => setLDate(e.target.value)} style={inputStyle} /></div>
              <div style={{ width: 70 }}>
                <label style={labelStyle}>Qty{pickedOut ? ` / ${pickedOut.qty}` : ''}</label>
                <input value={lQty} onChange={(e) => setLQty(e.target.value)} style={inputStyle} />
              </div>
              {pickedOut && (
                <button
                  onClick={() => setLQty(String(pickedOut.qty))}
                  disabled={busy}
                  title={`Return all ${pickedOut.qty} that are out`}
                  style={{ ...ghost, height: 30 }}
                >All {pickedOut.qty}</button>
              )}
              {pickItem?.tracked && <div style={{ width: 130 }}><label style={labelStyle}>Equip ID *</label><input value={lEquip} onChange={(e) => setLEquip(e.target.value)} style={inputStyle} /></div>}
              <button onClick={addLedger} disabled={busy || !lItem} style={{ ...ghost, height: 30 }}>+ Add</button>
            </div>
          )}
        </div>
      )}

      {tab === 'sale' && renderChargeTab('sale')}
      {tab === 'labor' && (<>
        <TicketLaborTab ticketId={ticketId} canEdit={t.isAdmin && !locked} />
        {renderChargeTab('labor')}
      </>)}
      {tab === 'lump_sum' && renderChargeTab('lump_sum')}
      {tab === 'misc' && renderChargeTab('misc')}
      {tab === 'photos' && <TicketPhotosTab ticketId={ticketId} canEdit={t.isAdmin} />}
    </div>
  )
}
