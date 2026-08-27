import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { canApproveBranch } from '@/lib/billing/approvers'
import { buildCsv, exportFilename, type ExportEntry } from '@/lib/billing/tsheetsExport'

/**
 * TSheets export: one branch, one day, APPROVED entries only. Emits the exact 10-column CSV
 * (see lib/billing/tsheetsExport), splitting overnight entries. Non-exported activities
 * (Passenger Travel / Lunch / Break) are omitted. Yard jobcode is the fixed SNTS name.
 */

const YARD_JOBCODE = 'SAFETY NETWORK TRAFFIC SIGNS, INC.'

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const url = new URL(request.url)
    const branchId = url.searchParams.get('branchId') || ''
    const branchCode = url.searchParams.get('branchCode') || 'branch'
    const date = url.searchParams.get('date') || ''
    if (!branchId || !date) return bad('branchId and date are required')
    if (!(await canApproveBranch(supabase, ctx.access.userId ?? '', branchId))) return bad('You are not an approver for this branch.', 'FORBIDDEN', 403)

    // Which techs are approved for this branch/day.
    const { data: appr } = await supabase
      .from('billing_time_approvals')
      .select('technician_id')
      .eq('branch_id', branchId).eq('work_date', date).eq('status', 'approved')
    const approvedTechs = new Set(((appr ?? []) as { technician_id: string }[]).map((a) => a.technician_id))
    if (approvedTechs.size === 0) return bad('Nothing approved for this branch on this day yet.', 'NOTHING_APPROVED', 400)
    const techList = [...approvedTechs]

    // Reference maps.
    const act = new Map<string, { keyword: string | null; serviceItem: string | null; exported: boolean; billable: boolean }>()
    {
      const { data } = await supabase.from('billing_activity_types').select('id, note_keyword, service_item, exported, billable')
      for (const a of (data ?? []) as { id: string; note_keyword: string | null; service_item: string | null; exported: boolean; billable: boolean }[]) act.set(a.id, { keyword: a.note_keyword, serviceItem: a.service_item, exported: a.exported, billable: a.billable })
    }
    const techName = new Map<string, string>()
    {
      const { data } = await supabase.from('billing_technicians').select('id, name').in('id', techList)
      for (const t of (data ?? []) as { id: string; name: string }[]) techName.set(t.id, t.name)
    }

    const prevDate = (() => { const x = new Date(date + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) })()
    const entries: ExportEntry[] = []

    // Ticket labor
    const { data: labRaw } = await supabase
      .from('billing_ticket_labor')
      .select('technician_id, activity_type_id, start_time, end_time, work_date, notes, billing_tickets!inner(ticket_date, is_voided, billing_jobs!inner(branch_id, job_number, shift_schedule, prevailing_wage, billing_profiles(name, qb_name, billing_customers(name))))')
      .in('technician_id', techList)
      .gte('billing_tickets.ticket_date', prevDate).lte('billing_tickets.ticket_date', date)
    for (const l of (labRaw ?? []) as unknown as {
      technician_id: string; activity_type_id: string; start_time: string; end_time: string; work_date: string | null; notes: string | null
      billing_tickets: { ticket_date: string; is_voided: boolean; billing_jobs: { branch_id: string; job_number: string; shift_schedule: string | null; prevailing_wage: boolean; billing_profiles: { name: string; qb_name: string | null; billing_customers: { name: string } | null } | null } | null } | null
    }[]) {
      const tk = l.billing_tickets; if (!tk || tk.is_voided || !tk.billing_jobs) continue
      const job = tk.billing_jobs
      if (job.branch_id !== branchId) continue
      const eff = l.work_date ?? tk.ticket_date
      if (eff !== date) continue
      const a = act.get(l.activity_type_id); if (!a || !a.exported) continue
      const prof = job.billing_profiles
      const jobcode = prof?.qb_name || (prof?.billing_customers?.name && prof?.name ? `${prof.billing_customers.name} - ${prof.name}` : prof?.name || '')
      entries.push({
        username: techName.get(l.technician_id) ?? '—', date: eff, startTime: l.start_time, endTime: l.end_time,
        jobcode, activityKeyword: a.keyword ?? '', serviceItem: a.serviceItem ?? '', billable: a.billable,
        jobNumber: job.job_number, shiftSchedule: job.shift_schedule, pw: job.prevailing_wage, techNote: l.notes,
      })
    }

    // Yard time
    const { data: yardRaw } = await supabase
      .from('billing_yard_time')
      .select('technician_id, activity_type_id, start_time, end_time, work_date, notes, billing_yard_shifts!inner(branch_id, shift_date)')
      .in('technician_id', techList)
      .gte('billing_yard_shifts.shift_date', prevDate).lte('billing_yard_shifts.shift_date', date)
    for (const y of (yardRaw ?? []) as unknown as {
      technician_id: string; activity_type_id: string; start_time: string; end_time: string; work_date: string | null; notes: string | null
      billing_yard_shifts: { branch_id: string | null; shift_date: string } | null
    }[]) {
      const ys = y.billing_yard_shifts; if (!ys || ys.branch_id !== branchId) continue
      const eff = y.work_date ?? ys.shift_date
      if (eff !== date) continue
      const a = act.get(y.activity_type_id); if (!a || !a.exported) continue
      entries.push({
        username: techName.get(y.technician_id) ?? '—', date: eff, startTime: y.start_time, endTime: y.end_time,
        jobcode: YARD_JOBCODE, activityKeyword: a.keyword ?? '', serviceItem: a.serviceItem ?? '', billable: a.billable,
        jobNumber: null, shiftSchedule: null, pw: false, techNote: y.notes,
      })
    }

    // Group by tech, then time — mirrors the sample's shape.
    entries.sort((x, z) => x.username.localeCompare(z.username) || x.date.localeCompare(z.date) || x.startTime.localeCompare(z.startTime))

    const csv = buildCsv(entries)
    const filename = exportFilename(branchCode, date)
    return new NextResponse(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
    })
  } catch (err) {
    return billingApiError(err)
  }
}
