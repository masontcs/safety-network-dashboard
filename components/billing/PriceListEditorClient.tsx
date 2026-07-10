'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'
import Combobox from '@/components/billing/Combobox'
import MoneyInput from '@/components/billing/MoneyInput'
import Select from '@/components/billing/Select'
import { BILLING_TYPES, BILLING_TYPE_LABELS } from '@/lib/billing/constants'
import { buildTierGrid } from '@/lib/billing/pricing/tier-grid'
import type { BillingType } from '@/lib/supabase/database.types'

/**
 * Price-list editor.
 *
 * The preview uses the SAME `buildTierGrid` the server compiles with, so what
 * you see here is exactly what lands in `billing_price_list_rates` on save.
 *
 * Cell precedence (highest first): sticky override -> freeze -> % cascade.
 * A sticky override re-bases every tier after it.
 */

interface Tier { id?: string; key: string; name: string; pctOffPrevious: number }
interface Override { tierId: string; billingType: BillingType; rateCents: number }
interface EditorItem {
  id?: string
  key: string
  itemId: string
  code: string
  name: string
  category: string
  freezeAfterPosition: number | null
  tierExceptionTierId: string | null
  bases: Partial<Record<BillingType, number>>
  overrides: Override[]
}
interface CatalogItem { id: string; code: string; name: string; category: string }

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted)', padding: '8px 10px', borderBottom: '1px solid var(--border-emphasis)', whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))',
  color: 'var(--text-primary)', verticalAlign: 'middle',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 6,
  padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
}

const ovKey = (tierId: string, bt: BillingType) => `${tierId}|${bt}`

let tmp = 0
const nextKey = () => `k${++tmp}`

export default function PriceListEditorClient({ priceListId }: { priceListId: string }) {
  const [name, setName] = useState('')
  const [tiers, setTiers] = useState<Tier[]>([])
  const [items, setItems] = useState<EditorItem[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [inUse, setInUse] = useState(0)
  const [billingType, setBillingType] = useState<BillingType>('daily')

  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [addItemId, setAddItemId] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/billing/price-lists/${priceListId}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        const d = json.data
        setName(d.name)
        setInUse(d.inUseByProfiles)
        setTiers(d.tiers.map((t: Tier) => ({ ...t, key: nextKey() })))
        setItems(d.items.map((i: EditorItem) => ({ ...i, key: nextKey() })))
        setCatalog(d.catalog)
        setFetchError(null)
      })
      .catch((e: Error) => setFetchError(e.message))
      .finally(() => setLoading(false))
  }, [priceListId])

  useEffect(() => { load() }, [load])

  /** Preview via the engine — identical math to the server's compile. */
  const preview = useMemo(() => {
    if (tiers.length === 0) return {}
    const engineTiers = tiers.map((t, i) => ({ name: t.name, pctOffPrevious: i === 0 ? 0 : t.pctOffPrevious }))
    const out: Record<string, Record<string, number | undefined>> = {}
    for (const it of items) {
      const overrides: Record<string, Partial<Record<BillingType, number>>> = {}
      for (const o of it.overrides) {
        const t = tiers.find((x) => x.id === o.tierId)
        if (!t) continue
        ;(overrides[t.name] ??= {})[o.billingType] = o.rateCents
      }
      const freezeIdx =
        it.freezeAfterPosition == null ? null : it.freezeAfterPosition - 1 >= 0 ? it.freezeAfterPosition - 1 : null
      try {
        const grid = buildTierGrid(
          { code: it.key, base: it.bases, freezeAfterTierIndex: freezeIdx, overrides },
          engineTiers
        )
        out[it.key] = Object.fromEntries(tiers.map((t) => [t.key, grid[t.name]?.[billingType]]))
      } catch {
        out[it.key] = {}
      }
    }
    return out
  }, [tiers, items, billingType])

  function patchItem(key: string, next: Partial<EditorItem>) {
    setSaveMsg(null)
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)))
  }

  function setBase(key: string, cents: number | null) {
    setItems((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r
        const bases = { ...r.bases }
        if (cents == null) delete bases[billingType]
        else bases[billingType] = cents
        return { ...r, bases }
      })
    )
    setSaveMsg(null)
  }

  function setOverride(key: string, tierId: string | undefined, cents: number | null) {
    if (!tierId) return // a tier that hasn't been saved yet has no id to hang an override on
    setItems((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r
        const rest = r.overrides.filter((o) => ovKey(o.tierId, o.billingType) !== ovKey(tierId, billingType))
        return cents == null ? { ...r, overrides: rest } : { ...r, overrides: [...rest, { tierId, billingType, rateCents: cents }] }
      })
    )
    setSaveMsg(null)
  }

  const hasOverride = (it: EditorItem, tierId?: string) =>
    !!tierId && it.overrides.some((o) => o.tierId === tierId && o.billingType === billingType)

  function addItem() {
    if (!addItemId) return
    const c = catalog.find((x) => x.id === addItemId)
    if (!c || items.some((i) => i.itemId === c.id)) return
    setItems((rows) => [
      ...rows,
      { key: nextKey(), itemId: c.id, code: c.code, name: c.name, category: c.category, freezeAfterPosition: null, tierExceptionTierId: null, bases: {}, overrides: [] },
    ])
    setAddItemId('')
    setSaveMsg(null)
  }

  async function save() {
    if (saving) return
    setSaving(true); setSaveError(null); setSaveMsg(null)
    try {
      const res = await fetch(`/api/billing/price-lists/${priceListId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          tiers: tiers.map((t) => ({ id: t.id, name: t.name, pctOffPrevious: t.pctOffPrevious })),
          items: items.map((i) => ({
            id: i.id,
            itemId: i.itemId,
            freezeAfterPosition: i.freezeAfterPosition,
            tierExceptionTierId: i.tierExceptionTierId,
            bases: i.bases,
            overrides: i.overrides,
          })),
        }),
      })
      const json = await res.json()
      if (!json.success) { setSaveError(json.error); return }
      setSaveMsg(`Saved — ${json.data.compiledRates} rates compiled.`)
      load()
    } catch { setSaveError('Network error — please try again.') }
    finally { setSaving(false) }
  }

  if (fetchError) return <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Skeleton height={40} /><Skeleton height={160} /><Skeleton height={280} /></div>

  const unusedCatalog = catalog.filter((c) => !items.some((i) => i.itemId === c.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Link href="/billing/price-lists" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>← Price lists</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <input value={name} onChange={(e) => { setName(e.target.value); setSaveMsg(null) }}
            style={{ ...inputStyle, fontSize: 18, fontWeight: 500, maxWidth: 420, padding: '8px 10px' }} />
          <button onClick={save} disabled={saving} className="btn-primary" style={{ marginLeft: 'auto', padding: '8px 20px', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save & compile'}
          </button>
        </div>
        {inUse > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Used by <strong>{inUse}</strong> billing profile{inUse === 1 ? '' : 's'}. Saving re-rates every line that
            hasn&apos;t been invoiced yet.
          </div>
        )}
      </div>

      {saveError && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>{saveError}</div>}
      {saveMsg && <div style={{ fontSize: 12, color: 'var(--alert-success-fg)', padding: '8px 10px', background: 'var(--alert-success-bg)', borderRadius: 6 }}>{saveMsg}</div>}

      {/* Tiers */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Tiers</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          The first tier is the base — its discount is ignored. Every later tier takes its percentage off the
          <em> previous</em> tier&apos;s price.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tiers.map((t, i) => (
            <div key={t.key} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', width: 20 }}>{i + 1}</span>
              <input value={t.name} onChange={(e) => { setTiers((r) => r.map((x) => x.key === t.key ? { ...x, name: e.target.value } : x)); setSaveMsg(null) }}
                style={{ ...inputStyle, maxWidth: 160 }} />
              <input value={i === 0 ? '' : String(t.pctOffPrevious)} disabled={i === 0}
                placeholder={i === 0 ? 'base' : '10'}
                onChange={(e) => { const n = Number(e.target.value); if (!Number.isFinite(n)) return; setTiers((r) => r.map((x) => x.key === t.key ? { ...x, pctOffPrevious: n } : x)); setSaveMsg(null) }}
                style={{ ...inputStyle, maxWidth: 90, opacity: i === 0 ? 0.5 : 1 }} />
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{i === 0 ? '' : '% off previous'}</span>
              <button style={{ ...ghostBtn, marginLeft: 'auto' }} disabled={tiers.length === 1}
                onClick={() => { setTiers((r) => r.filter((x) => x.key !== t.key)); setSaveMsg(null) }}>Remove</button>
            </div>
          ))}
          <button style={{ ...ghostBtn, alignSelf: 'flex-start' }}
            onClick={() => { setTiers((r) => [...r, { key: nextKey(), name: `T${r.length + 1}`, pctOffPrevious: 10 }]); setSaveMsg(null) }}>
            + Add tier
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Rate grid</div>
          <div style={{ marginLeft: 'auto', minWidth: 240 }}>
            <label style={labelStyle}>Billing type</label>
            <Select ariaLabel="Billing type" value={billingType} onChange={(v) => setBillingType(v as BillingType)}>
              {BILLING_TYPES.map((bt) => <option key={bt} value={bt}>{BILLING_TYPE_LABELS[bt]}</option>)}
            </Select>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Type a base price in the first tier and the rest cascade. Type into any later cell to <strong>lock</strong> it —
          locked cells never recompute, and the tiers after them re-base off the locked value. Each billing type has
          its own base.
        </div>

        {items.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '14px 2px' }}>No items on this price list yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Item</th>
                  {tiers.map((t, i) => (
                    <th key={t.key} style={{ ...thStyle, textAlign: 'right' }}>{t.name}{i === 0 ? ' (base)' : ''}</th>
                  ))}
                  <th style={thStyle}>Freeze after</th>
                  <th style={thStyle}>Tier exception</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.key}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 500 }}>{it.code}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 12 }}>{it.name}</span>
                    </td>

                    {tiers.map((t, i) => {
                      const computed = preview[it.key]?.[t.key]
                      const locked = hasOverride(it, t.id)
                      if (i === 0) {
                        return (
                          <td key={t.key} style={{ ...tdStyle, textAlign: 'right' }}>
                            <MoneyInput
                              valueCents={it.bases[billingType]}
                              onChangeCents={(c) => setBase(it.key, c)}
                              style={{ ...inputStyle, maxWidth: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                            />
                          </td>
                        )
                      }
                      return (
                        <td key={t.key} style={{ ...tdStyle, textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                            <MoneyInput
                              valueCents={computed}
                              disabled={!t.id}
                              title={!t.id ? 'Save the price list before locking cells on a new tier' : undefined}
                              onChangeCents={(c) => setOverride(it.key, t.id, c)}
                              style={{
                                ...inputStyle, maxWidth: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                borderColor: locked ? 'var(--accent)' : 'var(--border-emphasis)',
                                color: locked ? 'var(--accent)' : 'var(--text-primary)',
                                fontWeight: locked ? 600 : 400,
                                opacity: t.id ? 1 : 0.5,
                              }}
                            />
                            <button
                              title={locked ? 'Release this locked cell' : 'Not locked'}
                              disabled={!locked}
                              onClick={() => setOverride(it.key, t.id, null)}
                              style={{ ...ghostBtn, padding: '4px 6px', opacity: locked ? 1 : 0.25, border: 'none' }}
                            >↺</button>
                          </div>
                        </td>
                      )
                    })}

                    <td style={tdStyle}>
                      <Select
                        ariaLabel="Freeze after"
                        value={it.freezeAfterPosition ? String(it.freezeAfterPosition) : ''}
                        onChange={(v) => patchItem(it.key, { freezeAfterPosition: v ? Number(v) : null })}
                        style={{ maxWidth: 110 }}
                      >
                        <option value="">—</option>
                        {tiers.map((t, i) => <option key={t.key} value={i + 1}>{t.name}</option>)}
                      </Select>
                    </td>

                    <td style={tdStyle}>
                      <Select
                        ariaLabel="Tier exception"
                        value={it.tierExceptionTierId ?? ''}
                        onChange={(v) => patchItem(it.key, { tierExceptionTierId: v || null })}
                        style={{ maxWidth: 120 }}
                      >
                        <option value="">—</option>
                        {tiers.filter((t) => t.id).map((t) => <option key={t.key} value={t.id}>{t.name}</option>)}
                      </Select>
                    </td>

                    <td style={tdStyle}>
                      <button style={ghostBtn} onClick={() => { setItems((r) => r.filter((x) => x.key !== it.key)); setSaveMsg(null) }}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
          <div style={{ width: 320 }}>
            <Combobox
              ariaLabel="Add an item from the catalog"
              placeholder="Add an item from the catalog…"
              value={addItemId}
              onChange={setAddItemId}
              options={unusedCatalog.map((c) => ({ value: c.id, label: c.name, hint: c.code }))}
            />
          </div>
          <button style={ghostBtn} onClick={addItem} disabled={!addItemId}>+ Add item</button>
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)', marginLeft: 'auto' }}>
            A <strong>tier exception</strong> makes this item ignore the profile&apos;s category tier rule.
          </span>
        </div>
      </div>
    </div>
  )
}
