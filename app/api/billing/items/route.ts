import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import type { BillingItemCategory, BillingType } from '@/lib/supabase/database.types'
import { CATEGORIES, BILLING_TYPES } from '@/lib/billing/constants'

/**
 * The item catalog — the general library that price lists are built from.
 *
 * Money is integer cents. `cost_cents` is what a lost/stolen unit bills at
 * (never sale price). `taxable` only ever applies to SALES lines; rentals,
 * labor and lost/stolen are never taxed.
 *
 * `default_rates` are the catalog fallback used when a price list prices no
 * cell for the item (see the engine's rate-resolution order:
 * PriceItemTierException -> CategoryTierRule -> catalog default).
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface ItemListRow {
  id: string
  code: string
  name: string
  category: BillingItemCategory
  cost_cents: number
  rentable: boolean
  salable: boolean
  sale_price_cents: number | null
  taxable: boolean
  tracked: boolean
  is_active: boolean
  billing_item_variations: { id: string }[]
  billing_item_default_rates: { billing_type: BillingType }[]
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_items')
      .select(`
        id, code, name, category, cost_cents, rentable, salable, sale_price_cents,
        taxable, tracked, is_active,
        billing_item_variations(id),
        billing_item_default_rates(billing_type)
      `)
      .is('owner_profile_id', null) // the global catalog only — profile-scoped custom items live on their profile
      .order('code')
    if (error) throw new Error(error.message)

    // Embeds aren't modelled in Database['Relationships'], so assert the shape.
    const rows = (data ?? []) as unknown as ItemListRow[]

    return NextResponse.json({
      success: true,
      data: rows.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        category: i.category,
        costCents: i.cost_cents,
        rentable: i.rentable,
        salable: i.salable,
        salePriceCents: i.sale_price_cents,
        taxable: i.taxable,
        tracked: i.tracked,
        isActive: i.is_active,
        variationCount: (i.billing_item_variations ?? []).length,
        defaultRateCount: (i.billing_item_default_rates ?? []).length,
      })),
      meta: { categories: CATEGORIES, billingTypes: BILLING_TYPES },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // Billing roles are not defined yet — writes are admin-only until they are.
    const guard = guardBillingArea(ctx.access, 'items')
    if (guard) return guard

    const body = (await request.json()) as {
      code?: string
      name?: string
      category?: string
      costCents?: number
      rentable?: boolean
      salable?: boolean
      salePriceCents?: number | null
      taxable?: boolean
      tracked?: boolean
      variations?: { name: string; costAdjCents?: number; saleAdjCents?: number }[]
    }

    const code = body.code?.trim().toUpperCase()
    const name = body.name?.trim()
    if (!code) return bad('Item code is required')
    if (!name) return bad('Item name is required')

    // Validate variations up front so we don't create a half-built item.
    const variations = body.variations ?? []
    const seenVar = new Set<string>()
    for (const v of variations) {
      const vn = v.name?.trim()
      if (!vn) return bad('A variation needs a name')
      if (seenVar.has(vn.toLowerCase())) return bad(`Duplicate variation name "${vn}"`)
      seenVar.add(vn.toLowerCase())
      // No rate adj: a variation's rate adjustment is set per price list, not on the item.
      for (const [label, val] of [['cost', v.costAdjCents], ['sale', v.saleAdjCents]] as const) {
        if (val !== undefined && !Number.isInteger(val)) return bad(`Variation ${label} adjustment must be a whole number of cents`)
      }
    }

    const category = body.category as BillingItemCategory | undefined
    if (!category || !CATEGORIES.includes(category)) {
      return bad(`Category must be one of: ${CATEGORIES.join(', ')}`)
    }

    const costCents = body.costCents ?? 0
    if (!Number.isInteger(costCents) || costCents < 0) return bad('Cost must be a whole number of cents, zero or greater')

    // Category is what the item IS. 'Sale' is only ever sold (priced on the item);
    // Equipment rents and/or sells; Labor/Lump Sum/Misc are charge items.
    const isEquipment = category === 'Equipment'
    const isSaleOnly = category === 'Sale'
    let rentable = false
    let salable = false
    let salePriceCents: number | null = null
    let taxable = false
    let tracked = false

    if (isSaleOnly) {
      // Sale: sold, never rented, never tracked.
      salable = true
      salePriceCents = body.salePriceCents ?? null
      if (salePriceCents == null) return bad('A sale-only item needs a sale price')
      if (!Number.isInteger(salePriceCents) || salePriceCents < 0) return bad('Sale price must be a whole number of cents')
      taxable = body.taxable ?? true
    } else if (isEquipment) {
      rentable = body.rentable ?? true
      salable = body.salable ?? false
      if (!rentable && !salable) return bad('An equipment item must be rentable, salable, or both.')
      salePriceCents = salable ? body.salePriceCents ?? null : null
      if (salable) {
        if (salePriceCents == null) return bad('A salable item needs a sale price')
        if (!Number.isInteger(salePriceCents) || salePriceCents < 0) return bad('Sale price must be a whole number of cents')
      }
      // Tax only ever applies to sales lines, so a non-salable item cannot be taxable.
      taxable = salable ? body.taxable ?? true : false
      tracked = body.tracked ?? false
    }
    // Labor / Lump Sum / Misc: charge items — every flag stays false.

    const supabase = createServiceClient()

    const { data: dup, error: dErr } = await supabase.from('billing_items').select('id').eq('code', code).maybeSingle()
    if (dErr) throw new Error(dErr.message)
    if (dup) return bad(`An item with code "${code}" already exists`, 'CONFLICT', 409)

    const { data: created, error } = await supabase
      .from('billing_items')
      .insert({
        code,
        name,
        category,
        cost_cents: costCents,
        rentable,
        salable,
        sale_price_cents: salePriceCents,
        taxable,
        tracked,
      })
      .select('id, code, name')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create item')

    // Variations entered on the create form (they need the item id, so insert now).
    if (variations.length > 0) {
      // A variation moves the item's own numbers (cost, sale price); each defaults to 0.
      const rows = variations.map((v, i) => ({
        item_id: created.id,
        name: v.name.trim(),
        cost_adj_cents: v.costAdjCents ?? 0,
        sale_adj_cents: v.saleAdjCents ?? 0,
        sort_order: i,
      }))
      const { error: vErr } = await supabase.from('billing_item_variations').insert(rows)
      if (vErr) throw new Error(vErr.message)
    }

    return NextResponse.json({ success: true, data: created })
  } catch (err) {
    return billingApiError(err)
  }
}
