import { NextResponse } from 'next/server'
import { getTechContext } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { timeToMinutes, segmentMinutes, minutesToHours } from '@/lib/billing/labor'

/**
 * The tech's ticket list — screen 1, and the whole top level of the app.
 *
 * Rule: **assigned to me AND active.** Nothing else, ever. A submitted ticket
 * (in_review) simply stops matching and disappears; if the office reopens it back to
 * active it reappears. One condition drives the list, visibility and editability, so
 * they can't disagree.
 *
 * Money-blind: no rate, price or total appears here.
 */

interface AssignmentRow {
  is_lead: boolean
  billing_tickets: {
    id: string
    ticket_number: string
    ticket_date: string
    status: string
    feature_add: boolean
    feature_return: boolean
    feature_dtc: boolean
    billing_jobs: {
      job_number: string
      name: string | null
      address: string | null
      city: string | null
      billing_profiles: { billing_customers: { name: string } | null } | null
    } | null
  } | null
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()

    // Start from MY assignments — a positive check, not a filter over all tickets.
    const { data, error } = await supabase
      .from('billing_ticket_assignments')
      .select(`
        is_lead,
        billing_tickets!inner(
          id, ticket_number, ticket_date, status, feature_add, feature_return, feature_dtc,
          billing_jobs(job_number, name, address, city, billing_profiles(billing_customers(name)))
        )
      `)
      .eq('technician_id', ctx.tech.technicianId)
      .eq('billing_tickets.status', 'active')
      .eq('billing_tickets.is_voided', false) // voided tickets aren't work — hide from techs
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as AssignmentRow[]

    const ticketIds = rows.map((r) => r.billing_tickets?.id).filter((id): id is string => !!id)

    // My own logged hours per ticket — the one number a tech cares about on this screen.
    const myHours = new Map<string, number>()
    if (ticketIds.length > 0) {
      const { data: labor } = await supabase
        .from('billing_ticket_labor')
        .select('ticket_id, start_time, end_time')
        .eq('technician_id', ctx.tech.technicianId)
        .in('ticket_id', ticketIds)
      for (const l of (labor ?? []) as { ticket_id: string; start_time: string; end_time: string }[]) {
        const mins = segmentMinutes(timeToMinutes(l.start_time), timeToMinutes(l.end_time))
        myHours.set(l.ticket_id, (myHours.get(l.ticket_id) ?? 0) + mins)
      }
    }

    const tickets = rows
      .filter((r) => r.billing_tickets)
      .map((r) => {
        const t = r.billing_tickets!
        const j = t.billing_jobs
        return {
          id: t.id,
          ticketNumber: t.ticket_number,
          date: t.ticket_date,
          isLead: r.is_lead,
          features: { add: t.feature_add, return: t.feature_return, dtc: t.feature_dtc },
          job: j ? { number: j.job_number, name: j.name } : null,
          customer: j?.billing_profiles?.billing_customers?.name ?? null,
          site: [j?.address, j?.city].filter(Boolean).join(', ') || null,
          myHours: minutesToHours(myHours.get(t.id) ?? 0),
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.ticketNumber.localeCompare(b.ticketNumber))

    return NextResponse.json({ success: true, data: tickets })
  } catch (err) {
    return billingApiError(err)
  }
}
