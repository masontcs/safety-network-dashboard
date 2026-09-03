'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Skeleton from '@/components/ui/Skeleton'
import Combobox from '@/components/billing/Combobox'
import MoneyInput from '@/components/billing/MoneyInput'
import Select from '@/components/billing/Select'
import Toggle from '@/components/billing/Toggle'
import { BILLING_TYPES, BILLING_TYPE_LABELS, FLAT_RATE } from '@/lib/billing/constants'
import { buildTierGrid } from '@/lib/billing/pricing/tier-grid'
import type { RateKey } from '@/lib/supabase/database.types'

/**
 * Price-list editor.
 *
 * The preview uses the SAME `buildTierGrid` the server compiles with, so what you see
 * here is exactly what lands in `billing_price_list_rates` on save.
 *
 * How an equipment item is priced has two switches:
 *   - single_rate: one 'flat' rate across tiers, vs the six billing cadences. Tiers cascade
 *     either way.
 *   - variations: when an item has them, the variation is the priced unit — each carries its
 *     own grid, and the bare item isn't priced.
 *
 * Cell precedence (highest first): sticky override -> freeze -> % cascade.
 */

interface Tier { id?: string; key: string; name: string; pctOffPrevious: number }
interface Override { tierId: string; billingType: RateKey; rateCents: number }
interface Grid { bases: Partial<Record<RateKey, number>>; overrides: Override[] }
interface Variation { id: string; name: string }
interface EditorItem {
  id?: string
  key: string
  itemId: string
  code: string
  name: string
  category: string
  freezeAfterPosition: number | null
  tierExceptionTierId: string | null
  singleRate: boolean
  variations: Variation[]
  /** Rate grids keyed by '' (the item's own grid) or a variation id. */
  grids: Record<string, Grid>
}
interface CatalogItem { id: string; code: string; name: string; category: string; variations: Variation[] }

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
const pill: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)',
  padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
}

const ovKey = (tierId: string, bt: RateKey) => `${tierId}|${bt}`
const EMPTY_GRID: Grid = { bases: {}, overrides: [] }

/** '' = the item's own grid; otherwise one key per variation. The variation is the priced
 *  unit, so an item WITH variations has no '' grid. */
const gridKeysFor = (it: { variations: Variation[] }) =>
  it.variations.length > 0 ? it.variations.map((v) => v.id) : ['']

/** Which rate keys a grid shows: single-rate (and every charge item) is one flat rate;
 *  by-cadence equipment shows the six. Tiers cascade in every case. */
const rateKeysFor = (it: { category: string; singleRate: boolean }): RateKey[] =>
  it.category === 'Equipment' && !it.singleRate ? BILLING_TYPES : [FLAT_RATE]

let tmp = 0
const nextKey = () => `k${++tmp}`

export default function PriceListEditorClient({ priceListId }: { priceListId: string }) {
  const [name, setName] = useState('')
  const [tiers, setTiers] = useState<Tier[]>([])
  const [items, setItems] = useState<EditorItem[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [inUse, setInUse] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
        setItems(
          d.items.map((i: Omit<EditorItem, 'key'>) => ({
            ...i,
            variations: i.variations ?? [],
            grids: i.grids ?? {},
            singleRate: !!i.singleRate,
            key: nextKey(),
          }))
        )
        setCatalog(d.catalog)
        setExpanded(new Set()) // collapse everything on load — open an item to edit it
        setFetchError(null)
      })
      .catch((e: Error) => setFetchError(e.message))
      .finally(() => setLoading(false))
  }, [priceListId])

  useEffect(() => { load() }, [load])

  /**
   * Preview via the engine — identical math to the server's compile. Keyed by
   * `${itemKey}|${gridKey}` so each grid (item or variation) previews independently.
   */
  const preview = useMemo(() => {
    if (tiers.length === 0) return {}
    const engineTiers = tiers.map((t, i) => ({ name: t.name, pctOffPrevious: i === 0 ? 0 : t.pctOffPrevious }))
    const out: Record<string, Record<string, Partial<Record<RateKey, number>> | undefined>> = {}
    for (const it of items) {
      const freezeIdx =
        it.freezeAfterPosition == null ? null : it.freezeAfterPosition - 1 >= 0 ? it.freezeAfterPosition - 1 : null
      for (const gk of gridKeysFor(it)) {
        const grid = it.grids[gk] ?? EMPTY_GRID
        const overrides: Record<string, Partial<Record<RateKey, number>>> = {}
        for (const o of grid.overrides) {
          const t = tiers.find((x) => x.id === o.tierId)
          if (!t) continue
          ;(overrides[t.name] ??= {})[o.billingType] = o.rateCents
        }
        try {
          const compiled = buildTierGrid(
            { code: `${it.key}|${gk}`, base: grid.bases, freezeAfterTierIndex: freezeIdx, overrides },
            engineTiers
          )
          out[`${it.key}|${gk}`] = Object.fromEntries(tiers.map((t) => [t.key, compiled[t.name]]))
        } catch {
          out[`${it.key}|${gk}`] = {}
        }
      }
    }
    return out
  }, [tiers, items])

  function patchItem(key: string, next: Partial<EditorItem>) {
    setSaveMsg(null)
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)))
  }

  const mutateGrid = (key: string, gridKey: string, fn: (g: Grid) => Grid) => {
    setSaveMsg(null)
    setItems((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r
        const cur = r.grids[gridKey] ?? EMPTY_GRID
        return { ...r, grids: { ...r.grids, [gridKey]: fn(cur) } }
      })
    )
  }

  function setBase(key: string, gridKey: string, cents: number | null, rateKey: RateKey) {
    mutateGrid(key, gridKey, (g) => {
      const bases = { ...g.bases }
      if (cents == null) delete bases[rateKey]
      else bases[rateKey] = cents
      return { ...g, bases }
    })
  }

  function setOverride(key: string, gridKey: string, tierId: string | undefined, cents: number | null, rateKey: RateKey) {
    if (!tierId) return // a tier that hasn't been saved yet has no id to hang an override on
    mutateGrid(key, gridKey, (g) => {
      const rest = g.overrides.filter((o) => ovKey(o.tierId, o.billingType) !== ovKey(tierId, rateKey))
      return cents == null ? { ...g, overrides: rest } : { ...g, overrides: [...rest, { tierId, billingType: rateKey, rateCents: cents }] }
    })
  }

  const hasOverride = (grid: Grid, tierId: string | undefined, rateKey: RateKey) =>
    !!tierId && grid.overrides.some((o) => o.tierId === tierId && o.billingType === rateKey)

  /** Copy one variation's whole grid (bases + locked cells) onto EVERY variation of the item,
   *  overwriting them. For the common case where most variations share a price: price one, click
   *  Apply to all, then tweak the few exceptions. */
  function applyToAllVariations(key: string, sourceGridKey: string) {
    setItems((rows) => rows.map((r) => {
      if (r.key !== key || r.variations.length < 2) return r
      const src = r.grids[sourceGridKey] ?? EMPTY_GRID
      const grids = { ...r.grids }
      for (const v of r.variations) {
        grids[v.id] = { bases: { ...src.bases }, overrides: src.overrides.map((o) => ({ ...o })) }
      }
      return { ...r, grids }
    }))
    setSaveMsg(null)
  }

  const toggleExpand = (key: string) =>
    setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  /** A short human descriptor for the collapsed row. */
  const summaryOf = (it: EditorItem) => {
    const parts: string[] = []
    if (it.category === 'Equipment') parts.push(it.singleRate ? 'single rate' : '6 billing types')
    else parts.push('flat rate')
    if (it.variations.length > 0) parts.push(`${it.variations.length} variation${it.variations.length === 1 ? '' : 's'}`)
    if (it.tierExceptionTierId) parts.push('tier exception')
    return parts.join(' · ')
  }

  /** One grid: rate keys down the side, tiers across. Reused for the item grid and each
   *  variation grid. */
  const renderRateGrid = (it: EditorItem, gridKey: string) => {
    const grid = it.grids[gridKey] ?? EMPTY_GRID
    const keys = rateKeysFor(it)
    // Disambiguate labels per variation so two variation grids never collide.
    const varName = it.variations.find((v) => v.id === gridKey)?.name
    const lbl = (rate: string, suffix: string) => `${it.code}${varName ? ` ${varName}` : ''} ${rate} ${suffix}`.trim()
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, paddingLeft: 2 }}>{keys.length === 1 ? 'Rate' : 'Billing type'}</th>
              {tiers.map((t, i) => (
                <th key={t.key} style={{ ...thStyle, textAlign: 'right' }}>{t.name}{i === 0 ? ' (base)' : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((bt) => (
              <tr key={bt}>
                <td style={{ ...tdStyle, paddingLeft: 2, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                  {keys.length === 1
                    ? (it.category === 'Equipment' ? 'Rate / day' : 'Rate')
                    : `${BILLING_TYPE_LABELS[bt as keyof typeof BILLING_TYPE_LABELS]} / day`}
                </td>
                {tiers.map((t, i) => {
                  const computed = preview[`${it.key}|${gridKey}`]?.[t.key]?.[bt]
                  const locked = hasOverride(grid, t.id, bt)
                  if (i === 0) {
                    return (
                      <td key={t.key} style={{ ...tdStyle, textAlign: 'right' }}>
                        <MoneyInput
                          valueCents={grid.bases[bt]}
                          ariaLabel={lbl(keys.length === 1 ? 'rate' : bt, 'base')}
                          onChangeCents={(c) => setBase(it.key, gridKey, c, bt)}
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
                          ariaLabel={lbl(keys.length === 1 ? 'rate' : bt, t.name)}
                          title={!t.id ? 'Save the price list before locking cells on a new tier' : undefined}
                          onChangeCents={(c) => setOverride(it.key, gridKey, t.id, c, bt)}
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
                          onClick={() => setOverride(it.key, gridKey, t.id, null, bt)}
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
    )
  }

  /** One item as a collapsible block. Collapsed shows a summary; open to edit. */
  const renderItemBlock = (it: EditorItem) => {
    const open = expanded.has(it.key)
    const hasVars = it.variations.length > 0
    return (
      <div key={it.key} className="card" style={{ padding: open ? '14px 16px' : '0' }}>
        <button
          onClick={() => toggleExpand(it.key)}
          aria-expanded={open}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
            background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            padding: open ? '0 0 12px' : '13px 16px', color: 'var(--text-primary)',
          }}
        >
          <span aria-hidden style={{ fontSize: 11, color: 'var(--text-muted)', width: 12 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontWeight: 500, fontSize: 13.5 }}>{it.name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>{it.code}</span>
          <span style={{ ...pill, marginLeft: 'auto' }}>{summaryOf(it)}</span>
        </button>

        {open && (
          <>
            {/* Per-item switches: apply to every grid, so they sit above them. */}
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))' }}>
              {it.category === 'Equipment' && (
                <Toggle
                  label="Single rate"
                  checked={it.singleRate}
                  onChange={(v) => patchItem(it.key, { singleRate: v })}
                />
              )}
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
              <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={() => { setItems((r) => r.filter((x) => x.key !== it.key)); setSaveMsg(null) }}>Remove item</button>
            </div>

            {hasVars ? (
              <>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>
                  This item has variations, so each is priced on its own. Price one, then{' '}
                  <b>Apply to all</b> to copy it to every variation — tweak the exceptions after.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {it.variations.map((v) => (
                    <div key={v.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)' }}>{v.name}</div>
                        {it.variations.length > 1 && (
                          <button
                            style={{ ...ghostBtn, padding: '3px 8px', fontSize: 11 }}
                            title="Copy this variation's rates to every variation (overwrites the others)"
                            onClick={() => { if (confirm(`Copy ${v.name}'s rates to all ${it.variations.length} variations? This overwrites the others.`)) applyToAllVariations(it.key, v.id) }}
                          >Apply to all →</button>
                        )}
                      </div>
                      {renderRateGrid(it, v.id)}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              renderRateGrid(it, '')
            )}
          </>
        )}
      </div>
    )
  }

  function addItem() {
    if (!addItemId) return
    const c = catalog.find((x) => x.id === addItemId)
    if (!c || items.some((i) => i.itemId === c.id)) return
    const key = nextKey()
    setItems((rows) => [
      ...rows,
      {
        key, itemId: c.id, code: c.code, name: c.name, category: c.category,
        freezeAfterPosition: null, tierExceptionTierId: null, singleRate: false,
        variations: c.variations ?? [], grids: {},
      },
    ])
    setExpanded((s) => new Set(s).add(key)) // open a freshly added item so you can price it
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
          items: items.map((i) => {
            // Only send the grids that apply, and only rate keys the item's current mode
            // allows — so toggling single-rate on drops any stale cadence values rather
            // than sending them for the server to reject.
            const allowed = new Set(rateKeysFor(i))
            const grids: Record<string, Grid> = {}
            for (const gk of gridKeysFor(i)) {
              const g = i.grids[gk] ?? EMPTY_GRID
              grids[gk] = {
                bases: Object.fromEntries(Object.entries(g.bases).filter(([k]) => allowed.has(k as RateKey))),
                overrides: g.overrides.filter((o) => allowed.has(o.billingType)),
              }
            }
            return {
              id: i.id,
              itemId: i.itemId,
              freezeAfterPosition: i.freezeAfterPosition,
              tierExceptionTierId: i.tierExceptionTierId,
              singleRate: i.singleRate,
              grids,
            }
          }),
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
  const equipmentItems = items.filter((i) => i.category === 'Equipment')
  const chargeItems = items.filter((i) => i.category !== 'Equipment')

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

      {/* Equipment — one collapsible block per item. Open one to price it; its rates hide
          until then so a long catalog stays scannable. */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Equipment rates</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Rates are <strong>per day</strong>. Daily / Weekly / Monthly are duration discounts — the rate you enter in each is
          the per-day price when an item is tagged that way on a ticket (weekly/monthly are cheaper per day). Rentals always
          bill by the number of days. Turn on <strong>single rate</strong> for a cone or barricade — one per-day rate instead
          of the three (tiers still apply). Items with variations are priced per variation.
        </div>
      </div>
      {equipmentItems.length === 0 ? (
        <div className="card" style={{ fontSize: 13, color: 'var(--text-muted)' }}>No equipment on this price list yet.</div>
      ) : (
        equipmentItems.map(renderItemBlock)
      )}

      {chargeItems.length > 0 && (
        <>
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Labor, lump sum &amp; misc rates</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              One rate each — these aren&apos;t rentals, so there&apos;s no billing type to choose. The same tier cascade,
              freeze and cell locks apply.
            </div>
          </div>
          {chargeItems.map(renderItemBlock)}
        </>
      )}

      {/* Adding an item drops it into whichever section its category belongs to. */}
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
