import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { nextNumber } from '@/lib/billing/rpc'

/**
 * Jobs. A job attaches to a BILLING PROFILE (customer + branch derived) and
 * carries an ENTITY (INC / STS / TCS). Its job number is generated per entity.
 *
 * The chosen entity must be one the profile has ENABLED — otherwise there is no
 * price list to bill the job's tickets against.
 *
 * "Certified?" must be answered at creation. If yes, DIR #, contract # and pay
 * classification are required (the DB enforces this too).
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface JobListRow {
  id: string
  job_number: string
  name: string | null
  status: string
  certified: boolean
  entity_id: string
  branch_id: string
  date_opened: string
  billing_profiles: { id: string; name: string; code: string; billing_customers: { name: string } | null } | null
  entities: { code: string } | null
  branches: { name: string } | null
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const url = new URL(request.url)
    const profileId = url.searchParams.get('profileId')

    const supabase = createServiceClient()
    let query = supabase
      .from('billing_jobs')
      .select(`
        id, job_number, name, status, certified, entity_id, branch_id, date_opened,
        billing_profiles(id, name, code, billing_customers(name)),
        entities(code),
        branches(name)
      `)
      .order('date_opened', { ascending: false })

    if (profileId) query = query.eq('profile_id', profileId)
    const reqBranch = url.searchParams.get('branchId') || ''
    let effBranchIds = ctx.access.branchIds
    if (reqBranch) effBranchIds = effBranchIds === null ? [reqBranch] : effBranchIds.filter((b) => b === reqBranch)
    if (effBranchIds !== null) {
      if (effBranchIds.length === 0) return NextResponse.json({ success: true, data: [] })
      query = query.in('branch_id', effBranchIds)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as JobListRow[]

    return NextResponse.json({
      success: true,
      data: rows.map((j) => ({
        id: j.id,
        jobNumber: j.job_number,
        name: j.name,
        status: j.status,
        certified: j.certified,
        entityCode: j.entities?.code ?? '',
        branch: j.branches?.name ?? '',
        dateOpened: j.date_opened,
        profile: j.billing_profiles
          ? { id: j.billing_profiles.id, name: j.billing_profiles.name, code: j.billing_profiles.code }
          : null,
        customer: j.billing_profiles?.billing_customers?.name ?? null,
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
      profileId?: string
      entityId?: string
      name?: string | null
      certified?: boolean
      dirNumber?: string | null
      certPayrollContact?: string | null
      contractNumber?: string | null
      payClassification?: string | null
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
    }

    if (!body.profileId) return bad('Billing profile is required')
    if (!body.entityId) return bad('Entity is required')
    if (body.certified === undefined || body.certified === null) {
      return bad('You must answer whether this is a certified job before creating it')
    }

    // Certified gate — mirror the DB check so the user gets a clean message.
    if (body.certified) {
      if (!body.dirNumber?.trim()) return bad('Certified jobs need a DIR number')
      if (!body.contractNumber?.trim()) return bad('Certified jobs need a contract number')
      if (!body.payClassification?.trim()) return bad('Certified jobs need a pay classification')
    }

    if (body.ticketLaborMinimumMinutes != null) {
      if (!Number.isInteger(body.ticketLaborMinimumMinutes) || body.ticketLaborMinimumMinutes < 0) {
        return bad('Ticket labor minimum must be a whole number of minutes, zero or greater')
      }
    }

    const supabase = createServiceClient()

    // Profile → branch (+ access check). Branch is derived, never chosen.
    const { data: profile, error: pErr } = await supabase
      .from('billing_profiles')
      .select('id, branch_id')
      .eq('id', body.profileId)
      .maybeSingle()
    if (pErr) throw new Error(pErr.message)
    if (!profile) return bad('Billing profile not found', 'NOT_FOUND', 404)

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(profile.branch_id)) {
      return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)
    }

    // The entity must be ENABLED for this profile, or there's no price list to bill against.
    const { data: pe, error: peErr } = await supabase
      .from('billing_profile_entities')
      .select('id, price_list_id')
      .eq('profile_id', body.profileId)
      .eq('entity_id', body.entityId)
      .eq('enabled', true)
      .maybeSingle()
    if (peErr) throw new Error(peErr.message)
    if (!pe) return bad('That entity is not enabled for this billing profile. Configure it on the profile first.', 'CONFLICT', 409)
    if (!pe.price_list_id) return bad('That entity has no price list on this profile yet.', 'CONFLICT', 409)

    // Generate the per-(entity, branch) job number (service-role only RPC). Format:
    // [entity][seq][branch]J e.g. S0000004BKJ. Validation is done above so a burned
    // number on failure is unlikely.
    const jobNumber = await nextNumber(supabase, 'job', body.entityId, profile.branch_id)

    const { data: created, error } = await supabase
      .from('billing_jobs')
      .insert({
        job_number: jobNumber,
        profile_id: body.profileId,
        entity_id: body.entityId,
        branch_id: profile.branch_id,
        name: body.name?.trim() || null,
        certified: body.certified,
        dir_number: body.certified ? body.dirNumber?.trim() ?? null : null,
        cert_payroll_contact: body.certified ? body.certPayrollContact?.trim() || null : null,
        contract_number: body.certified ? body.contractNumber?.trim() ?? null : null,
        pay_classification: body.certified ? body.payClassification?.trim() ?? null : null,
        po_number: body.poNumber?.trim() || null,
        address: body.address?.trim() || null,
        cross_streets: body.crossStreets?.trim() || null,
        city: body.city?.trim() || null,
        county: body.county?.trim() || null,
        state: body.state?.trim() || null,
        zip: body.zip?.trim() || null,
        tax_exempt: body.taxExempt ?? false,
        require_signature: body.requireSignature ?? false,
        enable_second_signature: body.enableSecondSignature ?? false,
        ticket_labor_minimum_minutes: body.ticketLaborMinimumMinutes ?? null,
        notes: body.notes?.trim() || null,
      })
      .select('id, job_number')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create job')

    return NextResponse.json({ success: true, data: { id: created.id, jobNumber: created.job_number } })
  } catch (err) {
    return billingApiError(err)
  }
}
