'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'
import Tabs from '@/components/billing/Tabs'
import Combobox from '@/components/billing/Combobox'
import Select from '@/components/billing/Select'
import { rowOpen } from '@/components/billing/rowOpen'
import { BILLING_TYPE_LABELS } from '@/lib/billing/constants'
import type { BillingType } from '@/lib/supabase/database.types'

interface PickerItem { id: string; code: string; name: string; category: string; tracked: boolean; rentable: boolean; salable: boolean; salePriceCents: number | null; variations: { id: string; name: string }[] }
interface LedgerEvent { id: string; eventType: string; date: string; qty: number; equipmentId: string | null; item: { id: string; code: string; name: string; tracked: boolean } | null; variation: { id: string; name: string } | null }
interface Line { id: string; kind: string; description: string; qty: number; units: number; unitRateCents: number; amountCents: number; taxable: boolean; itemCode: string | null }
interface Ticket {
  id: string; ticketNumber: string; date: string; status: string; locked: boolean
  featureAdd: boolean; featureReturn: boolean; featureDtc: boolean
  billingType: BillingType | null; recurring: boolean; notes: string | null
  job: { id: string; number: string; name: string | null } | null
  entityCode: string; customer: string | null
  statuses: string[]; billingTypes: BillingType[]
  ledger: LedgerEvent[]; lines: Line[]
  onRent: { code: string; name: string; variation: string | null; qty: number }[]
  isAdmin: boolean
}

const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '6px 9px', fontSize: 12.5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '7px 10px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)' }
const ghost: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit' }
const money = (c: number) => `$${(c / 100).toFixed(2)}`

export default function TicketDetailClient({ ticketId }: { ticketId: string }) {
  const [t, setT] = useState<Ticket | null>(null)
  const [items, setItems] = useState<PickerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'details' | 'equipment' | 'charges'>('details')

  // details form
  const [add, setAdd] = useState(false); const [ret, setRet] = useState(false); const [dtc, setDtc] = useState(false)
  const [date, setDate] = useState(''); const [billingType, setBillingType] = useState<string>(''); const [notes, setNotes] = useState('')

  // ledger add form
  const [lItem, setLItem] = useState(''); const [lVar, setLVar] = useState(''); const [lType, setLType] = useState('pickup')
  const [lDate, setLDate] = useState(''); const [lQty, setLQty] = useState('1'); const [lEquip, setLEquip] = useState('')
  // ledger inline edit
  const [editEv, setEditEv] = useState<string | null>(null)
  const [evQty, setEvQty] = useState(''); const [evDate, setEvDate] = useState(''); const [evEquip, setEvEquip] = useState('')

  // line add form
  const [cKind, setCKind] = useState('sale'); const [cItem, setCItem] = useState(''); const [cDesc, setCDesc] = useState(''); const [cQty, setCQty] = useState('1'); const [cRate, setCRate] = useState('0.00')
  // line inline edit
  const [editLn, setEditLn] = useState<string | null>(null)
  const [lnQty, setLnQty] = useState(''); const [lnRate, setLnRate] = useState(''); const [lnDesc, setLnDesc] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/billing/tickets/${ticketId}`).then((r) => r.json()),
      fetch('/api/billing/items/picker').then((r) => r.json()),
    ]).then(([tk, it]) => {
      if (!tk.success) throw new Error(tk.error)
      const d = tk.data as Ticket
      setT(d)
      setAdd(d.featureAdd); setRet(d.featureReturn); setDtc(d.featureDtc)
      setDate(d.date); setBillingType(d.billingType ?? ''); setNotes(d.notes ?? '')
      if (!lDate) setLDate(d.date)
      if (it.success) setItems(it.data)
      setErr(null)
    }).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false))
  }, [ticketId, lDate])

  useEffect(() => { load() }, [load])

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

  async function saveDetails() {
    if (dtc && (add || ret)) { setMsg('DTC cannot be combined with Add or Return'); return }
    if (!add && !ret && !dtc) { setMsg('Pick at least one feature'); return }
    if (await call(`/api/billing/tickets/${ticketId}`, 'PATCH', { ticketDate: date, featureAdd: add, featureReturn: ret, featureDtc: dtc, billingType: billingType || null, notes })) { setMsg('Saved.'); load() }
  }
  async function setStatus(status: string) { if (await call(`/api/billing/tickets/${ticketId}`, 'PATCH', { status, billingType: billingType || null })) load() }

  async function addLedger() {
    if (!items.find((i) => i.id === lItem)) { setMsg('Pick an item'); return }
    if (await call(`/api/billing/tickets/${ticketId}/ledger`, 'POST', { itemId: lItem, variationId: lVar || null, eventType: lType, eventDate: lDate, qty: parseInt(lQty, 10), equipmentId: lEquip || null })) { setLQty('1'); setLEquip(''); load() }
  }
  async function removeLedger(id: string) { if (await call(`/api/billing/tickets/${ticketId}/ledger?eventId=${id}`, 'DELETE')) load() }
  function startEditEv(e: LedgerEvent) { setEditEv(e.id); setEvQty(String(e.qty)); setEvDate(e.date); setEvEquip(e.equipmentId ?? '') }
  async function saveEv() {
    if (await call(`/api/billing/tickets/${ticketId}/ledger`, 'PATCH', { eventId: editEv, qty: parseInt(evQty, 10), eventDate: evDate, equipmentId: evEquip || null })) { setEditEv(null); load() }
  }

  async function addLine() {
    const payload = cKind === 'sale' ? { kind: 'sale', itemId: cItem, qty: parseFloat(cQty) } : { kind: cKind, description: cDesc, qty: parseFloat(cQty), unitRateCents: Math.round(parseFloat(cRate) * 100) }
    if (await call(`/api/billing/tickets/${ticketId}/lines`, 'POST', payload)) { setCDesc(''); setCQty('1'); setCRate('0.00'); setCItem(''); load() }
  }
  async function removeLine(id: string) { if (await call(`/api/billing/tickets/${ticketId}/lines?lineId=${id}`, 'DELETE')) load() }
  function startEditLn(l: Line) { setEditLn(l.id); setLnQty(String(l.qty)); setLnRate((l.unitRateCents / 100).toFixed(2)); setLnDesc(l.description) }
  async function saveLn(l: Line) {
    const payload: Record<string, unknown> = { lineId: l.id, qty: parseFloat(lnQty) }
    if (l.kind !== 'sale') { payload.unitRateCents = Math.round(parseFloat(lnRate) * 100); payload.description = lnDesc }
    if (await call(`/api/billing/tickets/${ticketId}/lines`, 'PATCH', payload)) { setEditLn(null); load() }
  }

  if (err) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {err}</div>
  if (loading || !t) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Skeleton height={40} /><Skeleton height={44} /><Skeleton height={200} /></div>

  const locked = t.locked
  const disabled = locked || busy
  const pickItem = items.find((i) => i.id === lItem)
  const rentItems = items.filter((i) => i.rentable) // equipment ledger = rentals only
  const saleItems = items.filter((i) => i.salable)
  const statusColors: Record<string, string> = { active: 'var(--pill-neutral-fg)', in_review: 'var(--pill-pending-fg)', final_edit: 'var(--pill-paid-fg)', invoiced: 'var(--accent)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1000 }}>
      <div>
        <Link href={t.job ? `/billing/jobs/${t.job.id}` : '/billing/tickets'} style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← {t.job ? `Job ${t.job.number}` : 'Tickets'}
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{t.ticketNumber}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: statusColors[t.status], textTransform: 'capitalize' }}>{t.status.replace('_', ' ')}</span>
          {t.recurring && <span title="Equipment still out" style={{ fontSize: 10, fontWeight: 600, color: 'var(--pill-pending-fg)', background: 'var(--pill-pending-bg)', padding: '2px 8px', borderRadius: 999 }}>RECURRING</span>}
          {locked && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>🔒 locked</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t.customer ?? '—'} · {t.job?.name ?? t.job?.number ?? '—'} · {t.entityCode}</div>
      </div>

      {msg && <div style={{ fontSize: 12, color: msg === 'Saved.' ? 'var(--alert-success-fg)' : 'var(--alert-danger-fg)', padding: '8px 10px', background: msg === 'Saved.' ? 'var(--alert-success-bg)' : 'var(--alert-danger-bg)', borderRadius: 6 }}>{msg}</div>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'details', label: 'Details' },
        { id: 'equipment', label: 'Equipment', badge: t.ledger.length },
        { id: 'charges', label: 'Charges', badge: t.lines.length },
      ]} />

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
            <div>
              <label style={labelStyle}>Billing type</label>
              <Select ariaLabel="Billing type" value={billingType} disabled={disabled} onChange={setBillingType} style={{ ...inputStyle }}>
                <option value="">Not set</option>
                {t.billingTypes.map((bt) => <option key={bt} value={bt}>{BILLING_TYPE_LABELS[bt]}</option>)}
              </Select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}><label style={labelStyle}>Notes</label><textarea value={notes} disabled={disabled} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {!locked && <button onClick={saveDetails} disabled={busy} className="btn-primary" style={{ padding: '7px 16px', opacity: busy ? 0.5 : 1 }}>Save details</button>}
            <span style={{ flex: 1 }} />
            {t.status === 'active' && <button onClick={() => setStatus('in_review')} disabled={busy} style={ghost}>Move to review</button>}
            {t.status === 'in_review' && <>
              <button onClick={() => setStatus('active')} disabled={busy} style={ghost}>Back to active</button>
              <button onClick={() => setStatus('final_edit')} disabled={busy} className="btn-primary" style={{ padding: '7px 16px' }}>Final edit (lock)</button>
            </>}
            {t.status === 'final_edit' && <button onClick={() => setStatus('in_review')} disabled={busy} style={ghost}>Reopen</button>}
          </div>
          {t.status === 'in_review' && !billingType && <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8 }}>Set a billing type before final edit.</div>}
        </div>
      )}

      {tab === 'equipment' && (
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>The quantity ledger. Rentals are computed from this at invoice time (pickup and return day both billed). Lost units leave the pool and bill at cost.</div>

          {t.onRent.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {t.onRent.map((r, idx) => (
                <span key={idx} style={{ fontSize: 12, background: 'var(--bg-nav)', border: '1px solid var(--border-subtle, var(--border-emphasis))', borderRadius: 6, padding: '4px 10px', fontVariantNumeric: 'tabular-nums' }}>
                  {r.qty} × {r.code}{r.variation ? ` (${r.variation})` : ''} out
                </span>
              ))}
            </div>
          )}

          {t.ledger.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr>{['Date', 'Event', 'Item', 'Variation', 'Qty', 'Equip ID', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {t.ledger.map((e) => editEv === e.id ? (
                    <tr key={e.id}>
                      <td style={td}><input type="date" value={evDate} onChange={(ev) => setEvDate(ev.target.value)} style={{ ...inputStyle, width: 140 }} /></td>
                      <td style={{ ...td, textTransform: 'capitalize' }}>{e.eventType}</td>
                      <td style={td}>{e.item?.code ?? '—'}</td>
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{e.variation?.name ?? '—'}</td>
                      <td style={td}><input value={evQty} onChange={(ev) => setEvQty(ev.target.value)} style={{ ...inputStyle, width: 60 }} /></td>
                      <td style={td}>{e.item?.tracked ? <input value={evEquip} onChange={(ev) => setEvEquip(ev.target.value)} style={{ ...inputStyle, width: 110 }} /> : '—'}</td>
                      <td style={td}><div style={{ display: 'flex', gap: 4 }}><button onClick={saveEv} disabled={busy} style={{ ...ghost, borderColor: 'var(--accent)', color: 'var(--accent)', padding: '4px 8px' }}>Save</button><button onClick={() => setEditEv(null)} style={{ ...ghost, padding: '4px 8px' }}>✕</button></div></td>
                    </tr>
                  ) : (
                    <tr key={e.id} {...rowOpen(!locked ? () => startEditEv(e) : undefined)} style={{ cursor: locked ? 'default' : 'pointer' }}>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{e.date}</td>
                      <td style={{ ...td, textTransform: 'capitalize', color: e.eventType === 'pickup' ? 'var(--pill-paid-fg)' : e.eventType === 'lost' ? 'var(--pill-overdue-fg)' : 'var(--text-secondary)' }}>{e.eventType}</td>
                      <td style={td}>{e.item?.code ?? '—'}</td>
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{e.variation?.name ?? '—'}</td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{e.qty}</td>
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
                <label style={labelStyle}>Item</label>
                <Combobox
                  ariaLabel="Item"
                  value={lItem}
                  onChange={(v) => { setLItem(v); setLVar('') }}
                  options={rentItems.map((i) => ({ value: i.id, label: i.name, hint: i.code }))}
                />
              </div>
              {pickItem && pickItem.variations.length > 0 && (
                <div style={{ minWidth: 130 }}><label style={labelStyle}>Variation</label>
                  <Select ariaLabel="Variation" value={lVar} onChange={setLVar} style={inputStyle}><option value="">—</option>{pickItem.variations.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
                </div>
              )}
              <div style={{ width: 120 }}><label style={labelStyle}>Event</label><Select ariaLabel="Event" value={lType} onChange={setLType} style={inputStyle}><option value="pickup">Pickup</option><option value="return">Return</option><option value="lost">Lost</option></Select></div>
              <div style={{ width: 140 }}><label style={labelStyle}>Date</label><input type="date" value={lDate} onChange={(e) => setLDate(e.target.value)} style={inputStyle} /></div>
              <div style={{ width: 70 }}><label style={labelStyle}>Qty</label><input value={lQty} onChange={(e) => setLQty(e.target.value)} style={inputStyle} /></div>
              {pickItem?.tracked && <div style={{ width: 130 }}><label style={labelStyle}>Equip ID *</label><input value={lEquip} onChange={(e) => setLEquip(e.target.value)} style={inputStyle} /></div>}
              <button onClick={addLedger} disabled={busy || !lItem} style={{ ...ghost, height: 30 }}>+ Add</button>
            </div>
          )}
        </div>
      )}

      {tab === 'charges' && (
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Sales, labor, lump sums and misc. Only sales are taxed. (Rentals and lost/stolen come from the Equipment ledger.)</div>

          {t.lines.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr>{['Kind', 'Description', 'Qty', 'Rate', 'Amount', 'Tax', ''].map((h) => <th key={h} style={{ ...th, textAlign: ['Qty', 'Rate', 'Amount'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {t.lines.map((l) => editLn === l.id ? (
                    <tr key={l.id}>
                      <td style={{ ...td, textTransform: 'capitalize' }}>{l.kind.replace('_', ' ')}</td>
                      <td style={td}>{l.kind === 'sale' ? l.description : <input value={lnDesc} onChange={(e) => setLnDesc(e.target.value)} style={inputStyle} />}</td>
                      <td style={{ ...td, textAlign: 'right' }}><input value={lnQty} onChange={(e) => setLnQty(e.target.value)} style={{ ...inputStyle, width: 60, textAlign: 'right' }} /></td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.kind === 'sale' ? money(l.unitRateCents) : <input value={lnRate} onChange={(e) => setLnRate(e.target.value)} style={{ ...inputStyle, width: 80, textAlign: 'right' }} />}</td>
                      <td style={{ ...td, textAlign: 'right', color: 'var(--text-dim)' }}>—</td>
                      <td style={td}>{l.taxable ? 'yes' : '—'}</td>
                      <td style={td}><div style={{ display: 'flex', gap: 4 }}><button onClick={() => saveLn(l)} disabled={busy} style={{ ...ghost, borderColor: 'var(--accent)', color: 'var(--accent)', padding: '4px 8px' }}>Save</button><button onClick={() => setEditLn(null)} style={{ ...ghost, padding: '4px 8px' }}>✕</button></div></td>
                    </tr>
                  ) : (
                    <tr key={l.id} {...rowOpen(!locked ? () => startEditLn(l) : undefined)} style={{ cursor: locked ? 'default' : 'pointer' }}>
                      <td style={{ ...td, textTransform: 'capitalize' }}>{l.kind.replace('_', ' ')}</td>
                      <td style={td}>{l.description}{l.itemCode ? <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{l.itemCode}</span> : null}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.qty}{l.units > 1 ? ` × ${l.units}` : ''}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.unitRateCents)}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.amountCents)}</td>
                      <td style={{ ...td, color: 'var(--text-dim)' }}>{l.taxable ? 'yes' : '—'}</td>
                      <td style={td}>{!locked && <div style={{ display: 'flex', gap: 4 }}><button onClick={(ev) => { ev.stopPropagation(); startEditLn(l) }} disabled={busy} style={{ ...ghost, padding: '4px 8px' }}>Edit</button><button onClick={(ev) => { ev.stopPropagation(); removeLine(l.id) }} disabled={busy} style={{ ...ghost, padding: '4px 8px' }}>✕</button></div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!locked && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle, var(--border-emphasis))', paddingTop: 14 }}>
              <div style={{ width: 120 }}><label style={labelStyle}>Kind</label>
                <Select ariaLabel="Kind" value={cKind} onChange={setCKind} style={inputStyle}><option value="sale">Sale</option><option value="labor">Labor</option><option value="lump_sum">Lump sum</option><option value="misc">Misc</option></Select>
              </div>
              {cKind === 'sale' ? (
                <div style={{ minWidth: 260 }}><label style={labelStyle}>Salable item</label>
                  <Combobox
                    ariaLabel="Salable item"
                    value={cItem}
                    onChange={setCItem}
                    options={saleItems.map((i) => ({ value: i.id, label: `${i.name} (${money(i.salePriceCents ?? 0)})`, hint: i.code }))}
                  />
                </div>
              ) : (
                <>
                  <div style={{ minWidth: 200 }}><label style={labelStyle}>Description</label><input value={cDesc} onChange={(e) => setCDesc(e.target.value)} style={inputStyle} /></div>
                  <div style={{ width: 100 }}><label style={labelStyle}>Rate ($)</label><input value={cRate} onChange={(e) => setCRate(e.target.value)} style={inputStyle} /></div>
                </>
              )}
              <div style={{ width: 70 }}><label style={labelStyle}>Qty</label><input value={cQty} onChange={(e) => setCQty(e.target.value)} style={inputStyle} /></div>
              <button onClick={addLine} disabled={busy || (cKind === 'sale' && !cItem)} style={{ ...ghost, height: 30 }}>+ Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
