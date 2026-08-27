import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { approverBranchIds } from '@/lib/billing/approvers'

/**
 * Per-diem payout list for a week — who's owed a per diem, and whether it's been paid.
 * A flag, not a dollar amount (payroll pays it out). Admins see all branches; approvers see
 * the branches they're granted.
 */

const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
function mondayOf(d: string): string {
  const dt = new Date(d + 'T00:00:00Z'); const dow = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - dow); return dt.toISOString().slice(0, 10)
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const url = new URL(request.url)
    const weekStart = mondayOf(url.searchParams.get('week') || new Date().toISOString().slice(0, 10))
    const weekEnd = addDays(weekStart, 6)

    const isAdmin = ctx.access.role === 'admin'
    let branches: string[] | null = null
    if (!isAdmin) {
      branches = await approverBranchIds(supabase, ctx.access.userId ?? '')
      if (branches.length === 0) return NextResponse.json({ success: true, data: { weekStart, rows: [] } })
    }

    let q = supabase
      .from('billing_per_diem')
      .select('id, technician_id, work_date, branch_id, status, paid_at')
      .gte('work_date', weekStart).lte('work_date', weekEnd)
      .order('work_date')
    if (branches) q = q.in('branch_id', branches)
    const { data: rows } = await q
    const list = (rows ?? []) as { id: string; technician_id: string; work_date: string; branch_id: string | null; status: string; paid_at: string | null }[]

    const techName = new Map<string, string>()
    if (list.length) {
      const ids = [...new Set(list.map((r) => r.technician_id))]
      const { data: techs } = await supabase.from('billing_technicians').select('id, name').in('id', ids)
      for (const t of (techs ?? []) as { id: string; name: string }[]) techName.set(t.id, t.name)
    }

    return NextResponse.json({
      success: true,
      data: {
        weekStart,
        rows: list.map((r) => ({
          id: r.id, technicianId: r.technician_id, technicianName: techName.get(r.technician_id) ?? '—',
          date: r.work_date, branchId: r.branch_id, status: r.status, paidAt: r.paid_at,
        })),
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}
