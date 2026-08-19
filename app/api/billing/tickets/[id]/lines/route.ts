import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import type { Database, BillingItemCategory } from '@/lib/supabase/database.types'

type LineUpdate = Database['public']['Tables']['billing_ticket_lines']['Update']

/**
 * Non-rental ticket charge lines: Sale, Labor, Lump Sum, Misc.
 *
 * Rentals and lost/stolen are NOT lines — they derive from the quantity ledger
 * at invoice time. Only SALES are taxable (the DB enforces this).
 *
 *  - Sale: pick a salable item; unit rate = its sale price; taxable.
 *  - Labor / Lump Sum: pick a CATALOG ITEM of that category. The description comes
 *    from the item and the rate comes from the PRICE LIST at invoice time — so these
 *    lines store no rate (NULL = priced from the price list). Typing a rate on the
 *    ticket would duplicate the price list and could contradict it.
 *  - Misc: genuinely ad-hoc, so still entered by hand (description + rate).
 *
 * Money is integer cents; amount = round(qty x units x unitRate).
 */

const KINDS = ['sale', 'labor', 'lump_sum', 'misc'] as const
type Kind = (typeof KINDS)[number]

/** Kinds whose description + rate come from the catalog item and its price list. */
const ITEM_PRICED: Partial<Record<Kind, BillingItemCategory>> = {
  labor: 'Labor',
  lump_sum: 'Lump Sum',
}

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
type SB = ReturnType<typeof createServiceClient>

async function loadTicket(supabase: SB, id: string) {
  const { data, error } = await supabase
    .from('billing_tickets')
    .select('id, status, is_voided, billing_jobs(branch_id, profile_id)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as { id: string; status: string; is_voided: boolean; billing_jobs: { branch_id: string; profile_id: string } | null } | null
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }
    if (ticket.is_voided) {
      return bad('This ticket is voided. Restore it before changing charges.', 'CONFLICT', 409)
    }
    if (ticket.status === 'final_edit' || ticket.status === 'invoiced') {
      return bad('This ticket is locked. Reopen it to change charges.', 'CONFLICT', 409)
    }

    const body = (await request.json()) as {
      kind?: string
      itemId?: string | null
      variationId?: string | null
      description?: string
      qty?: number
      unitRateCents?: number
      units?: number
    }

    const kind = body.kind as Kind | undefined
    if (!kind || !KINDS.includes(kind)) return bad(`Kind must be one of: ${KINDS.join(', ')}`)

    const qty = body.qty ?? 1
    if (!(qty > 0)) return bad('Quantity must be greater than zero')
    const units = body.units ?? 1
    if (!Number.isInteger(units) || units < 0) return bad('Units must be a whole number, zero or greater')

    let description = body.description?.trim() ?? ''
    // NULL rate/amount = priced from the price list at invoice time.
    let unitRateCents: number | null = null
    let taxable = false
    let itemId: string | null = body.itemId ?? null
    const itemCategory = ITEM_PRICED[kind]
    // Set for a profile-scoped custom item (Labor / Lump Sum), which carries its own price.
    let scoped: { ownerProfileId: string | null; ownRateCents: number | null } | null = null

    if (kind === 'sale') {
      if (!itemId) return bad('A sale line needs an item')
      const { data: item, error: iErr } = await supabase
        .from('billing_items')
        .select('id, name, code, salable, sale_price_cents')
        .eq('id', itemId)
        .maybeSingle()
      if (iErr) throw new Error(iErr.message)
      if (!item) return bad('Item not found', 'NOT_FOUND', 404)
      if (!item.salable || item.sale_price_cents == null) return bad('That item is not salable')
      unitRateCents = item.sale_price_cents
      taxable = true // only sales are taxable
      if (!description) description = `${item.name} (sold)`
    } else if (itemCategory) {
      // Labor / Lump Sum: the item carries the description. A GLOBAL item is priced by the
      // price list at invoice time (rate stays NULL). A PROFILE-SCOPED custom item carries
      // its own negotiated price, captured below.
      if (!itemId) return bad(`A ${itemCategory.toLowerCase()} item is required`)
      const { data: item, error: iErr } = await supabase
        .from('billing_items')
        .select('id, name, category, is_active, owner_profile_id, own_rate_cents')
        .eq('id', itemId)
        .maybeSingle()
      if (iErr) throw new Error(iErr.message)
      if (!item) return bad('Item not found', 'NOT_FOUND', 404)
      if (item.category !== itemCategory) return bad(`That item is not a ${itemCategory} item.`)
      if (!item.is_active) return bad('That item is inactive.')
      description = item.name
      unitRateCents = null // global → priced from the list; scoped → set after variation check
      scoped = { ownerProfileId: item.owner_profile_id as string | null, ownRateCents: item.own_rate_cents as number | null }
    } else {
      // misc: genuinely ad-hoc, so it's the one kind still entered by hand.
      if (!description) return bad('A description is required')
      if (!Number.isInteger(body.unitRateCents) || (body.unitRateCents as number) < 0) {
        return bad('Rate must be a whole number of cents, zero or greater')
      }
      unitRateCents = body.unitRateCents as number
      itemId = null
    }

    // Variation handling for item-based kinds. When an item has variations the priced unit
    // IS the variation (see lib/billing/pricing/rates.ts), so labor / lump sum REQUIRE one —
    // otherwise the rate can't be resolved and the line silently won't bill. Sale prices off
    // the item's own sale_price, so there the variation is just a label and stays optional.
    let variationId: string | null = null
    let pickedVarOwnRate: number | null = null
    if (itemId && kind !== 'misc') {
      const { data: vars, error: vErr } = await supabase
        .from('billing_item_variations').select('id, own_rate_cents').eq('item_id', itemId)
      if (vErr) throw new Error(vErr.message)
      const ownRateById = new Map((vars ?? []).map((v) => [v.id, v.own_rate_cents as number | null]))
      if (body.variationId) {
        if (!ownRateById.has(body.variationId)) return bad('That variation does not belong to the selected item.')
        variationId = body.variationId
        pickedVarOwnRate = ownRateById.get(body.variationId) ?? null
      } else if (itemCategory && ownRateById.size > 0) {
        return bad('This item has variations — choose one.')
      }
    }

    // A profile-scoped custom item carries its OWN negotiated price (per variation, design
    // "B", or a single rate when it has no variations). Capture it on the line now — and
    // never let one profile's item be charged to another profile's ticket.
    if (itemCategory && scoped?.ownerProfileId) {
      if (scoped.ownerProfileId !== ticket.billing_jobs?.profile_id) {
        return bad('That custom item belongs to a different billing profile.', 'FORBIDDEN', 403)
      }
      const rate = variationId ? pickedVarOwnRate : scoped.ownRateCents
      if (rate == null) return bad('This custom item has no price set — set its price on the profile first.')
      unitRateCents = rate
    }

    const amountCents = unitRateCents === null ? null : Math.round(qty * units * unitRateCents)

    const { error } = await supabase.from('billing_ticket_lines').insert({
      ticket_id: params.id,
      kind,
      item_id: itemId,
      variation_id: variationId,
      description,
      qty,
      units,
      unit_rate_cents: unitRateCents,
      amount_cents: amountCents,
      taxable,
    })
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
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

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }
    if (ticket.is_voided) {
      return bad('This ticket is voided. Restore it before changing charges.', 'CONFLICT', 409)
    }
    if (ticket.status === 'final_edit' || ticket.status === 'invoiced') {
      return bad('This ticket is locked. Reopen it to change charges.', 'CONFLICT', 409)
    }

    const body = (await request.json()) as {
      lineId?: string
      description?: string
      qty?: number
      unitRateCents?: number
      units?: number
    }
    if (!body.lineId) return bad('lineId is required')

    const { data: line, error: lErr } = await supabase
      .from('billing_ticket_lines')
      .select('id, kind, qty, units, unit_rate_cents')
      .eq('id', body.lineId)
      .eq('ticket_id', params.id)
      .maybeSingle()
    if (lErr) throw new Error(lErr.message)
    const cur = line as { id: string; kind: string; qty: number; units: number; unit_rate_cents: number | null } | null
    if (!cur) return bad('Charge not found', 'NOT_FOUND', 404)

    const qty = body.qty ?? Number(cur.qty)
    if (!(qty > 0)) return bad('Quantity must be greater than zero')
    const units = body.units ?? cur.units
    if (!Number.isInteger(units) || units < 0) return bad('Units must be a whole number, zero or greater')

    // Item-priced kinds (labor / lump sum) own neither their description nor their rate —
    // both come from the catalog item and its price list. Only the quantity is editable.
    const isItemPriced = ITEM_PRICED[cur.kind as Kind] !== undefined
    const canEditRate = !isItemPriced && cur.kind !== 'sale'

    let unitRateCents = cur.unit_rate_cents
    if (canEditRate && body.unitRateCents !== undefined) {
      if (!Number.isInteger(body.unitRateCents) || body.unitRateCents < 0) return bad('Rate must be a whole number of cents')
      unitRateCents = body.unitRateCents
    }

    const patch: LineUpdate = {
      qty,
      units,
      unit_rate_cents: unitRateCents,
      // Stays NULL for item-priced lines — the amount is computed at invoice.
      amount_cents: unitRateCents === null ? null : Math.round(qty * units * unitRateCents),
    }
    if (body.description !== undefined && canEditRate) {
      const d = body.description.trim()
      if (!d) return bad('A description is required')
      patch.description = d
    }

    const { error } = await supabase.from('billing_ticket_lines').update(patch).eq('id', body.lineId).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const url = new URL(request.url)
    const lineId = url.searchParams.get('lineId')
    if (!lineId) return bad('lineId is required')

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }
    if (ticket.is_voided) {
      return bad('This ticket is voided. Restore it before changing charges.', 'CONFLICT', 409)
    }
    if (ticket.status === 'final_edit' || ticket.status === 'invoiced') {
      return bad('This ticket is locked.', 'CONFLICT', 409)
    }

    const { error } = await supabase.from('billing_ticket_lines').delete().eq('id', lineId).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
