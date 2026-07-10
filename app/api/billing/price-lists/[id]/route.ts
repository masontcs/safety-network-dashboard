import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { BILLING_TYPES } from '@/lib/billing/constants'
import { compilePriceListRates, type CompileItem, type CompileTier } from '@/lib/billing/pricing'
import type { BillingType } from '@/lib/supabase/database.types'

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
interface OverrideRow { price_list_item_id: string; tier_id: string; billing_type: BillingType; rate_cents: number }
interface BaseRow { price_list_item_id: string; billing_type: BillingType; base_cents: number }
interface PliRow {
  id: string
  item_id: string
  freeze_after_position: number | null
  tier_exception_tier_id: string | null
  billing_items: { id: string; code: string; name: string; category: string } | null
}

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
      .select('id, item_id, freeze_after_position, tier_exception_tier_id, billing_items(id, code, name, category)')
      .eq('price_list_id', params.id)
    if (pErr) throw new Error(pErr.message)
    const plis = (pliRaw ?? []) as unknown as PliRow[]
    const pliIds = plis.map((p) => p.id)

    let bases: BaseRow[] = []
    let overrides: OverrideRow[] = []
    if (pliIds.length > 0) {
      const { data: b, error: bErr } = await supabase
        .from('billing_price_list_item_bases')
        .select('price_list_item_id, billing_type, base_cents')
        .in('price_list_item_id', pliIds)
      if (bErr) throw new Error(bErr.message)
      bases = (b ?? []) as BaseRow[]

      const { data: o, error: oErr } = await supabase
        .from('billing_price_list_item_overrides')
        .select('price_list_item_id, tier_id, billing_type, rate_cents')
        .in('price_list_item_id', pliIds)
      if (oErr) throw new Error(oErr.message)
      overrides = (o ?? []) as OverrideRow[]
    }

    // Catalog items for the "add item" picker. A price list is where an item's
    // rate is set, so include everything that gets priced here: rentable
    // equipment AND charge items (Labor / Lump Sum / Misc). Exclude only
    // sale-only equipment (rentable=false Equipment) — those bill at a sale
    // price, not a list rate.
    const { data: catalog, error: cErr } = await supabase
      .from('billing_items')
      .select('id, code, name, category')
      .eq('is_active', true)
      .or('category.neq.Equipment,rentable.eq.true')
      .order('code')
    if (cErr) throw new Error(cErr.message)

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
          bases: Object.fromEntries(
            bases.filter((b) => b.price_list_item_id === p.id).map((b) => [b.billing_type, b.base_cents])
          ),
          overrides: overrides
            .filter((o) => o.price_list_item_id === p.id)
            .map((o) => ({ tierId: o.tier_id, billingType: o.billing_type, rateCents: o.rate_cents })),
        })),
        catalog: catalog ?? [],
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

// ── PUT — save authoring inputs, then recompile the grid ─────────────────────
interface SaveTier { id?: string; name: string; pctOffPrevious: number }
interface SaveItem {
  id?: string
  itemId: string
  freezeAfterPosition?: number | null
  tierExceptionTierId?: string | null
  bases: Partial<Record<BillingType, number>>
  overrides?: { tierId: string; billingType: BillingType; rateCents: number }[]
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
    for (const it of itemsIn) {
      for (const [bt, cents] of Object.entries(it.bases)) {
        if (!BILLING_TYPES.includes(bt as BillingType)) return bad(`Unknown billing type "${bt}"`)
        if (!Number.isInteger(cents) || (cents as number) < 0) return bad('Base rates must be whole cents, zero or greater')
      }
      for (const o of it.overrides ?? []) {
        if (!Number.isInteger(o.rateCents) || o.rateCents < 0) return bad('Overrides must be whole cents, zero or greater')
      }
    }

    const supabase = createServiceClient()

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
      // bases / overrides / compiled rates cascade with the price-list item
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
          .update({ freeze_after_position: freeze, tier_exception_tier_id: tierException })
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
          })
          .select('id')
          .single()
        if (error || !ins) throw new Error(error?.message ?? 'Failed to add item to price list')
        pliId = ins.id
      }

      // Bases and overrides are pure authoring state — replace wholesale.
      const { error: dbErr } = await supabase.from('billing_price_list_item_bases').delete().eq('price_list_item_id', pliId)
      if (dbErr) throw new Error(dbErr.message)
      const baseRows = Object.entries(it.bases)
        .filter(([, cents]) => cents != null)
        .map(([bt, cents]) => ({ price_list_item_id: pliId as string, billing_type: bt as BillingType, base_cents: cents as number }))
      if (baseRows.length > 0) {
        const { error } = await supabase.from('billing_price_list_item_bases').insert(baseRows)
        if (error) throw new Error(error.message)
      }

      const { error: doErr } = await supabase.from('billing_price_list_item_overrides').delete().eq('price_list_item_id', pliId)
      if (doErr) throw new Error(doErr.message)
      const ovRows = (it.overrides ?? [])
        .filter((o) => validTierIds.has(o.tierId)) // a tier removed in this same save
        .map((o) => ({
          price_list_item_id: pliId as string,
          tier_id: o.tierId,
          billing_type: o.billingType,
          rate_cents: o.rateCents,
        }))
      if (ovRows.length > 0) {
        const { error } = await supabase.from('billing_price_list_item_overrides').insert(ovRows)
        if (error) throw new Error(error.message)
      }

      compileItems.push({
        priceListItemId: pliId,
        base: it.bases,
        freezeAfterPosition: freeze,
        overrides: ovRows.map((o) => ({ tierId: o.tier_id, billingType: o.billing_type, rateCents: o.rate_cents })),
      })
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
