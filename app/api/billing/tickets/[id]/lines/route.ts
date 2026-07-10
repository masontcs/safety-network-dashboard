import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import type { Database } from '@/lib/supabase/database.types'

type LineUpdate = Database['public']['Tables']['billing_ticket_lines']['Update']

/**
 * Non-rental ticket charge lines: Sale, Labor, Lump Sum, Misc.
 *
 * Rentals and lost/stolen are NOT lines — they derive from the quantity ledger
 * at invoice time. Only SALES are taxable (the DB enforces this).
 *
 *  - Sale: pick a salable item; unit rate = its sale price; taxable.
 *  - Labor / Lump Sum / Misc: entered manually (description + qty + rate).
 *
 * Money is integer cents; amount = round(qty x units x unitRate).
 */

const KINDS = ['sale', 'labor', 'lump_sum', 'misc'] as const
type Kind = (typeof KINDS)[number]

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
type SB = ReturnType<typeof createServiceClient>

async function loadTicket(supabase: SB, id: string) {
  const { data, error } = await supabase
    .from('billing_tickets')
    .select('id, status, billing_jobs(branch_id)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as { id: string; status: string; billing_jobs: { branch_id: string } | null } | null
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
    let unitRateCents: number
    let taxable = false
    let itemId: string | null = body.itemId ?? null

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
    } else {
      // labor / lump_sum / misc: manual rate
      if (!description) return bad('A description is required')
      if (!Number.isInteger(body.unitRateCents) || (body.unitRateCents as number) < 0) {
        return bad('Rate must be a whole number of cents, zero or greater')
      }
      unitRateCents = body.unitRateCents as number
      itemId = null
    }

    const amountCents = Math.round(qty * units * unitRateCents)

    const { error } = await supabase.from('billing_ticket_lines').insert({
      ticket_id: params.id,
      kind,
      item_id: itemId,
      variation_id: kind === 'sale' ? body.variationId ?? null : null,
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
    const cur = line as { id: string; kind: string; qty: number; units: number; unit_rate_cents: number } | null
    if (!cur) return bad('Charge not found', 'NOT_FOUND', 404)

    const qty = body.qty ?? Number(cur.qty)
    if (!(qty > 0)) return bad('Quantity must be greater than zero')
    const units = body.units ?? cur.units
    if (!Number.isInteger(units) || units < 0) return bad('Units must be a whole number, zero or greater')

    // Sale lines keep their item's rate (edit qty only); others allow a manual rate.
    let unitRateCents = cur.unit_rate_cents
    if (cur.kind !== 'sale' && body.unitRateCents !== undefined) {
      if (!Number.isInteger(body.unitRateCents) || body.unitRateCents < 0) return bad('Rate must be a whole number of cents')
      unitRateCents = body.unitRateCents
    }

    const patch: LineUpdate = {
      qty,
      units,
      unit_rate_cents: unitRateCents,
      amount_cents: Math.round(qty * units * unitRateCents),
    }
    if (body.description !== undefined && cur.kind !== 'sale') {
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
