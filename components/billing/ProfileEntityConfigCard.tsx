'use client'

import { useState, useEffect, useCallback } from 'react'
import Skeleton from '@/components/ui/Skeleton'
import Select from '@/components/billing/Select'
import Combobox from '@/components/billing/Combobox'
import Toggle from '@/components/billing/Toggle'

/**
 * Billing profile x entity configuration.
 *
 * Enable the entities this profile bills under, and for each one pick a price
 * list plus a tier per item category. This is the price-list assignment that
 * had no home in the v1 prototype.
 */

type Category = 'Equipment' | 'Labor' | 'Lump Sum' | 'Misc'

interface Tier { id: string; name: string; position: number }
interface PriceList { id: string; name: string; entityId: string; tiers: Tier[] }
interface EntityRow {
  entityId: string
  code: string
  name: string
  letter: string
  enabled: boolean
  priceListId: string | null
  tierByCategory: Partial<Record<Category, string>>
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
}

export default function ProfileEntityConfigCard({ profileId }: { profileId: string }) {
  const [entities, setEntities] = useState<EntityRow[]>([])
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [profileName, setProfileName] = useState('')

  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/billing/profiles/${profileId}/entity-config`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setEntities(json.data.entities)
        setPriceLists(json.data.priceLists)
        setCategories(json.data.categories)
        setProfileName(json.data.profile.name)
        setFetchError(null)
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false))
  }, [profileId])

  useEffect(() => { load() }, [load])

  function patch(entityId: string, next: Partial<EntityRow>) {
    setSaveSuccess(false)
    setEntities((rows) => rows.map((r) => (r.entityId === entityId ? { ...r, ...next } : r)))
  }

  // Changing the price list invalidates every tier choice — they belong to the old list.
  function changePriceList(entityId: string, priceListId: string) {
    patch(entityId, { priceListId: priceListId || null, tierByCategory: {} })
  }

  const listsFor = (entityId: string) => priceLists.filter((pl) => pl.entityId === entityId)
  const tiersFor = (priceListId: string | null) =>
    priceListId ? (priceLists.find((pl) => pl.id === priceListId)?.tiers ?? []) : []

  // An enabled entity needs a price list and a tier for every category.
  const incomplete = entities.filter(
    (e) => e.enabled && (!e.priceListId || categories.some((c) => !e.tierByCategory[c]))
  )
  const canSave = incomplete.length === 0 && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/billing/profiles/${profileId}/entity-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entities: entities.map((e) => ({
            entityId: e.entityId,
            enabled: e.enabled,
            priceListId: e.enabled ? e.priceListId : null,
            tierByCategory: e.enabled ? e.tierByCategory : {},
          })),
        }),
      })
      const json = await res.json()
      if (!json.success) { setSaveError(json.error); return }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      load()
    } catch {
      setSaveError('Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
        Entities &amp; Price Lists{profileName ? ` — ${profileName}` : ''}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
        Enable each entity this profile bills under, then choose its price list and a tier per item
        category. Changing a price list re-rates every line that has not been invoiced yet, so the
        change is logged.
      </div>

      {fetchError ? (
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {fetchError}</div>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map((i) => <Skeleton key={i} height={90} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {entities.map((e) => {
            const lists = listsFor(e.entityId)
            const tiers = tiersFor(e.priceListId)
            return (
              <div
                key={e.entityId}
                style={{
                  border: '1px solid var(--border-subtle, var(--border-emphasis))',
                  borderRadius: 8,
                  padding: '12px 14px',
                  background: 'var(--bg-nav)',
                  opacity: e.enabled ? 1 : 0.65,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Toggle
                    ariaLabel={`Enable ${e.code}`}
                    checked={e.enabled}
                    onChange={(v) => patch(e.entityId, { enabled: v })}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {e.code}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.name}</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em',
                    color: 'var(--text-dim)', border: '1px solid var(--border-emphasis)', borderRadius: 4, padding: '1px 6px',
                  }}>
                    invoice prefix {e.letter}
                  </span>
                </div>

                {e.enabled && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ maxWidth: 340 }}>
                      <label style={labelStyle}>Price list</label>
                      <Combobox
                        ariaLabel="Price list"
                        value={e.priceListId ?? ''}
                        onChange={(v) => changePriceList(e.entityId, v)}
                        placeholder="Search price lists…"
                        options={lists.map((pl) => ({ value: pl.id, label: pl.name }))}
                      />
                      {lists.length === 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>
                          No price lists exist for {e.code} yet.
                        </div>
                      )}
                    </div>

                    {e.priceListId && (
                      <div>
                        <label style={labelStyle}>Tier per item category</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                          {categories.map((cat) => (
                            <div key={cat}>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{cat}</div>
                              <Select
                                ariaLabel={`Tier for ${cat}`}
                                value={e.tierByCategory[cat] ?? ''}
                                onChange={(v) =>
                                  patch(e.entityId, { tierByCategory: { ...e.tierByCategory, [cat]: v } })
                                }
                              >
                                <option value="">Select…</option>
                                {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </Select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {incomplete.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--danger)' }}>
              {incomplete.map((e) => e.code).join(', ')} — an enabled entity needs a price list and a tier for every category.
            </div>
          )}

          {saveError && (
            <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>
              {saveError}
            </div>
          )}
          {saveSuccess && (
            <div style={{ fontSize: 12, color: 'var(--alert-success-fg)', padding: '8px 10px', background: 'var(--alert-success-bg)', borderRadius: 6 }}>
              Saved successfully.
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!canSave}
            className="btn-primary"
            style={{ opacity: canSave ? 1 : 0.5, alignSelf: 'flex-start', padding: '8px 20px' }}
          >
            {saving ? 'Saving…' : 'Save configuration'}
          </button>
        </div>
      )}
    </div>
  )
}
