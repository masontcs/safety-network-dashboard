import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { BILLING_TYPES, FLAT_RATE, rateKeysFor } from '@/lib/billing/constants'
import { compilePriceListRates, type CompileItem, type CompileTier } from '@/lib/billing/pricing'
import type { RateKey, BillingItemCategory } from '@/lib/supabase/database.types'

/**
 * The price-list editor's read + save endpoints.
 *
 * SAVE is where the authoring inputs become the pricing grid:
 *   tiers (% off previous) + per-item Tier-1 bases + freeze-after-tier +
 *   sticky per-cell overrides   ──compilePriceListRates()──▶  billing_price_list_rates
 *
 * The compile is delegated to the unit-tested engine, so the grid the app writes
 * is byte-for-byte what the pricing resolver expects to read.
 *
 * Tier deletes are guarded by the database (migration 008): a tier a billing
 * profile depends on cannot be removed, because that would leave the profile
 * with a price list and no tier for an item category.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface TierRow { id: string; name: string; position: number; pct_off_previous: number }
// billing_type here is a RateKey: a rental cadence, or 'flat' for a single-rate/charge item.
// variation_id NULL = the item's own grid; non-null = that variation's grid.
interface OverrideRow { price_list_item_id: string; variation_id: string | null; tier_id: string; billing_type: RateKey; rate_cents: number }
interface BaseRow { price_list_item_id: string; variation_id: string | null; billing_type: RateKey; base_cents: number }
interface PliRow {
  id: string
  item_id: string
  freeze_after_position: number | null
  tier_exception_tier_id: string | null
  single_rate: boolean
  billing_items: { id: string; code: string; name: string; category: string } | null
}

/** The gridKey groups rate rows by which grid they belong to: '' = the item's own grid,
 *  otherwise the variation id. Keeps item-vs-variation handling in one place. */
const gridKey = (variationId: string | null) => variationId ?? ''

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()

    const { data: list, error: lErr } = await supabase
      .from('billing_price_lists')
      .select('id, name, entity_id, is_active')
      .eq('id', params.id)
      .maybeSingle()
    if (lErr) throw new Error(lErr.message)
    if (!list) return bad('Price list not found', 'NOT_FOUND', 404)

    const { data: tiersRaw, error: tErr } = await supabase
      .from('billing_price_list_tiers')
      .select('id, name, position, pct_off_previous')
      .eq('price_list_id', params.id)
      .order('position')
    if (tErr) throw new Error(tErr.message)
    const tiers = (tiersRaw ?? []) as TierRow[]

    const { data: pliRaw, error: pErr } = await supabase
      .from('billing_price_list_items')
      .select('id, item_id, freeze_after_position, tier_exception_tier_id, single_rate, billing_items(id, code, name, category)')
      .eq('price_list_id', params.id)
    if (pErr) throw new Error(pErr.message)
    const plis = (pliRaw ?? []) as unknown as PliRow[]
    const pliIds = plis.map((p) => p.id)

    let bases: BaseRow[] = []
    let overrides: OverrideRow[] = []
    if (pliIds.length > 0) {
      const { data: b, error: bErr } = await supabase
        .from('billing_price_list_item_bases')
        .select('price_list_item_id, variation_id, billing_type, base_cents')
        .in('price_list_item_id', pliIds)
      if (bErr) throw new Error(bErr.message)
      bases = (b ?? []) as BaseRow[]

      const { data: o, error: oErr } = await supabase
        .from('billing_price_list_item_overrides')
        .select('price_list_item_id, variation_id, tier_id, billing_type, rate_cents')
        .in('price_list_item_id', pliIds)
      if (oErr) throw new Error(oErr.message)
      overrides = (o ?? []) as OverrideRow[]
    }

    // The variations of every item on this list. When an item has any, the variation is
    // the priced unit — its rates live in the variation-keyed grid rows above.
    const listItemIds = plis.map((p) => p.item_id)
    let variationsByItem: Record<string, { id: string; name: string }[]> = {}
    if (listItemIds.length > 0) {
      const { data: varsRaw, error: vErr } = await supabase
        .from('billing_item_variations')
        .select('id, item_id, name, sort_order')
        .in('item_id', listItemIds)
        .order('sort_order')
      if (vErr) throw new Error(vErr.message)
      const vars = (varsRaw ?? []) as { id: string; item_id: string; name: string; sort_order: number }[]
      variationsByItem = vars.reduce((acc, v) => {
        ;(acc[v.item_id] ??= []).push({ id: v.id, name: v.name })
        return acc
      }, {} as Record<string, { id: string; name: string }[]>)
    }

    // Group an item's bases + overrides into grids keyed by '' (the item grid) or a
    // variation id (that variation's grid).
    const gridsFor = (pliId: string) => {
      const out: Record<string, { bases: Record<string, number>; overrides: { tierId: string; billingType: RateKey; rateCents: number }[] }> = {}
      const ensure = (k: string) => (out[k] ??= { bases: {}, overrides: [] })
      for (const b of bases) if (b.price_list_item_id === pliId) ensure(gridKey(b.variation_id)).bases[b.billing_type] = b.base_cents
      for (const o of overrides) if (o.price_list_item_id === pliId) ensure(gridKey(o.variation_id)).overrides.push({ tierId: o.tier_id, billingType: o.billing_type, rateCents: o.rate_cents })
      return out
    }

    // Catalog items for the "add item" picker. A price list is where an item's
    // rate is set, so include everything that gets priced here: rentable
    // equipment AND charge items (Labor / Lump Sum / Misc). Exclude only
    // sale-only equipment (rentable=false Equipment) — those bill at a sale
    // price, not a list rate.
    const { data: catalogRaw, error: cErr } = await supabase
      .from('billing_items')
      .select('id, code, name, category, billing_item_variations(id, name, sort_order)')
      .eq('is_active', true)
      .neq('category', 'Sale')                      // sales are priced on the item
      .or('category.neq.Equipment,rentable.eq.true') // and rental-less equipment isn't priced here
      .order('code')
    if (cErr) throw new Error(cErr.message)

    // Carry variations onto the catalog so an item added to the list can be priced per
    // variation immediately, without a save-and-reload round trip.
    const catalog = (catalogRaw ?? []).map((c) => {
      const row = c as unknown as {
        id: string; code: string; name: string; category: string
        billing_item_variations: { id: string; name: string; sort_order: number }[] | null
      }
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        category: row.category,
        variations: (row.billing_item_variations ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((v) => ({ id: v.id, name: v.name })),
      }
    })

    // How many profiles depend on this list (drives delete warnings in the UI).
    const { count: profileUse } = await supabase
      .from('billing_profile_entities')
      .select('id', { count: 'exact', head: true })
      .eq('price_list_id', params.id)

    return NextResponse.json({
      success: true,
      data: {
        id: list.id,
        name: list.name,
        entityId: list.entity_id,
        isActive: list.is_active,
        inUseByProfiles: profileUse ?? 0,
        billingTypes: BILLING_TYPES,
        tiers: tiers.map((t) => ({ id: t.id, name: t.name, position: t.position, pctOffPrevious: Number(t.pct_off_previous) })),
        items: plis.map((p) => ({
          id: p.id,
          itemId: p.item_id,
          code: p.billing_items?.code ?? '',
          name: p.billing_items?.name ?? '',
          category: p.billing_items?.category ?? '',
          freezeAfterPosition: p.freeze_after_position,
          tierExceptionTierId: p.tier_exception_tier_id,
          singleRate: p.single_rate,
          variations: variationsByItem[p.item_id] ?? [],
          // Rate grids keyed by '' (item grid) or variation id. The client decides which
          // to show from whether the item has variations.
          grids: gridsFor(p.id),
        })),
        catalog,
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

// ── PUT — save authoring inputs, then recompile the grid ─────────────────────
interface SaveTier { id?: string; name: string; pctOffPrevious: number }
interface SaveGrid {
  bases: Partial<Record<RateKey, number>>
  overrides?: { tierId: string; billingType: RateKey; rateCents: number }[]
}
interface SaveItem {
  id?: string
  itemId: string
  freezeAfterPosition?: number | null
  tierExceptionTierId?: string | null
  /** Price one 'flat' rate across tiers instead of the six cadences. Equipment only. */
  singleRate?: boolean
  /** Rate grids keyed by '' (the item's own grid) or a variation id. When the item has
   *  variations, the variation is the priced unit, so its grids are variation-keyed. */
  grids: Record<string, SaveGrid>
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as { name?: string; tiers?: SaveTier[]; items?: SaveItem[] }
    const tiersIn = body.tiers
    const itemsIn = body.items ?? []
    if (!Array.isArray(tiersIn) || tiersIn.length === 0) return bad('A price list needs at least one tier')

    // ── validate before touching anything ────────────────────────────────
    const nameSeen = new Set<string>()
    for (const t of tiersIn) {
      const n = t.name?.trim()
      if (!n) return bad('Every tier needs a name')
      if (nameSeen.has(n.toLowerCase())) return bad(`Duplicate tier name "${n}"`)
      nameSeen.add(n.toLowerCase())
      if (!(t.pctOffPrevious >= 0 && t.pctOffPrevious < 100)) return bad('Tier % off must be between 0 and 100')
    }
    const supabase = createServiceClient()

    // An item's CATEGORY decides which rate keys it may price: equipment prices the
    // rental cadences, charge items (Labor / Lump Sum / Misc) price exactly one 'flat'
    // rate. Enforce it here so a labor rate can never end up in a 'daily' cell.
    const savedItemIds = [...new Set(itemsIn.map((i) => i.itemId))]
    const categoryById = new Map<string, BillingItemCategory>()
    const varIdsByItem = new Map<string, Set<string>>()
    if (savedItemIds.length > 0) {
      const { data: cats, error: cErr } = await supabase
        .from('billing_items')
        .select('id, category')
        .in('id', savedItemIds)
      if (cErr) throw new Error(cErr.message)
      for (const c of (cats ?? []) as { id: string; category: BillingItemCategory }[]) {
        categoryById.set(c.id, c.category)
      }
      const { data: vrs, error: vErr } = await supabase
        .from('billing_item_variations')
        .select('id, item_id')
        .in('item_id', savedItemIds)
      if (vErr) throw new Error(vErr.message)
      for (const v of (vrs ?? []) as { id: string; item_id: string }[]) {
        ;(varIdsByItem.get(v.item_id) ?? varIdsByItem.set(v.item_id, new Set()).get(v.item_id)!).add(v.id)
      }
    }

    // Which rate keys an item may price: equipment prices the six cadences UNLESS it's
    // single-rate, in which case it prices exactly one 'flat' key — same as a charge item.
    const allowedKeysFor = (category: BillingItemCategory, singleRate: boolean): RateKey[] =>
      category === 'Equipment' && !singleRate ? rateKeysFor('Equipment') : [FLAT_RATE]

    for (const it of itemsIn) {
      const category = categoryById.get(it.itemId)
      if (!category) return bad('An item on this price list no longer exists', 'NOT_FOUND', 404)
      const allowed = allowedKeysFor(category, !!it.singleRate)
      const allowedLabel = allowed.length === 1 ? 'a single flat rate' : 'a rental billing type'
      const itemVarIds = varIdsByItem.get(it.itemId) ?? new Set<string>()
      const hasVariations = itemVarIds.size > 0

      if (!it.grids || typeof it.grids !== 'object') return bad('Malformed item grids')
      for (const [key, grid] of Object.entries(it.grids)) {
        // The variation is the priced unit: an item WITH variations is priced only per
        // variation, one WITHOUT only on itself ('' key).
        if (key === '') {
          if (hasVariations) return bad(`"${it.itemId}" has variations, so it's priced per variation, not on the item.`)
        } else {
          if (!itemVarIds.has(key)) return bad('A grid references a variation that does not belong to this item', 'VALIDATION_ERROR', 400)
        }
        for (const [bt, cents] of Object.entries(grid.bases ?? {})) {
          if (!allowed.includes(bt as RateKey)) return bad(`This item is priced with ${allowedLabel} — "${bt}" doesn't apply to it.`)
          if (!Number.isInteger(cents) || (cents as number) < 0) return bad('Base rates must be whole cents, zero or greater')
        }
        for (const o of grid.overrides ?? []) {
          if (!allowed.includes(o.billingType)) return bad(`This item is priced with ${allowedLabel} — "${o.billingType}" doesn't apply to it.`)
          if (!Number.isInteger(o.rateCents) || o.rateCents < 0) return bad('Overrides must be whole cents, zero or greater')
        }
      }
    }

    const { data: list, error: lErr } = await supabase
      .from('billing_price_lists')
      .select('id')
      .eq('id', params.id)
      .maybeSingle()
    if (lErr) throw new Error(lErr.message)
    if (!list) return bad('Price list not found', 'NOT_FOUND', 404)

    if (body.name?.trim()) {
      const { error } = await supabase.from('billing_price_lists').update({ name: body.name.trim() }).eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    // ── tiers ─────────────────────────────────────────────────────────────
    const { data: currentTiers, error: ctErr } = await supabase
      .from('billing_price_list_tiers')
      .select('id')
      .eq('price_list_id', params.id)
    if (ctErr) throw new Error(ctErr.message)

    const keepTierIds = new Set(tiersIn.filter((t) => t.id).map((t) => t.id as string))
    const tiersToDelete = (currentTiers ?? []).map((t) => t.id).filter((id) => !keepTierIds.has(id))

    if (tiersToDelete.length > 0) {
      const { error } = await supabase.from('billing_price_list_tiers').delete().in('id', tiersToDelete)
      if (error) {
        // Migration 008: a tier a billing profile depends on is RESTRICTed.
        return bad(
          'A tier you removed is still assigned to a billing profile. Reassign that profile’s category tiers first.',
          'CONFLICT',
          409
        )
      }
    }

    // Two passes on position: `unique (price_list_id, position)` trips if we write
    // final positions directly during a reorder (verified). Park the existing rows
    // out of the way first. The parking values must stay >= 1 because the column
    // carries `check (position >= 1)` -- negatives are rejected (also verified).
    const PARK = 1000
    for (const [i, t] of tiersIn.entries()) {
      if (!t.id) continue
      const { error } = await supabase.from('billing_price_list_tiers').update({ position: PARK + i + 1 }).eq('id', t.id)
      if (error) throw new Error(error.message)
    }
    for (const [i, t] of tiersIn.entries()) {
      const position = i + 1
      const pct = i === 0 ? 0 : t.pctOffPrevious // the base tier has no discount
      if (t.id) {
        const { error } = await supabase
          .from('billing_price_list_tiers')
          .update({ name: t.name.trim(), position, pct_off_previous: pct })
          .eq('id', t.id)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase
          .from('billing_price_list_tiers')
          .insert({ price_list_id: params.id, name: t.name.trim(), position, pct_off_previous: pct })
        if (error) throw new Error(error.message)
      }
    }

    // ── items ─────────────────────────────────────────────────────────────
    const { data: currentPlis, error: cpErr } = await supabase
      .from('billing_price_list_items')
      .select('id')
      .eq('price_list_id', params.id)
    if (cpErr) throw new Error(cpErr.message)

    const keepPliIds = new Set(itemsIn.filter((i) => i.id).map((i) => i.id as string))
    const plisToDelete = (currentPlis ?? []).map((p) => p.id).filter((id) => !keepPliIds.has(id))
    if (plisToDelete.length > 0) {
      // bases / overrides / compiled rates — both item and variation grids — cascade with
      // the price-list item (all FK to price_list_item_id ON DELETE CASCADE).
      const { error } = await supabase.from('billing_price_list_items').delete().in('id', plisToDelete)
      if (error) throw new Error(error.message)
    }

    // Re-read tiers so we can map positions and validate override tier ids.
    const { data: freshTiersRaw, error: ftErr } = await supabase
      .from('billing_price_list_tiers')
      .select('id, name, position, pct_off_previous')
      .eq('price_list_id', params.id)
      .order('position')
    if (ftErr) throw new Error(ftErr.message)
    const freshTiers = (freshTiersRaw ?? []) as TierRow[]
    const validTierIds = new Set(freshTiers.map((t) => t.id))

    const compileItems: CompileItem[] = []

    for (const it of itemsIn) {
      let pliId = it.id
      const freeze = it.freezeAfterPosition ?? null
      const tierException = it.tierExceptionTierId && validTierIds.has(it.tierExceptionTierId) ? it.tierExceptionTierId : null

      if (pliId) {
        const { error } = await supabase
          .from('billing_price_list_items')
          .update({ freeze_after_position: freeze, tier_exception_tier_id: tierException, single_rate: !!it.singleRate })
          .eq('id', pliId)
        if (error) throw new Error(error.message)
      } else {
        const { data: ins, error } = await supabase
          .from('billing_price_list_items')
          .insert({
            price_list_id: params.id,
            item_id: it.itemId,
            freeze_after_position: freeze,
            tier_exception_tier_id: tierException,
            single_rate: !!it.singleRate,
          })
          .select('id')
          .single()
        if (error || !ins) throw new Error(error?.message ?? 'Failed to add item to price list')
        pliId = ins.id
      }

      // Bases and overrides are pure authoring state — replace wholesale for the whole
      // item (every grid), then re-insert each grid tagged with its variation_id ('' → NULL).
      const { error: dbErr } = await supabase.from('billing_price_list_item_bases').delete().eq('price_list_item_id', pliId)
      if (dbErr) throw new Error(dbErr.message)
      const { error: doErr } = await supabase.from('billing_price_list_item_overrides').delete().eq('price_list_item_id', pliId)
      if (doErr) throw new Error(doErr.message)

      for (const [key, grid] of Object.entries(it.grids)) {
        const variationId = key === '' ? null : key

        const baseRows = Object.entries(grid.bases ?? {})
          .filter(([, cents]) => cents != null)
          .map(([bt, cents]) => ({ price_list_item_id: pliId as string, variation_id: variationId, billing_type: bt as RateKey, base_cents: cents as number }))
        if (baseRows.length > 0) {
          const { error } = await supabase.from('billing_price_list_item_bases').insert(baseRows)
          if (error) throw new Error(error.message)
        }

        const ovRows = (grid.overrides ?? [])
          .filter((o) => validTierIds.has(o.tierId)) // a tier removed in this same save
          .map((o) => ({
            price_list_item_id: pliId as string,
            variation_id: variationId,
            tier_id: o.tierId,
            billing_type: o.billingType,
            rate_cents: o.rateCents,
          }))
        if (ovRows.length > 0) {
          const { error } = await supabase.from('billing_price_list_item_overrides').insert(ovRows)
          if (error) throw new Error(error.message)
        }

        // One CompileItem per grid — the item's own, or one per variation.
        compileItems.push({
          priceListItemId: pliId,
          variationId,
          base: grid.bases ?? {},
          freezeAfterPosition: freeze,
          overrides: ovRows.map((o) => ({ tierId: o.tier_id, billingType: o.billing_type, rateCents: o.rate_cents })),
        })
      }
    }

    // ── compile the grid ──────────────────────────────────────────────────
    const compileTiers: CompileTier[] = freshTiers.map((t) => ({
      id: t.id,
      name: t.name,
      position: t.position,
      pctOffPrevious: Number(t.pct_off_previous),
    }))

    const rates = compilePriceListRates(compileTiers, compileItems)

    const pliIds = compileItems.map((c) => c.priceListItemId)
    if (pliIds.length > 0) {
      const { error } = await supabase.from('billing_price_list_rates').delete().in('price_list_item_id', pliIds)
      if (error) throw new Error(error.message)
    }
    if (rates.length > 0) {
      const { error } = await supabase.from('billing_price_list_rates').insert(rates)
      if (error) throw new Error(error.message)
    }

    return NextResponse.json({ success: true, data: { compiledRates: rates.length } })
  } catch (err) {
    return billingApiError(err)
  }
}
