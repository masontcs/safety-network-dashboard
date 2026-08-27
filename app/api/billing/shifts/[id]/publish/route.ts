import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { nextNumber } from '@/lib/billing/rpc'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'

/**
 * Publish a staged shift. This is what turns a draft into live work:
 *  - Job shift  → generate a DTC ticket for the job on the shift date, copy the crew onto it
 *                 (lead preserved), link the ticket back to the shift.
 *  - Yard shift → create a yard shift per crew tech for the date (no ticket).
 * Either way, if per-diem was pre-approved, seed a per-diem record per crew tech, and notify
 * (broadcast) so the board + tech app update live. Techs then acknowledge the shift.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function POST(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const { data: sh } = await supabase
      .from('billing_shifts')
      .select('id, job_id, branch_id, shift_date, status, per_diem_preapproved')
      .eq('id', params.id)
      .maybeSingle()
    const shift = sh as { id: string; job_id: string | null; branch_id: string; shift_date: string; status: string; per_diem_preapproved: boolean } | null
    if (!shift) return bad('Shift not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(shift.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)
    if (shift.status !== 'staged') return bad('This shift is already published.', 'CONFLICT', 409)

    const { data: crewRaw } = await supabase.from('billing_shift_crew').select('technician_id, is_lead').eq('shift_id', shift.id)
    const crew = (crewRaw ?? []) as { technician_id: string; is_lead: boolean }[]
    if (crew.length === 0) return bad('Add at least one technician before publishing.')

    let ticketId: string | null = null
    let ticketNumber: string | null = null

    if (shift.job_id) {
      const { data: job } = await supabase.from('billing_jobs').select('id, entity_id, branch_id').eq('id', shift.job_id).maybeSingle()
      if (!job) return bad('Job not found', 'NOT_FOUND', 404)

      const num = await nextNumber(supabase, 'ticket', job.entity_id, job.branch_id)
      const { data: created, error: cErr } = await supabase
        .from('billing_tickets')
        .insert({
          ticket_number: num,
          job_id: job.id,
          entity_id: job.entity_id,
          ticket_date: shift.shift_date,
          feature_add: false,
          feature_return: false,
          feature_dtc: true, // dispatched work defaults to a day-charge ticket
        })
        .select('id, ticket_number')
        .single()
      if (cErr || !created) throw new Error(cErr?.message ?? 'Failed to generate ticket')
      ticketId = created.id
      ticketNumber = created.ticket_number

      const { error: aErr } = await supabase.from('billing_ticket_assignments').insert(
        crew.map((c) => ({ ticket_id: created.id, technician_id: c.technician_id, is_lead: c.is_lead })),
      )
      if (aErr) throw new Error(aErr.message)
    } else {
      // Yard: one yard shift per tech for the day (idempotent).
      const { error: yErr } = await supabase.from('billing_yard_shifts').upsert(
        crew.map((c) => ({ technician_id: c.technician_id, shift_date: shift.shift_date, branch_id: shift.branch_id })),
        { onConflict: 'technician_id,shift_date' },
      )
      if (yErr) throw new Error(yErr.message)
    }

    // Pre-approved per diem: seed a pending record per crew tech for the day.
    if (shift.per_diem_preapproved) {
      const { error: pErr } = await supabase.from('billing_per_diem').upsert(
        crew.map((c) => ({
          technician_id: c.technician_id, work_date: shift.shift_date, branch_id: shift.branch_id,
          status: 'pending' as const, pre_approved_by: ctx.access.userId ?? null,
        })),
        { onConflict: 'technician_id,work_date' },
      )
      if (pErr) throw new Error(pErr.message)
    }

    const { error: uErr } = await supabase
      .from('billing_shifts')
      .update({ status: 'published', ticket_id: ticketId, published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', shift.id)
    if (uErr) throw new Error(uErr.message)

    await broadcastBillingChanged()
    return NextResponse.json({ success: true, data: { ticketId, ticketNumber } })
  } catch (err) {
    return billingApiError(err)
  }
}
