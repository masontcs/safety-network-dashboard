import { NextResponse } from 'next/server'
import { getTechContext } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { segmentMinutes, timeToMinutes, minutesToHours } from '@/lib/billing/labor'

/**
 * A tech's yard shifts (dispatched to the yard — no ticket). Recent + upcoming, so the
 * "Add time" flow can offer the yard as a destination alongside the tech's tickets.
 * Money-blind by contract, like the rest of /api/tech.
 */
export async function GET(): Promise<Response> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    // A two-week window keeps the picker to shifts that are actually being worked.
    const since = new Date(); since.setUTCDate(since.getUTCDate() - 14)
    const sinceStr = since.toISOString().slice(0, 10)

    const { data: shifts, error } = await supabase
      .from('billing_yard_shifts')
      .select('id, shift_date')
      .eq('technician_id', ctx.tech.technicianId)
      .gte('shift_date', sinceStr)
      .order('shift_date', { ascending: false })
    if (error) throw new Error(error.message)
    const rows = (shifts ?? []) as { id: string; shift_date: string }[]

    // Sum my hours per shift.
    const ids = rows.map((r) => r.id)
    const hoursByShift = new Map<string, number>()
    if (ids.length) {
      const { data: times } = await supabase
        .from('billing_yard_time')
        .select('yard_shift_id, start_time, end_time')
        .in('yard_shift_id', ids)
        .eq('technician_id', ctx.tech.technicianId)
      for (const t of (times ?? []) as { yard_shift_id: string; start_time: string; end_time: string }[]) {
        const mins = segmentMinutes(timeToMinutes(t.start_time), timeToMinutes(t.end_time))
        hoursByShift.set(t.yard_shift_id, (hoursByShift.get(t.yard_shift_id) ?? 0) + minutesToHours(mins))
      }
    }

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({ id: r.id, date: r.shift_date, myHours: hoursByShift.get(r.id) ?? 0 })),
    })
  } catch (err) {
    return billingApiError(err)
  }
}
