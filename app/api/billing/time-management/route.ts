import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { approverBranchIds } from '@/lib/billing/approvers'
import { segmentMinutes, minutesToHours, timeToMinutes } from '@/lib/billing/labor'

/**
 * Time Management review feed — the approver's queue. Groups every time entry (ticket labor +
 * yard time) in the week into (technician, branch, day) batches, with the approval status and
 * per-diem flag. Only branches the caller is granted to approve are returned. Approving a
 * batch makes its entries export-eligible; the ticket reflects the status (Phase E).
 */

const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
function mondayOf(d: string): string {
  const dt = new Date(d + 'T00:00:00Z'); const dow = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - dow); return dt.toISOString().slice(0, 10)
}
const hoursOf = (start: string, end: string) => minutesToHours(segmentMinutes(timeToMinutes(start), timeToMinutes(end)))

interface Entry { id: string; kind: 'ticket' | 'yard'; ticketId: string | null; ticketNumber: string | null; activity: string; startTime: string; endTime: string; hours: number; date: string }
interface Batch {
  key: string; technicianId: string; technicianName: string; branchId: string; date: string
  entries: Entry[]; totalHours: number; status: 'submitted' | 'returned' | 'approved'; note: string | null; perDiem: boolean
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    // Authority: only branches the caller may approve (admins included — grant required).
    let branches = await approverBranchIds(supabase, ctx.access.userId ?? '')
    const url = new URL(request.url)
    const reqBranch = url.searchParams.get('branchId') || ''
    if (reqBranch) branches = branches.filter((b) => b === reqBranch)
    if (branches.length === 0) return NextResponse.json({ success: true, data: { weekStart: mondayOf(url.searchParams.get('week') || new Date().toISOString().slice(0, 10)), batches: [], canApprove: false } })
    const branchSet = new Set(branches)

    const weekStart = mondayOf(url.searchParams.get('week') || new Date().toISOString().slice(0, 10))
    const weekEnd = addDays(weekStart, 6)
    const fetchFrom = addDays(weekStart, -1) // catch overnight entries whose ticket_date is the prior day
    const fetchTo = addDays(weekEnd, 1)

    const activityName = new Map<string, string>()
    {
      const { data: acts } = await supabase.from('billing_activity_types').select('id, name')
      for (const a of (acts ?? []) as { id: string; name: string }[]) activityName.set(a.id, a.name)
    }
    const techName = new Map<string, string>()
    {
      const { data: techs } = await supabase.from('billing_technicians').select('id, name')
      for (const t of (techs ?? []) as { id: string; name: string }[]) techName.set(t.id, t.name)
    }

    const byKey = new Map<string, Batch>()
    const keyOf = (tech: string, branch: string, date: string) => `${tech}|${branch}|${date}`
    const ensure = (tech: string, branch: string, date: string): Batch => {
      const k = keyOf(tech, branch, date)
      let b = byKey.get(k)
      if (!b) { b = { key: k, technicianId: tech, technicianName: techName.get(tech) ?? '—', branchId: branch, date, entries: [], totalHours: 0, status: 'submitted', note: null, perDiem: false }; byKey.set(k, b) }
      return b
    }

    // Ticket labor
    const { data: laborRaw } = await supabase
      .from('billing_ticket_labor')
      .select('id, technician_id, activity_type_id, start_time, end_time, work_date, ticket_id, billing_tickets!inner(ticket_number, ticket_date, is_voided, billing_jobs!inner(branch_id))')
      .gte('billing_tickets.ticket_date', fetchFrom).lte('billing_tickets.ticket_date', fetchTo)
    for (const l of (laborRaw ?? []) as unknown as {
      id: string; technician_id: string; activity_type_id: string; start_time: string; end_time: string; work_date: string | null; ticket_id: string
      billing_tickets: { ticket_number: string; ticket_date: string; is_voided: boolean; billing_jobs: { branch_id: string } | null } | null
    }[]) {
      const tk = l.billing_tickets; if (!tk || tk.is_voided || !tk.billing_jobs) continue
      const branch = tk.billing_jobs.branch_id
      if (!branchSet.has(branch)) continue
      const date = l.work_date ?? tk.ticket_date
      if (date < weekStart || date > weekEnd) continue
      const b = ensure(l.technician_id, branch, date)
      const hours = hoursOf(l.start_time, l.end_time)
      b.entries.push({ id: l.id, kind: 'ticket', ticketId: l.ticket_id, ticketNumber: tk.ticket_number, activity: activityName.get(l.activity_type_id) ?? '—', startTime: l.start_time, endTime: l.end_time, hours, date })
      b.totalHours += hours
    }

    // Yard time
    const { data: yardRaw } = await supabase
      .from('billing_yard_time')
      .select('id, technician_id, activity_type_id, start_time, end_time, work_date, yard_shift_id, billing_yard_shifts!inner(branch_id, shift_date)')
      .gte('billing_yard_shifts.shift_date', fetchFrom).lte('billing_yard_shifts.shift_date', fetchTo)
    for (const y of (yardRaw ?? []) as unknown as {
      id: string; technician_id: string; activity_type_id: string; start_time: string; end_time: string; work_date: string | null
      billing_yard_shifts: { branch_id: string | null; shift_date: string } | null
    }[]) {
      const ys = y.billing_yard_shifts; if (!ys || !ys.branch_id) continue
      const branch = ys.branch_id
      if (!branchSet.has(branch)) continue
      const date = y.work_date ?? ys.shift_date
      if (date < weekStart || date > weekEnd) continue
      const b = ensure(y.technician_id, branch, date)
      const hours = hoursOf(y.start_time, y.end_time)
      b.entries.push({ id: y.id, kind: 'yard', ticketId: null, ticketNumber: null, activity: activityName.get(y.activity_type_id) ?? '—', startTime: y.start_time, endTime: y.end_time, hours, date })
      b.totalHours += hours
    }

    const batches = [...byKey.values()]
    if (batches.length) {
      // Approval status + per-diem overlays.
      const techIds = [...new Set(batches.map((b) => b.technicianId))]
      const { data: appr } = await supabase
        .from('billing_time_approvals')
        .select('technician_id, branch_id, work_date, status, note')
        .in('technician_id', techIds)
        .gte('work_date', weekStart).lte('work_date', weekEnd)
      for (const a of (appr ?? []) as { technician_id: string; branch_id: string; work_date: string; status: 'submitted' | 'returned' | 'approved'; note: string | null }[]) {
        const b = byKey.get(keyOf(a.technician_id, a.branch_id, a.work_date))
        if (b) { b.status = a.status; b.note = a.note }
      }
      const { data: pd } = await supabase
        .from('billing_per_diem')
        .select('technician_id, work_date')
        .in('technician_id', techIds)
        .gte('work_date', weekStart).lte('work_date', weekEnd)
      const pdSet = new Set(((pd ?? []) as { technician_id: string; work_date: string }[]).map((p) => `${p.technician_id}|${p.work_date}`))
      for (const b of batches) if (pdSet.has(`${b.technicianId}|${b.date}`)) b.perDiem = true
    }

    batches.sort((a, b) => a.date.localeCompare(b.date) || a.technicianName.localeCompare(b.technicianName))
    for (const b of batches) { b.entries.sort((x, y) => x.startTime.localeCompare(y.startTime)); b.totalHours = Math.round(b.totalHours * 100) / 100 }

    return NextResponse.json({ success: true, data: { weekStart, batches, canApprove: true } })
  } catch (err) {
    return billingApiError(err)
  }
}
