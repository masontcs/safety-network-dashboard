import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'
import { existingJobTypeNames } from '@/lib/billing/jobTypes'
import { writeShiftChildren } from '@/lib/billing/shifts'

/**
 * Shifts — the dispatch unit. A shift is STAGED (a draft: no ticket, no tech notification)
 * until it is published (see [id]/publish). A shift references a job (job_id) or is a YARD
 * shift (job_id null). Its branch comes from the job, or from the request for yard.
 *
 * GET  ?week=YYYY-MM-DD&branchId=&status=  — list shifts in the week (defaults to staged+published)
 * POST                                     — create a staged shift with crew / job types / timeline
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

function mondayOf(d: string): string {
  const dt = new Date(d + 'T00:00:00Z')
  const dow = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - dow)
  return dt.toISOString().slice(0, 10)
}
const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }

interface ShiftRow {
  id: string; job_id: string | null; branch_id: string; shift_date: string; status: string
  meal_type: string; per_diem_preapproved: boolean; ticket_id: string | null; notes: string | null
  billing_jobs: { job_number: string; name: string | null; branch_id: string; billing_profiles: { billing_customers: { name: string } | null } | null } | null
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const url = new URL(request.url)
    const weekStart = mondayOf(url.searchParams.get('week') || new Date().toISOString().slice(0, 10))
    const weekEnd = addDays(weekStart, 4)
    const statusFilter = url.searchParams.get('status') // 'staged' | 'published' | null(all)

    let q = supabase
      .from('billing_shifts')
      .select('id, job_id, branch_id, shift_date, status, meal_type, per_diem_preapproved, ticket_id, notes, billing_jobs(job_number, name, branch_id, billing_profiles(billing_customers(name)))')
      .gte('shift_date', weekStart).lte('shift_date', weekEnd)
      .order('shift_date')
    if (statusFilter === 'staged' || statusFilter === 'published') q = q.eq('status', statusFilter)

    const { data: raw } = await q
    let shifts = (raw ?? []) as unknown as ShiftRow[]

    // Branch scoping (shift.branch_id, mirrors job scoping elsewhere).
    const reqBranch = url.searchParams.get('branchId') || ''
    let effBranchIds = ctx.access.branchIds
    if (reqBranch) effBranchIds = effBranchIds === null ? [reqBranch] : effBranchIds.filter((b) => b === reqBranch)
    if (effBranchIds !== null) { const allow = new Set(effBranchIds); shifts = shifts.filter((s) => allow.has(s.branch_id)) }

    // Crew + job types per shift.
    const crewByShift = new Map<string, { technicianId: string; isLead: boolean; acknowledgedAt: string | null }[]>()
    const typesByShift = new Map<string, string[]>()
    if (shifts.length) {
      const ids = shifts.map((s) => s.id)
      const { data: crew } = await supabase.from('billing_shift_crew').select('shift_id, technician_id, is_lead, acknowledged_at').in('shift_id', ids)
      for (const c of (crew ?? []) as { shift_id: string; technician_id: string; is_lead: boolean; acknowledged_at: string | null }[]) {
        crewByShift.set(c.shift_id, [...(crewByShift.get(c.shift_id) ?? []), { technicianId: c.technician_id, isLead: c.is_lead, acknowledgedAt: c.acknowledged_at }])
      }
      const { data: types } = await supabase.from('billing_shift_job_types').select('shift_id, job_type').in('shift_id', ids)
      for (const t of (types ?? []) as { shift_id: string; job_type: string }[]) {
        typesByShift.set(t.shift_id, [...(typesByShift.get(t.shift_id) ?? []), t.job_type])
      }
    }

    return NextResponse.json({
      success: true,
      data: shifts.map((s) => {
        const crew = crewByShift.get(s.id) ?? []
        return {
          id: s.id,
          jobId: s.job_id,
          isYard: s.job_id === null,
          branchId: s.branch_id,
          date: s.shift_date,
          status: s.status,
          mealType: s.meal_type,
          perDiemPreapproved: s.per_diem_preapproved,
          ticketId: s.ticket_id,
          notes: s.notes,
          jobNumber: s.billing_jobs?.job_number ?? null,
          jobName: s.billing_jobs?.name ?? null,
          customer: s.billing_jobs?.billing_profiles?.billing_customers?.name ?? null,
          jobTypes: typesByShift.get(s.id) ?? [],
          crew,
          crewTechIds: crew.map((c) => c.technicianId),
          leadTechId: crew.find((c) => c.isLead)?.technicianId ?? null,
          acknowledgedCount: crew.filter((c) => c.acknowledgedAt).length,
        }
      }),
    })
  } catch (err) {
    return billingApiError(err)
  }
}

interface CreateBody {
  jobId?: string | null
  branchId?: string | null
  shiftDate?: string
  mealType?: string
  perDiemPreapproved?: boolean
  notes?: string | null
  jobTypes?: string[]
  timeline?: { atTime: string; activityTypeId: string }[]
  crew?: { technicianId: string; isLead?: boolean }[]
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'dispatch')
    if (guard) return guard

    const body = (await request.json()) as CreateBody
    if (!body.shiftDate) return bad('A shift date is required')
    if (body.mealType && body.mealType !== 'standard' && body.mealType !== 'odmp') return bad('Invalid meal type')

    const supabase = createServiceClient()
    const validTypes = await existingJobTypeNames(supabase)
    const jobTypes = [...new Set((body.jobTypes ?? []).filter((t) => validTypes.has(t)))]

    // Resolve branch: from the job for a job shift, else from the request for yard.
    let branchId: string | null
    if (body.jobId) {
      const { data: job } = await supabase.from('billing_jobs').select('id, branch_id').eq('id', body.jobId).maybeSingle()
      if (!job) return bad('Job not found', 'NOT_FOUND', 404)
      branchId = job.branch_id
    } else {
      branchId = body.branchId || null
    }
    if (branchId && ctx.access.branchIds !== null && !ctx.access.branchIds.includes(branchId)) {
      return bad('You do not have access to this branch.', 'FORBIDDEN', 403)
    }
    if (!branchId) return bad('A branch is required for a yard shift')

    const { data: created, error } = await supabase
      .from('billing_shifts')
      .insert({
        job_id: body.jobId || null,
        branch_id: branchId,
        shift_date: body.shiftDate,
        status: 'staged',
        meal_type: (body.mealType as 'standard' | 'odmp') || 'standard',
        per_diem_preapproved: !!body.perDiemPreapproved,
        notes: body.notes?.trim() || null,
        created_by: ctx.access.userId ?? null,
      })
      .select('id')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create shift')

    await writeShiftChildren(supabase, created.id, jobTypes, body.timeline, body.crew)

    await broadcastBillingChanged()
    return NextResponse.json({ success: true, data: { id: created.id } })
  } catch (err) {
    return billingApiError(err)
  }
}
