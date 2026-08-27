import { NextResponse } from 'next/server'
import { getTechContext } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { mealTypeLabel } from '@/lib/billing/shiftConstants'

/**
 * The tech's published shifts in a recent/near window — what they must ACKNOWLEDGE (see the
 * meal type, 4-10 schedule, PW, job types and traffic plan, then tap Accept). Money-blind:
 * no rates here, only operational detail.
 */

interface CrewRow {
  shift_id: string
  is_lead: boolean
  acknowledged_at: string | null
  billing_shifts: {
    id: string; job_id: string | null; shift_date: string; status: string; meal_type: string; per_diem_preapproved: boolean
    billing_jobs: { job_number: string; name: string | null; shift_schedule: string | null; prevailing_wage: boolean; billing_profiles: { billing_customers: { name: string } | null } | null } | null
  } | null
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    // Window: yesterday through +21 days, published only.
    const today = new Date()
    const from = new Date(today); from.setUTCDate(from.getUTCDate() - 1)
    const to = new Date(today); to.setUTCDate(to.getUTCDate() + 21)
    const fromStr = from.toISOString().slice(0, 10)
    const toStr = to.toISOString().slice(0, 10)

    const { data: rows } = await supabase
      .from('billing_shift_crew')
      .select('shift_id, is_lead, acknowledged_at, billing_shifts!inner(id, job_id, shift_date, status, meal_type, per_diem_preapproved, billing_jobs(job_number, name, shift_schedule, prevailing_wage, billing_profiles(billing_customers(name))))')
      .eq('technician_id', ctx.tech.technicianId)
      .eq('billing_shifts.status', 'published')
      .gte('billing_shifts.shift_date', fromStr)
      .lte('billing_shifts.shift_date', toStr)
    const crew = (rows ?? []) as unknown as CrewRow[]

    const shiftIds = crew.map((c) => c.shift_id)
    const typesByShift = new Map<string, string[]>()
    const filesByShift = new Map<string, { id: string; filename: string | null; url: string | null }[]>()
    if (shiftIds.length) {
      const { data: types } = await supabase.from('billing_shift_job_types').select('shift_id, job_type').in('shift_id', shiftIds)
      for (const t of (types ?? []) as { shift_id: string; job_type: string }[]) typesByShift.set(t.shift_id, [...(typesByShift.get(t.shift_id) ?? []), t.job_type])
      const { data: files } = await supabase.from('billing_shift_files').select('id, shift_id, filename, storage_path').in('shift_id', shiftIds)
      for (const f of (files ?? []) as { id: string; shift_id: string; filename: string | null; storage_path: string }[]) {
        const { data: signed } = await supabase.storage.from('shift-files').createSignedUrl(f.storage_path, 3600)
        filesByShift.set(f.shift_id, [...(filesByShift.get(f.shift_id) ?? []), { id: f.id, filename: f.filename, url: signed?.signedUrl ?? null }])
      }
    }

    const data = crew
      .filter((c) => c.billing_shifts)
      .map((c) => {
        const s = c.billing_shifts!
        return {
          id: s.id,
          date: s.shift_date,
          isYard: s.job_id === null,
          isLead: c.is_lead,
          acknowledged: !!c.acknowledged_at,
          jobNumber: s.billing_jobs?.job_number ?? null,
          jobName: s.billing_jobs?.name ?? null,
          customer: s.billing_jobs?.billing_profiles?.billing_customers?.name ?? null,
          mealType: s.meal_type,
          mealLabel: mealTypeLabel(s.meal_type),
          shiftSchedule: s.billing_jobs?.shift_schedule ?? null,
          prevailingWage: s.billing_jobs?.prevailing_wage ?? false,
          perDiemPreapproved: s.per_diem_preapproved,
          jobTypes: typesByShift.get(s.id) ?? [],
          files: filesByShift.get(s.id) ?? [],
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({ success: true, data })
  } catch (err) {
    return billingApiError(err)
  }
}
