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
  cost_cents: number
  rentable: boolean
  salable: boolean
  sale_price_cents: number | null
  taxable: boolean
  tracked: boolean
  is_active: boolean
  billing_item_variations: { id: string; name: string; cost_adj_cents: number; sale_adj_cents: number; sort_order: number }[]
  billing_item_default_rates: { billing_type: BillingType; rate_cents: number }[]
}


/**
 * Everywhere an item can be referenced. Deleting is only ever safe when all of these are
 * empty — the billing tables (ledger / lines / accruals / invoices) are ON DELETE NO
 * ACTION so the database would refuse anyway, but price-list membership CASCADES, which
 * would silently strip the item from every list without a word. So it counts as usage.
 *
 * Recomputed on the server for the DELETE itself: the UI hides the button when an item is
 * in use, but a hidden button is a UI convenience, not a permission check.
 */
async function itemUsage(supabase: ReturnType<typeof createServiceClient>, itemId: string) {
  const count = async (table: string) => {
    const { count: n, error } = await supabase
      .from(table as 'billing_ticket_lines')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', itemId)
    if (error) throw new Error(error.message)
    return n ?? 0
  }
  const [priceLists, ticketLedger, ticketLines, accruals, invoiceLines] = await Promise.all([
    count('billing_price_list_items'),
    count('billing_ticket_ledger'),
    count('billing_ticket_lines'),
    count('billing_rental_accruals'),
    count('billing_invoice_lines'),
  ])

  // Phrased for a person reading a refusal, not for a log.
  const blockers: string[] = []
  if (invoiceLines > 0) blockers.push(`on ${invoiceLines} invoice line${invoiceLines === 1 ? '' : 's'}`)
  if (ticketLedger > 0) blockers.push(`on ${ticketLedger} ticket equipment ${ticketLedger === 1 ? 'entry' : 'entries'}`)
  if (ticketLines > 0) blockers.push(`on ${ticketLines} ticket charge line${ticketLines === 1 ? '' : 's'}`)
  if (accruals > 0) blockers.push(`in ${accruals} rental accrual${accruals === 1 ? '' : 's'}`)
  if (priceLists > 0) blockers.push(`on ${priceLists} price list${priceLists === 1 ? '' : 's'}`)

  return { priceLists, ticketLedger, ticketLines, accruals, invoiceLines, blockers, canDelete: blockers.length === 0 }
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
        id, code, name, category, cost_cents, rentable, salable, sale_price_cents,
        taxable, tracked, is_active,
        billing_item_variations(id, name, cost_adj_cents, sale_adj_cents, sort_order),
        billing_item_default_rates(billing_type, rate_cents)
      `)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(error.message)

    const i = data as unknown as ItemDetailRow | null
    if (!i) return bad('Item not found', 'NOT_FOUND', 404)

    const usage = await itemUsage(supabase, params.id)

    return NextResponse.json({
      success: true,
      data: {
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
        variations: (i.billing_item_variations ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((v) => ({ id: v.id, name: v.name, costAdjCents: v.cost_adj_cents, saleAdjCents: v.sale_adj_cents })),
        defaultRates: (i.billing_item_default_rates ?? []).map((r) => ({
          billingType: r.billing_type,
          rateCents: r.rate_cents,
        })),
        usage,
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
      code?: string
      name?: string
      category?: string
      costCents?: number
      rentable?: boolean
      salable?: boolean
      salePriceCents?: number | null
      taxable?: boolean
      tracked?: boolean
      isActive?: boolean
      variations?: { id?: string; name: string; costAdjCents?: number; saleAdjCents?: number }[]
      defaultRates?: { billingType: string; rateCents: number }[]
    }

    const supabase = createServiceClient()

    const { data: existing, error: exErr } = await supabase
      .from('billing_items')
      .select('id, category, rentable, salable, sale_price_cents')
      .eq('id', params.id)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (!existing) return bad('Item not found', 'NOT_FOUND', 404)

    // ── item fields ────────────────────────────────────────────────────────
    const patch: ItemUpdate = {}

    // The code is a LABEL, not a key: every relationship (price lists, ledger, lines,
    // invoices) references the item by id, so renaming it orphans nothing. Uniqueness
    // is the only rule, and the DB enforces it too — this just gives a readable error.
    if (body.code !== undefined) {
      const code = body.code.trim().toUpperCase()
      if (!code) return bad('Item code cannot be empty')
      const { data: dup, error: dErr } = await supabase
        .from('billing_items')
        .select('id')
        .eq('code', code)
        .neq('id', params.id)
        .maybeSingle()
      if (dErr) throw new Error(dErr.message)
      if (dup) return bad(`An item with code "${code}" already exists`, 'CONFLICT', 409)
      patch.code = code
    }

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return bad('Item name cannot be empty')
      patch.name = name
    }

    // Effective category (may be changing this request) — it drives the flags.
    let category = existing.category as BillingItemCategory
    if (body.category !== undefined) {
      category = body.category as BillingItemCategory
      if (!CATEGORIES.includes(category)) return bad(`Category must be one of: ${CATEGORIES.join(', ')}`)
      patch.category = category
    }
    const isEquipment = category === 'Equipment'
    const isSaleOnly = category === 'Sale'

    if (body.costCents !== undefined) {
      if (!Number.isInteger(body.costCents) || body.costCents < 0) return bad('Cost must be a whole number of cents')
      patch.cost_cents = body.costCents
    }
    if (body.isActive !== undefined) patch.is_active = body.isActive

    if (isSaleOnly) {
      // Sale: sold, never rented, never tracked.
      patch.rentable = false
      patch.salable = true
      patch.tracked = false
      const salePriceCents = body.salePriceCents ?? existing.sale_price_cents
      if (salePriceCents == null) return bad('A sale-only item needs a sale price')
      if (!Number.isInteger(salePriceCents) || salePriceCents < 0) return bad('Sale price must be a whole number of cents')
      patch.sale_price_cents = salePriceCents
      patch.taxable = body.taxable ?? true
    } else if (!isEquipment) {
      // Charge item (Labor / Lump Sum / Misc): never a good. Zero the flags,
      // including when the category is being switched away from Equipment.
      patch.rentable = false
      patch.salable = false
      patch.tracked = false
      patch.taxable = false
      patch.sale_price_cents = null
    } else {
      if (body.tracked !== undefined) patch.tracked = body.tracked

      // rentable / salable: an equipment item must stay usable for one of the two.
      const rentable = body.rentable ?? existing.rentable
      const salable = body.salable ?? existing.salable
      if (!rentable && !salable) return bad('An equipment item must be rentable or salable (or both).')
      // Switching category INTO Equipment: make sure a good flag is set.
      if (body.category !== undefined) { patch.rentable = rentable; patch.salable = salable }
      else if (body.rentable !== undefined) patch.rentable = rentable

      // salable / sale price / taxable move together: the DB enforces that a
      // salable item has a sale price, and tax only ever applies to sales lines.
      if (body.salable !== undefined || body.salePriceCents !== undefined || body.category !== undefined) {
        const salePriceCents = salable ? body.salePriceCents ?? existing.sale_price_cents : null
        if (salable) {
          if (salePriceCents == null) return bad('A salable item needs a sale price')
          if (!Number.isInteger(salePriceCents) || salePriceCents < 0) return bad('Sale price must be a whole number of cents')
        }
        patch.salable = salable
        patch.sale_price_cents = salePriceCents
      }
      if (body.taxable !== undefined || body.salable !== undefined || body.category !== undefined) {
        patch.taxable = salable ? body.taxable ?? true : false
      }
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
        // No rate adj here: a variation's rate adjustment is set per price list.
        for (const [label, val] of [['cost', v.costAdjCents], ['sale', v.saleAdjCents]] as const) {
          if (val !== undefined && !Number.isInteger(val)) return bad(`Variation ${label} adjustment must be a whole number of cents`)
        }
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
            .update({ name: v.name.trim(), cost_adj_cents: v.costAdjCents ?? 0, sale_adj_cents: v.saleAdjCents ?? 0, sort_order: idx })
            .eq('id', v.id)
          if (error) throw new Error(error.message)
        } else {
          const { error } = await supabase
            .from('billing_item_variations')
            .insert({ item_id: params.id, name: v.name.trim(), cost_adj_cents: v.costAdjCents ?? 0, sale_adj_cents: v.saleAdjCents ?? 0, sort_order: idx })
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

/**
 * Permanently delete an item — only ever allowed when it has never been used.
 *
 * Archiving (PATCH isActive:false) is the normal way to retire an item: it keeps the item
 * readable on every old ticket and invoice while hiding it from pickers. Delete exists for
 * the other case — the typo'd item created five minutes ago that should just go away.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const { data: existing, error: exErr } = await supabase
      .from('billing_items')
      .select('id, code')
      .eq('id', params.id)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (!existing) return bad('Item not found', 'NOT_FOUND', 404)

    // Recheck on the server. The UI hides the button for a used item, but that's a
    // convenience — this is the actual gate.
    const usage = await itemUsage(supabase, params.id)
    if (!usage.canDelete) {
      return bad(
        `"${existing.code}" can't be deleted — it's ${usage.blockers.join(', ')}. Archive it instead: that hides it from pickers but keeps it readable on existing records.`,
        'CONFLICT',
        409
      )
    }

    // Variations and default rates cascade. Nothing else references the item by now.
    const { error } = await supabase.from('billing_items').delete().eq('id', params.id)
    if (error) {
      // A reference we don't know about. Never force it — billing history wins.
      return bad(
        `"${existing.code}" is still referenced somewhere and can't be deleted. Archive it instead.`,
        'CONFLICT',
        409
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
