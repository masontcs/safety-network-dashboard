import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import type { BillingItemCategory, BillingType, Database } from '@/lib/supabase/database.types'
import { CATEGORIES, BILLING_TYPES } from '@/lib/billing/constants'

/**
 * A single catalog item: its fields, its variations, and its catalog default rates.
 *
 * Variations are updated by RECONCILING, not by delete-all-and-reinsert: a
 * variation may already be referenced by a ticket ledger row, and blowing it
 * away would orphan billing history. Deletes that the database refuses are
 * reported as a conflict rather than swallowed.
 */

type ItemUpdate = Database['public']['Tables']['billing_items']['Update']

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface ItemDetailRow {
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
  billing_item_variations: { id: string; name: string; adj_cents: number; sort_order: number }[]
  billing_item_default_rates: { billing_type: BillingType; rate_cents: number }[]
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_items')
      .select(`
        id, code, name, category, group_name, cost_cents, rentable, salable, sale_price_cents,
        taxable, tracked, is_active,
        billing_item_variations(id, name, adj_cents, sort_order),
        billing_item_default_rates(billing_type, rate_cents)
      `)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(error.message)

    const i = data as unknown as ItemDetailRow | null
    if (!i) return bad('Item not found', 'NOT_FOUND', 404)

    return NextResponse.json({
      success: true,
      data: {
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
        variations: (i.billing_item_variations ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((v) => ({ id: v.id, name: v.name, adjCents: v.adj_cents })),
        defaultRates: (i.billing_item_default_rates ?? []).map((r) => ({
          billingType: r.billing_type,
          rateCents: r.rate_cents,
        })),
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as {
      name?: string
      category?: string
      groupName?: string | null
      costCents?: number
      rentable?: boolean
      salable?: boolean
      salePriceCents?: number | null
      taxable?: boolean
      tracked?: boolean
      isActive?: boolean
      variations?: { id?: string; name: string; adjCents: number }[]
      defaultRates?: { billingType: string; rateCents: number }[]
    }

    const supabase = createServiceClient()

    const { data: existing, error: exErr } = await supabase
      .from('billing_items')
      .select('id, rentable, salable, sale_price_cents')
      .eq('id', params.id)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (!existing) return bad('Item not found', 'NOT_FOUND', 404)

    // ── item fields ────────────────────────────────────────────────────────
    const patch: ItemUpdate = {}
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return bad('Item name cannot be empty')
      patch.name = name
    }
    if (body.category !== undefined) {
      const category = body.category as BillingItemCategory
      if (!CATEGORIES.includes(category)) return bad(`Category must be one of: ${CATEGORIES.join(', ')}`)
      patch.category = category
    }
    if (body.groupName !== undefined) patch.group_name = body.groupName?.trim() || null
    if (body.costCents !== undefined) {
      if (!Number.isInteger(body.costCents) || body.costCents < 0) return bad('Cost must be a whole number of cents')
      patch.cost_cents = body.costCents
    }
    if (body.tracked !== undefined) patch.tracked = body.tracked
    if (body.isActive !== undefined) patch.is_active = body.isActive

    // rentable / salable: an item must stay usable for at least one of the two.
    const rentable = body.rentable ?? existing.rentable
    const salable = body.salable ?? existing.salable
    if (!rentable && !salable) return bad('An item must be rentable or salable (or both). A sale-only item must stay salable.')
    if (body.rentable !== undefined) patch.rentable = rentable

    // salable / sale price / taxable move together: the DB enforces that a
    // salable item has a sale price, and tax only ever applies to sales lines.
    if (body.salable !== undefined || body.salePriceCents !== undefined) {
      const salePriceCents = salable ? body.salePriceCents ?? existing.sale_price_cents : null
      if (salable) {
        if (salePriceCents == null) return bad('A salable item needs a sale price')
        if (!Number.isInteger(salePriceCents) || salePriceCents < 0) return bad('Sale price must be a whole number of cents')
      }
      patch.salable = salable
      patch.sale_price_cents = salePriceCents
    }
    if (body.taxable !== undefined || body.salable !== undefined) {
      patch.taxable = salable ? body.taxable ?? true : false
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('billing_items').update(patch).eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    // ── variations: reconcile, never delete-all ────────────────────────────
    if (body.variations) {
      const seen = new Set<string>()
      for (const v of body.variations) {
        const n = v.name?.trim()
        if (!n) return bad('A variation needs a name')
        if (seen.has(n.toLowerCase())) return bad(`Duplicate variation name "${n}"`)
        seen.add(n.toLowerCase())
        if (!Number.isInteger(v.adjCents)) return bad('Variation adjustment must be a whole number of cents')
      }

      const { data: current, error: cErr } = await supabase
        .from('billing_item_variations')
        .select('id')
        .eq('item_id', params.id)
      if (cErr) throw new Error(cErr.message)

      const keepIds = new Set(body.variations.filter((v) => v.id).map((v) => v.id as string))
      const toDelete = (current ?? []).map((c) => c.id).filter((id) => !keepIds.has(id))

      if (toDelete.length > 0) {
        const { error: dErr } = await supabase.from('billing_item_variations').delete().in('id', toDelete)
        if (dErr) {
          // A ticket ledger row references this variation. Refuse loudly rather
          // than orphan billing history.
          return bad(
            'One or more variations are already used on a ticket and cannot be removed. Rename them instead.',
            'CONFLICT',
            409
          )
        }
      }

      for (const [idx, v] of body.variations.entries()) {
        if (v.id) {
          const { error } = await supabase
            .from('billing_item_variations')
            .update({ name: v.name.trim(), adj_cents: v.adjCents, sort_order: idx })
            .eq('id', v.id)
          if (error) throw new Error(error.message)
        } else {
          const { error } = await supabase
            .from('billing_item_variations')
            .insert({ item_id: params.id, name: v.name.trim(), adj_cents: v.adjCents, sort_order: idx })
          if (error) throw new Error(error.message)
        }
      }
    }

    // ── catalog default rates: nothing references these, so replace wholesale ─
    if (body.defaultRates) {
      for (const r of body.defaultRates) {
        if (!BILLING_TYPES.includes(r.billingType as BillingType)) return bad(`Unknown billing type "${r.billingType}"`)
        if (!Number.isInteger(r.rateCents) || r.rateCents < 0) return bad('Default rate must be a whole number of cents')
      }
      const { error: dErr } = await supabase.from('billing_item_default_rates').delete().eq('item_id', params.id)
      if (dErr) throw new Error(dErr.message)

      if (body.defaultRates.length > 0) {
        const rows = body.defaultRates.map((r) => ({
          item_id: params.id,
          billing_type: r.billingType as BillingType,
          rate_cents: r.rateCents,
        }))
        const { error } = await supabase.from('billing_item_default_rates').insert(rows)
        if (error) throw new Error(error.message)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
