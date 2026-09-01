import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import type { Database } from '@/lib/supabase/database.types'

/**
 * A single job. GET returns the full record; PATCH edits the safe fields.
 *
 * NOT editable here: the entity. Changing a job's entity regenerates its job
 * number and re-stamps its tickets/invoices, so it needs a dedicated guarded
 * flow (reason + confirm + audit log) — deferred until tickets exist.
 */

type JobUpdate = Database['public']['Tables']['billing_jobs']['Update']
const JOB_STATUSES = ['new', 'in_progress', 'on_hold', 'completed', 'closed'] as const
type JobStatus = (typeof JOB_STATUSES)[number]

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface JobDetailRow {
  id: string
  job_number: string
  name: string | null
  status: JobStatus
  certified: boolean
  dir_number: string | null
  cert_payroll_contact: string | null
  contract_number: string | null
  pay_classification: string | null
  entity_id: string
  branch_id: string
  po_number: string | null
  address: string | null
  cross_streets: string | null
  city: string | null
  county: string | null
  state: string | null
  zip: string | null
  tax_exempt: boolean
  require_signature: boolean
  enable_second_signature: boolean
  ticket_labor_minimum_minutes: number | null
  notes: string | null
  date_opened: string
  date_completed: string | null
  billing_profiles: { id: string; name: string; code: string; billing_customers: { id: string; name: string } | null } | null
  entities: { code: string } | null
  branches: { name: string } | null
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
      .from('billing_jobs')
      .select(`
        id, job_number, name, status, certified, dir_number, cert_payroll_contact,
        contract_number, pay_classification, entity_id, branch_id, po_number,
        address, cross_streets, city, county, state, zip, tax_exempt,
        require_signature, enable_second_signature, ticket_labor_minimum_minutes,
        notes, date_opened, date_completed,
        billing_profiles(id, name, code, billing_customers(id, name)),
        entities(code),
        branches(name)
      `)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(error.message)

    const j = data as unknown as JobDetailRow | null
    if (!j) return bad('Job not found', 'NOT_FOUND', 404)

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(j.branch_id)) {
      return bad('You do not have access to this job’s branch.', 'FORBIDDEN', 403)
    }

    return NextResponse.json({
      success: true,
      data: {
        id: j.id,
        jobNumber: j.job_number,
        name: j.name,
        status: j.status,
        certified: j.certified,
        dirNumber: j.dir_number,
        certPayrollContact: j.cert_payroll_contact,
        contractNumber: j.contract_number,
        payClassification: j.pay_classification,
        entityCode: j.entities?.code ?? '',
        branch: j.branches?.name ?? '',
        poNumber: j.po_number,
        address: j.address,
        crossStreets: j.cross_streets,
        city: j.city,
        county: j.county,
        state: j.state,
        zip: j.zip,
        taxExempt: j.tax_exempt,
        requireSignature: j.require_signature,
        enableSecondSignature: j.enable_second_signature,
        ticketLaborMinimumMinutes: j.ticket_labor_minimum_minutes,
        notes: j.notes,
        dateOpened: j.date_opened,
        dateCompleted: j.date_completed,
        profile: j.billing_profiles
          ? { id: j.billing_profiles.id, name: j.billing_profiles.name, code: j.billing_profiles.code }
          : null,
        customer: j.billing_profiles?.billing_customers?.name ?? null,
        statuses: JOB_STATUSES,
        isAdmin: ctx.access.role === 'admin',
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

    const guard = guardBillingArea(ctx.access.role, 'jobs')
    if (guard) return guard

    const supabase = createServiceClient()
    const { data: existing, error: exErr } = await supabase
      .from('billing_jobs')
      .select('id, branch_id, certified')
      .eq('id', params.id)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (!existing) return bad('Job not found', 'NOT_FOUND', 404)

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(existing.branch_id)) {
      return bad('You do not have access to this job’s branch.', 'FORBIDDEN', 403)
    }

    const body = (await request.json()) as {
      name?: string | null
      status?: string
      poNumber?: string | null
      address?: string | null
      crossStreets?: string | null
      city?: string | null
      county?: string | null
      state?: string | null
      zip?: string | null
      taxExempt?: boolean
      requireSignature?: boolean
      enableSecondSignature?: boolean
      ticketLaborMinimumMinutes?: number | null
      notes?: string | null
      dateCompleted?: string | null
      // certified detail can be corrected, but certified itself is not toggled here
      dirNumber?: string | null
      certPayrollContact?: string | null
      contractNumber?: string | null
      payClassification?: string | null
    }

    const patch: JobUpdate = {}
    if (body.name !== undefined) patch.name = body.name?.trim() || null
    if (body.status !== undefined) {
      if (!JOB_STATUSES.includes(body.status as JobStatus)) return bad('Unknown status')
      patch.status = body.status as JobStatus
    }
    if (body.poNumber !== undefined) patch.po_number = body.poNumber?.trim() || null
    if (body.address !== undefined) patch.address = body.address?.trim() || null
    if (body.crossStreets !== undefined) patch.cross_streets = body.crossStreets?.trim() || null
    if (body.city !== undefined) patch.city = body.city?.trim() || null
    if (body.county !== undefined) patch.county = body.county?.trim() || null
    if (body.state !== undefined) patch.state = body.state?.trim() || null
    if (body.zip !== undefined) patch.zip = body.zip?.trim() || null
    if (body.taxExempt !== undefined) patch.tax_exempt = body.taxExempt
    if (body.requireSignature !== undefined) patch.require_signature = body.requireSignature
    if (body.enableSecondSignature !== undefined) patch.enable_second_signature = body.enableSecondSignature
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null
    if (body.dateCompleted !== undefined) patch.date_completed = body.dateCompleted || null
    if (body.ticketLaborMinimumMinutes !== undefined) {
      const m = body.ticketLaborMinimumMinutes
      if (m != null && (!Number.isInteger(m) || m < 0)) return bad('Ticket labor minimum must be whole minutes, zero or greater')
      patch.ticket_labor_minimum_minutes = m
    }

    // Certified detail fields: only meaningful on a certified job, and the DB
    // check refuses to null a required one out from under a certified job.
    if (existing.certified) {
      if (body.dirNumber !== undefined) {
        if (!body.dirNumber?.trim()) return bad('A certified job must keep its DIR number')
        patch.dir_number = body.dirNumber.trim()
      }
      if (body.contractNumber !== undefined) {
        if (!body.contractNumber?.trim()) return bad('A certified job must keep its contract number')
        patch.contract_number = body.contractNumber.trim()
      }
      if (body.payClassification !== undefined) {
        if (!body.payClassification?.trim()) return bad('A certified job must keep its pay classification')
        patch.pay_classification = body.payClassification.trim()
      }
      if (body.certPayrollContact !== undefined) patch.cert_payroll_contact = body.certPayrollContact?.trim() || null
    }

    if (Object.keys(patch).length === 0) return bad('Nothing to update')

    const { error } = await supabase.from('billing_jobs').update(patch).eq('id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
