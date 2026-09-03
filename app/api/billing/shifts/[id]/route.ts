import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'
import { existingJobTypeNames } from '@/lib/billing/jobTypes'
import { writeShiftChildren } from '@/lib/billing/shifts'
import type { Database } from '@/lib/supabase/database.types'

type ShiftUpdate = Database['public']['Tables']['billing_shifts']['Update']

/** A single shift: full detail (GET), edit while staged (PATCH), delete while staged (DELETE). */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface ShiftRow {
  id: string; job_id: string | null; branch_id: string; shift_date: string; status: string
  meal_type: string; per_diem_preapproved: boolean; ticket_id: string | null; notes: string | null
  billing_jobs: { job_number: string; name: string | null; prevailing_wage: boolean; shift_schedule: string | null; billing_profiles: { name: string; billing_customers: { name: string } | null } | null } | null
}

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('billing_shifts')
      .select('id, job_id, branch_id, shift_date, status, meal_type, per_diem_preapproved, ticket_id, notes, billing_jobs(job_number, name, prevailing_wage, shift_schedule, billing_profiles(name, billing_customers(name)))')
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const s = data as unknown as ShiftRow | null
    if (!s) return bad('Shift not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(s.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)

    const { data: crew } = await supabase.from('billing_shift_crew').select('technician_id, is_lead, acknowledged_at').eq('shift_id', s.id)
    const { data: types } = await supabase.from('billing_shift_job_types').select('job_type').eq('shift_id', s.id)
    const { data: timeline } = await supabase.from('billing_shift_timeline').select('at_time, activity_type_id, sort_order').eq('shift_id', s.id).order('sort_order')
    const { data: files } = await supabase.from('billing_shift_files').select('id, storage_path, filename, created_at').eq('shift_id', s.id).order('created_at')

    return NextResponse.json({
      success: true,
      data: {
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
        prevailingWage: s.billing_jobs?.prevailing_wage ?? false,
        shiftSchedule: s.billing_jobs?.shift_schedule ?? null,
        jobTypes: ((types ?? []) as { job_type: string }[]).map((t) => t.job_type),
        crew: ((crew ?? []) as { technician_id: string; is_lead: boolean; acknowledged_at: string | null }[])
          .map((c) => ({ technicianId: c.technician_id, isLead: c.is_lead, acknowledgedAt: c.acknowledged_at })),
        timeline: ((timeline ?? []) as { at_time: string; activity_type_id: string }[])
          .map((t) => ({ atTime: t.at_time, activityTypeId: t.activity_type_id })),
        files: ((files ?? []) as { id: string; storage_path: string; filename: string | null }[])
          .map((f) => ({ id: f.id, storagePath: f.storage_path, filename: f.filename })),
        isAdmin: ctx.access.role === 'admin',
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

interface PatchBody {
  shiftDate?: string
  mealType?: string
  perDiemPreapproved?: boolean
  notes?: string | null
  jobTypes?: string[]
  timeline?: { atTime: string; activityTypeId: string }[]
  crew?: { technicianId: string; isLead?: boolean }[]
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'dispatch')
    if (guard) return guard
    const supabase = createServiceClient()

    const { data: existing } = await supabase.from('billing_shifts').select('id, status, branch_id').eq('id', params.id).maybeSingle()
    const ex = existing as { id: string; status: string; branch_id: string } | null
    if (!ex) return bad('Shift not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(ex.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)
    if (ex.status !== 'staged') return bad('Only a staged shift can be edited. Published shifts are managed from the ticket.', 'CONFLICT', 409)

    const body = (await request.json()) as PatchBody
    if (body.mealType && body.mealType !== 'standard' && body.mealType !== 'odmp') return bad('Invalid meal type')

    const patch: ShiftUpdate = {}
    if (body.shiftDate !== undefined) patch.shift_date = body.shiftDate
    if (body.mealType !== undefined) patch.meal_type = body.mealType as 'standard' | 'odmp'
    if (body.perDiemPreapproved !== undefined) patch.per_diem_preapproved = body.perDiemPreapproved
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString()
      const { error } = await supabase.from('billing_shifts').update(patch).eq('id', params.id)
      if (error) throw new Error(error.message)
    }

    let jobTypes: string[] | undefined
    if (body.jobTypes) {
      const validTypes = await existingJobTypeNames(supabase)
      jobTypes = [...new Set(body.jobTypes.filter((t) => validTypes.has(t)))]
    }
    await writeShiftChildren(supabase, params.id, jobTypes, body.timeline, body.crew)

    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'dispatch')
    if (guard) return guard
    const supabase = createServiceClient()

    const { data: ex } = await supabase.from('billing_shifts').select('id, status, branch_id').eq('id', params.id).maybeSingle()
    const s = ex as { id: string; status: string; branch_id: string } | null
    if (!s) return bad('Shift not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(s.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)
    if (s.status !== 'staged') return bad('Only a staged shift can be deleted. Void the ticket instead once published.', 'CONFLICT', 409)

    // Children cascade on delete (FK on delete cascade).
    const { error } = await supabase.from('billing_shifts').delete().eq('id', params.id)
    if (error) throw new Error(error.message)
    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
