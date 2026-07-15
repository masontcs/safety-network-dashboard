import { NextResponse } from 'next/server'
import { getTechContext, loadAssignedTicket, techBad, isEditable } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { timeToMinutes, segmentMinutes, minutesToHours } from '@/lib/billing/labor'
import { fetchJobLedger, balanceFrom, onRentKey } from '@/lib/billing/onRent'

/**
 * One ticket, as a tech sees it — screen 2, and the last screen in the app.
 *
 * - Ticket info is READ-ONLY. They see what the work is; they can't change it.
 * - A CREW tech sees only their own labor. The LEAD sees the whole crew's, because they
 *   can't be accountable for time they can't see.
 * - `onRent` is the job's live on-rent balance, used as the Return checklist — you can
 *   only hand back what's actually out.
 *
 * Money-blind: no rate, price, cost or total appears in this payload.
 */

interface LaborRow {
  id: string
  technician_id: string
  start_time: string
  end_time: string
  entered_by: string | null
  billing_technicians: { name: string } | null
  billing_activity_types: { name: string } | null
}
interface LedgerRow {
  id: string
  event_type: string
  event_date: string
  qty: number
  equipment_id: string | null
  billing_items: { name: string; code: string; tracked: boolean } | null
  billing_item_variations: { name: string } | null
}
interface JobRow {
  job_number: string
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  cross_streets: string | null
  billing_profiles: { billing_customers: { name: string } | null } | null
}
interface ItemRow { id: string; name: string; code: string }
interface VarRow { id: string; name: string }

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const ticket = await loadAssignedTicket(supabase, params.id, ctx.tech.technicianId)
    // Not assigned to me → as far as this API is concerned it doesn't exist.
    if (!ticket) return techBad('Ticket not found', 'NOT_FOUND', 404)
    // Submitted/locked tickets aren't the tech's any more — same rule as the list.
    if (!isEditable(ticket.status)) return techBad('Ticket not found', 'NOT_FOUND', 404)

    const { data: jobRaw } = await supabase
      .from('billing_jobs')
      .select('job_number, name, address, city, state, cross_streets, billing_profiles(billing_customers(name))')
      .eq('id', ticket.job_id)
      .maybeSingle()
    const job = jobRaw as unknown as JobRow | null

    // Labor: mine only, unless I'm the lead — then the whole crew's.
    let laborQ = supabase
      .from('billing_ticket_labor')
      .select('id, technician_id, start_time, end_time, entered_by, billing_technicians(name), billing_activity_types(name)')
      .eq('ticket_id', params.id)
      .order('start_time')
    if (!ticket.isLead) laborQ = laborQ.eq('technician_id', ctx.tech.technicianId)
    const { data: laborRaw, error: lErr } = await laborQ
    if (lErr) throw new Error(lErr.message)
    const laborRows = (laborRaw ?? []) as unknown as LaborRow[]

    const labor = laborRows.map((l) => {
      const mins = segmentMinutes(timeToMinutes(l.start_time), timeToMinutes(l.end_time))
      return {
        id: l.id,
        technicianId: l.technician_id,
        technicianName: l.billing_technicians?.name ?? '—',
        mine: l.technician_id === ctx.tech.technicianId,
        activity: l.billing_activity_types?.name ?? '—',
        startTime: l.start_time.slice(0, 5),
        endTime: l.end_time.slice(0, 5),
        crossesMidnight: timeToMinutes(l.end_time) < timeToMinutes(l.start_time),
        hours: minutesToHours(mins),
        enteredOnMyBehalf: l.entered_by !== null && l.technician_id === ctx.tech.technicianId,
      }
    })

    // Equipment recorded on THIS ticket.
    const { data: eqRaw, error: eErr } = await supabase
      .from('billing_ticket_ledger')
      .select('id, event_type, event_date, qty, equipment_id, billing_items(name, code, tracked), billing_item_variations(name)')
      .eq('ticket_id', params.id)
      .order('event_date')
    if (eErr) throw new Error(eErr.message)
    const equipment = ((eqRaw ?? []) as unknown as LedgerRow[]).map((e) => ({
      id: e.id,
      // On a DTC the row is stored as a pickup but means "billed for the day" — don't
      // show the tech an event type that would only confuse them.
      eventType: ticket.feature_dtc ? null : e.event_type,
      date: e.event_date,
      qty: e.qty,
      equipmentId: e.equipment_id,
      itemName: e.billing_items?.name ?? '—',
      itemCode: e.billing_items?.code ?? '',
      variation: e.billing_item_variations?.name ?? null,
    }))

    // The Return checklist: what's actually on rent for this JOB right now.
    const onRent: { itemId: string; variationId: string | null; itemName: string; itemCode: string; variation: string | null; qty: number }[] = []
    if (ticket.feature_return) {
      const bal = balanceFrom(await fetchJobLedger(supabase, ticket.job_id))
      const live = [...bal.entries()].filter(([, qty]) => qty > 0)
      if (live.length > 0) {
        const itemIds = [...new Set(live.map(([k]) => k.split('|')[0]))]
        const varIds = [...new Set(live.map(([k]) => k.split('|')[1]).filter(Boolean))]
        const { data: items } = await supabase.from('billing_items').select('id, name, code').in('id', itemIds)
        const { data: vars } = varIds.length
          ? await supabase.from('billing_item_variations').select('id, name').in('id', varIds)
          : { data: [] as VarRow[] }
        const itemById = new Map(((items ?? []) as ItemRow[]).map((i) => [i.id, i]))
        const varById = new Map(((vars ?? []) as VarRow[]).map((v) => [v.id, v]))
        for (const [key, qty] of live) {
          const [itemId, variationId] = key.split('|')
          const item = itemById.get(itemId)
          onRent.push({
            itemId,
            variationId: variationId || null,
            itemName: item?.name ?? '—',
            itemCode: item?.code ?? '',
            variation: variationId ? varById.get(variationId)?.name ?? null : null,
            qty,
          })
        }
        onRent.sort((a, b) => a.itemName.localeCompare(b.itemName))
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        date: ticket.ticket_date,
        isLead: ticket.isLead,
        // Read-only context so they know what the work is.
        features: { add: ticket.feature_add, return: ticket.feature_return, dtc: ticket.feature_dtc },
        job: job ? { number: job.job_number, name: job.name } : null,
        customer: job?.billing_profiles?.billing_customers?.name ?? null,
        site: [job?.address, job?.cross_streets, job?.city, job?.state].filter(Boolean).join(', ') || null,
        labor,
        myHours: minutesToHours(labor.filter((l) => l.mine).reduce((s, l) => s + l.hours * 60, 0)),
        equipment,
        onRent,
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}
