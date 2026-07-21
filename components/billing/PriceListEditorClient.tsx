'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'
import Combobox from '@/components/billing/Combobox'
import MoneyInput from '@/components/billing/MoneyInput'
import Select from '@/components/billing/Select'
import { BILLING_TYPES, BILLING_TYPE_LABELS, FLAT_RATE } from '@/lib/billing/constants'
import { buildTierGrid } from '@/lib/billing/pricing/tier-grid'
import type { RateKey } from '@/lib/supabase/database.types'

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
// billingType is a RateKey: a rental cadence, or 'flat' for charge items.
interface Override { tierId: string; billingType: RateKey; rateCents: number }
interface EditorItem {
  id?: string
  key: string
  itemId: string
  code: string
  name: string
  category: string
  freezeAfterPosition: number | null
  tierExceptionTierId: string | null
  bases: Partial<Record<RateKey, number>>
  overrides: Override[]
  variations: VariationAdj[]
}
/**
 * A variation's rate adjustment, set HERE rather than on the item: a rate is a property
 * of a price list, so its adjustment is too. One adjustment per variation — it applies to
 * every rate that variation is billed at, not per billing type.
 */
interface VariationAdj { id: string; name: string; rateAdjCents: number }
interface CatalogItem { id: string; code: string; name: string; category: string; variations: VariationAdj[] }

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '6px 8px', fontSize: 12.5, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
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

const ovKey = (tierId: string, bt: RateKey) => `${tierId}|${bt}`

let tmp = 0
const nextKey = () => `k${++tmp}`

export default function PriceListEditorClient({ priceListId }: { priceListId: string }) {
  const [name, setName] = useState('')
  const [tiers, setTiers] = useState<Tier[]>([])
  const [items, setItems] = useState<EditorItem[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [inUse, setInUse] = useState(0)

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
        setItems(d.items.map((i: EditorItem) => ({ ...i, variations: i.variations ?? [], key: nextKey() })))
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
    // [itemKey][tierKey] -> the tier's whole cell map, so a grid can read whichever
    // rate key it renders (a cadence, or 'flat').
    const out: Record<string, Record<string, Partial<Record<RateKey, number>> | undefined>> = {}
    for (const it of items) {
      const overrides: Record<string, Partial<Record<RateKey, number>>> = {}
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
        out[it.key] = Object.fromEntries(tiers.map((t) => [t.key, grid[t.name]]))
      } catch {
        out[it.key] = {}
      }
    }
    return out
  }, [tiers, items])

  function patchItem(key: string, next: Partial<EditorItem>) {
    setSaveMsg(null)
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)))
  }

  function setBase(key: string, cents: number | null, rateKey: RateKey) {
    setItems((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r
        const bases = { ...r.bases }
        if (cents == null) delete bases[rateKey]
        else bases[rateKey] = cents
        return { ...r, bases }
      })
    )
    setSaveMsg(null)
  }

  function setOverride(key: string, tierId: string | undefined, cents: number | null, rateKey: RateKey) {
    if (!tierId) return // a tier that hasn't been saved yet has no id to hang an override on
    setItems((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r
        const rest = r.overrides.filter((o) => ovKey(o.tierId, o.billingType) !== ovKey(tierId, rateKey))
        return cents == null ? { ...r, overrides: rest } : { ...r, overrides: [...rest, { tierId, billingType: rateKey, rateCents: cents }] }
      })
    )
    setSaveMsg(null)
  }

  /** An adjustment may be negative (a cheaper variant); the engine floors the rate at 0. */
  function setVariationAdj(key: string, variationId: string, cents: number | null) {
    setItems((rows) =>
      rows.map((r) =>
        r.key !== key
          ? r
          : { ...r, variations: r.variations.map((v) => (v.id === variationId ? { ...v, rateAdjCents: cents ?? 0 } : v)) }
      )
    )
    setSaveMsg(null)
  }

  const hasOverride = (it: EditorItem, tierId: string | undefined, rateKey: RateKey) =>
    !!tierId && it.overrides.some((o) => o.tierId === tierId && o.billingType === rateKey)

  // Category decides which rate keys an item prices, so the two never share a grid.
  const equipmentItems = items.filter((i) => i.category === 'Equipment')
  const chargeItems = items.filter((i) => i.category !== 'Equipment')

  /** One rate grid: rows x tiers, for a single rate key. */
  const renderGrid = ({ title, rows, rateKey, empty, blurb, control }: {
    title: string
    rows: EditorItem[]
    rateKey: RateKey
    empty: string
    blurb: string
    control: React.ReactNode
  }) => (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</div>
        {control}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>{blurb}</div>

      {rows.length === 0 ? (
        empty ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '14px 2px' }}>{empty}</div> : null
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
              {rows.flatMap((it) => [
                <tr key={it.key}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 500 }}>{it.code}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 12 }}>{it.name}</span>
                  </td>

                  {tiers.map((t, i) => {
                    const computed = preview[it.key]?.[t.key]?.[rateKey]
                    const locked = hasOverride(it, t.id, rateKey)
                    if (i === 0) {
                      return (
                        <td key={t.key} style={{ ...tdStyle, textAlign: 'right' }}>
                          <MoneyInput
                            valueCents={it.bases[rateKey]}
                            onChangeCents={(c) => setBase(it.key, c, rateKey)}
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
                            onChangeCents={(c) => setOverride(it.key, t.id, c, rateKey)}
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
                            onClick={() => setOverride(it.key, t.id, null, rateKey)}
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
                </tr>,

                // Variation adjustments hang off the item, not the tier columns: one
                // adjustment per variation, applied to whatever rate the cascade lands on.
                it.variations.length > 0 ? (
                  <tr key={`${it.key}-vars`}>
                    <td colSpan={tiers.length + 4} style={{ ...tdStyle, paddingTop: 0, paddingBottom: 12 }}>
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 12 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Variation adj
                        </span>
                        {it.variations.map((v) => (
                          <span key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{v.name}</span>
                            <MoneyInput
                              valueCents={v.rateAdjCents}
                              allowNegative
                              ariaLabel={`${it.code} ${v.name} rate adjustment`}
                              onChangeCents={(c) => setVariationAdj(it.key, v.id, c)}
                              style={{ ...inputStyle, maxWidth: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                            />
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ]).flat()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  /**
   * One equipment item as its own block: billing types down the side, tiers across.
   * The billing type is NOT a property of the price list — it's chosen per line on a
   * ticket — so every item carries a rate for all six cadences, and they're all visible
   * here rather than hidden behind a switcher.
   */
  const renderEquipmentItem = (it: EditorItem) => (
    <div key={it.key} className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 500, fontSize: 13.5 }}>{it.code}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>{it.name}</span>
        <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={() => { setItems((r) => r.filter((x) => x.key !== it.key)); setSaveMsg(null) }}>Remove</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, paddingLeft: 2 }}>Billing type</th>
              {tiers.map((t, i) => (
                <th key={t.key} style={{ ...thStyle, textAlign: 'right' }}>{t.name}{i === 0 ? ' (base)' : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BILLING_TYPES.map((bt) => (
              <tr key={bt}>
                <td style={{ ...tdStyle, paddingLeft: 2, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{BILLING_TYPE_LABELS[bt]}</td>
                {tiers.map((t, i) => {
                  const computed = preview[it.key]?.[t.key]?.[bt]
                  const locked = hasOverride(it, t.id, bt)
                  if (i === 0) {
                    return (
                      <td key={t.key} style={{ ...tdStyle, textAlign: 'right' }}>
                        <MoneyInput
                          valueCents={it.bases[bt]}
                          ariaLabel={`${it.code} ${BILLING_TYPE_LABELS[bt]} base rate`}
                          onChangeCents={(c) => setBase(it.key, c, bt)}
                          style={{ ...inputStyle, maxWidth: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
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
                          ariaLabel={`${it.code} ${BILLING_TYPE_LABELS[bt]} ${t.name} rate`}
                          title={!t.id ? 'Save the price list before locking cells on a new tier' : undefined}
                          onChangeCents={(c) => setOverride(it.key, t.id, c, bt)}
                          style={{
                            ...inputStyle, maxWidth: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                            borderColor: locked ? 'var(--accent)' : 'var(--border-emphasis)',
                            color: locked ? 'var(--accent)' : 'var(--text-primary)',
                            fontWeight: locked ? 600 : 400,
                            opacity: t.id ? 1 : 0.5,
                          }}
                        />
                        <button
                          title={locked ? 'Release this locked cell' : 'Not locked'}
                          aria-label={locked ? 'Release locked cell' : 'Not locked'}
                          disabled={!locked}
                          onClick={() => setOverride(it.key, t.id, null, bt)}
                          style={{ ...ghostBtn, padding: '4px 6px', opacity: locked ? 1 : 0.25, border: 'none' }}
                        >↺</button>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-item authoring controls: these apply to every billing type at once, so they
          sit under the item's grid rather than in any one cadence's row. */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle, var(--border-emphasis))' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Freeze after
          <Select
            ariaLabel={`${it.code} freeze after`}
            value={it.freezeAfterPosition ? String(it.freezeAfterPosition) : ''}
            onChange={(v) => patchItem(it.key, { freezeAfterPosition: v ? Number(v) : null })}
            style={{ maxWidth: 130 }}
          >
            <option value="">—</option>
            {tiers.map((t, i) => <option key={t.key} value={i + 1}>{t.name}</option>)}
          </Select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Tier exception
          <Select
            ariaLabel={`${it.code} tier exception`}
            value={it.tierExceptionTierId ?? ''}
            onChange={(v) => patchItem(it.key, { tierExceptionTierId: v || null })}
            style={{ maxWidth: 140 }}
          >
            <option value="">—</option>
            {tiers.filter((t) => t.id).map((t) => <option key={t.key} value={t.id}>{t.name}</option>)}
          </Select>
        </label>

        {it.variations.length > 0 && (
          <span style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Variation adj</span>
            {it.variations.map((v) => (
              <span key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{v.name}</span>
                <MoneyInput
                  valueCents={v.rateAdjCents === 0 ? null : v.rateAdjCents}
                  allowNegative
                  placeholder="0.00"
                  ariaLabel={`${it.code} ${v.name} rate adjustment`}
                  onChangeCents={(c) => setVariationAdj(it.key, v.id, c ?? 0)}
                  style={{ ...inputStyle, maxWidth: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                />
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )

  function addItem() {
    if (!addItemId) return
    const c = catalog.find((x) => x.id === addItemId)
    if (!c || items.some((i) => i.itemId === c.id)) return
    setItems((rows) => [
      ...rows,
      { key: nextKey(), itemId: c.id, code: c.code, name: c.name, category: c.category, freezeAfterPosition: null, tierExceptionTierId: null, bases: {}, overrides: [], variations: c.variations ?? [] },
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
            variationAdjs: i.variations.map((v) => ({ variationId: v.id, rateAdjCents: v.rateAdjCents })),
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

      {/* Equipment: one block per item, every billing type visible. The cadence is a
          per-ticket-line choice, not a price-list property, so an item holds a rate for
          all six — there's nothing to "pick" at the list level. Charge items price a
          single flat rate and keep the compact shared grid below. */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Equipment rates</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Each item carries a rate for every billing type — the cadence is chosen later, when the item goes on a ticket.
          Type a base in the first tier and the rest cascade; type into any later cell to lock it (locked cells never
          recompute, and tiers after them re-base off the locked value).
        </div>
      </div>
      {equipmentItems.length === 0 ? (
        <div className="card" style={{ fontSize: 13, color: 'var(--text-muted)' }}>No equipment on this price list yet.</div>
      ) : (
        equipmentItems.map(renderEquipmentItem)
      )}

      {chargeItems.length > 0 && renderGrid({
        title: 'Labor, lump sum & misc rates',
        rows: chargeItems,
        rateKey: FLAT_RATE,
        empty: '',
        blurb: 'One rate each — these aren\'t rentals, so there\'s no billing type to choose. The same tier cascade, freeze and cell locks apply.',
        control: null,
      })}

      {/* Adding an item drops it into whichever grid its category belongs to. */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
