import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { nextNumber } from '@/lib/billing/rpc'

/**
 * Tickets. Feature-based, not type-based: each ticket toggles
 * Add / Return / DTC. "Both" is Add + Return on one ticket. DTC is exclusive
 * (a one-day charge that does NOT start an ongoing rental) — the DB enforces
 * this too.
 *
 * A ticket belongs to a job and inherits the job's entity; its number is
 * generated per entity. The billing type (rate cadence) is chosen before final
 * edit.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface TicketListRow {
  id: string
  ticket_number: string
  ticket_date: string
  status: string
  feature_add: boolean
  feature_return: boolean
  feature_dtc: boolean
  recurring: boolean
  billing_jobs: { id: string; job_number: string; name: string | null; branch_id: string; billing_profiles: { billing_customers: { name: string } | null } | null } | null
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const url = new URL(request.url)
    const jobId = url.searchParams.get('jobId')

    const supabase = createServiceClient()
    let query = supabase
      .from('billing_tickets')
      .select(`
        id, ticket_number, ticket_date, status, feature_add, feature_return, feature_dtc, recurring,
        billing_jobs(id, job_number, name, branch_id, billing_profiles(billing_customers(name)))
      `)
      .order('ticket_date', { ascending: false })

    if (jobId) query = query.eq('job_id', jobId)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    let rows = (data ?? []) as unknown as TicketListRow[]

    // Branch scoping happens on the job's branch (tickets have no branch of their own).
    const reqBranch = url.searchParams.get('branchId') || ''
    let effBranchIds = ctx.access.branchIds
    if (reqBranch) effBranchIds = effBranchIds === null ? [reqBranch] : effBranchIds.filter((b) => b === reqBranch)
    if (effBranchIds !== null) {
      const allowed = new Set(effBranchIds)
      rows = rows.filter((t) => t.billing_jobs && allowed.has(t.billing_jobs.branch_id))
    }

    return NextResponse.json({
      success: true,
      data: rows.map((t) => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        date: t.ticket_date,
        status: t.status,
        recurring: t.recurring,
        features: [t.feature_add && 'Add', t.feature_return && 'Return', t.feature_dtc && 'DTC'].filter(Boolean) as string[],
        job: t.billing_jobs ? { id: t.billing_jobs.id, number: t.billing_jobs.job_number, name: t.billing_jobs.name } : null,
        customer: t.billing_jobs?.billing_profiles?.billing_customers?.name ?? null,
      })),
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
      jobId?: string
      ticketDate?: string
      featureAdd?: boolean
      featureReturn?: boolean
      featureDtc?: boolean
      notes?: string | null
    }

    if (!body.jobId) return bad('Job is required')
    if (!body.ticketDate) return bad('Ticket date is required')

    const add = !!body.featureAdd
    const ret = !!body.featureReturn
    const dtc = !!body.featureDtc
    if (dtc && (add || ret)) return bad('DTC is a one-day charge and cannot be combined with Add or Return')
    if (!add && !ret && !dtc) return bad('Pick at least one feature: Add, Return, or DTC')

    const supabase = createServiceClient()

    const { data: job, error: jErr } = await supabase
      .from('billing_jobs')
      .select('id, entity_id, branch_id')
      .eq('id', body.jobId)
      .maybeSingle()
    if (jErr) throw new Error(jErr.message)
    if (!job) return bad('Job not found', 'NOT_FOUND', 404)

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(job.branch_id)) {
      return bad('You do not have access to this job’s branch.', 'FORBIDDEN', 403)
    }

    // [entity][seq][branch]T e.g. S0000005BKT — per-(entity, branch), inherits the job's branch.
    const ticketNumber = await nextNumber(supabase, 'ticket', job.entity_id, job.branch_id)

    const { data: created, error } = await supabase
      .from('billing_tickets')
      .insert({
        ticket_number: ticketNumber,
        job_id: body.jobId,
        entity_id: job.entity_id,
        ticket_date: body.ticketDate,
        feature_add: add,
        feature_return: ret,
        feature_dtc: dtc,
        notes: body.notes?.trim() || null,
      })
      .select('id, ticket_number')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create ticket')

    return NextResponse.json({ success: true, data: { id: created.id, ticketNumber: created.ticket_number } })
  } catch (err) {
    return billingApiError(err)
  }
}
