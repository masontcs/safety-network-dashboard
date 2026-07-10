import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
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
  group_name: string | null
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
        id, code, name, category, group_name, cost_cents, rentable, salable, sale_price_cents,
        taxable, tracked, is_active,
        billing_item_variations(id),
        billing_item_default_rates(billing_type)
      `)
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
        groupName: i.group_name,
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
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as {
      code?: string
      name?: string
      category?: string
      groupName?: string | null
      costCents?: number
      rentable?: boolean
      salable?: boolean
      salePriceCents?: number | null
      taxable?: boolean
      tracked?: boolean
      variations?: { name: string; adjCents: number }[]
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
      if (!Number.isInteger(v.adjCents)) return bad('Variation adjustment must be a whole number of cents')
    }

    const category = body.category as BillingItemCategory | undefined
    if (!category || !CATEGORIES.includes(category)) {
      return bad(`Category must be one of: ${CATEGORIES.join(', ')}`)
    }

    const costCents = body.costCents ?? 0
    if (!Number.isInteger(costCents) || costCents < 0) return bad('Cost must be a whole number of cents, zero or greater')

    const rentable = body.rentable ?? true
    const salable = body.salable ?? false
    // Sale-only items can't be rented; an item that's neither is useless.
    if (!rentable && !salable) return bad('A sale-only item must be marked salable (it has to be sellable).')
    const salePriceCents = salable ? body.salePriceCents ?? null : null
    if (salable) {
      if (salePriceCents == null) return bad('A salable item needs a sale price')
      if (!Number.isInteger(salePriceCents) || salePriceCents < 0) return bad('Sale price must be a whole number of cents')
    }

    // Tax only ever applies to sales lines, so a non-salable item cannot be taxable.
    const taxable = salable ? body.taxable ?? true : false

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
        group_name: body.groupName?.trim() || null,
        cost_cents: costCents,
        rentable,
        salable,
        sale_price_cents: salePriceCents,
        taxable,
        tracked: body.tracked ?? false,
      })
      .select('id, code, name')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create item')

    // Variations entered on the create form (they need the item id, so insert now).
    if (variations.length > 0) {
      const rows = variations.map((v, i) => ({ item_id: created.id, name: v.name.trim(), adj_cents: v.adjCents, sort_order: i }))
      const { error: vErr } = await supabase.from('billing_item_variations').insert(rows)
      if (vErr) throw new Error(vErr.message)
    }

    return NextResponse.json({ success: true, data: created })
  } catch (err) {
    return billingApiError(err)
  }
}
