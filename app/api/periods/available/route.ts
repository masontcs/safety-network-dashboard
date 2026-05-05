import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

// Returns all distinct Saturday period dates that have at least one import.
// Sources: payroll_imports.period_date, revenue_imports.period_date, fuel_imports.date_range_end
// Sorted descending (newest first).
export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()

    const [payrollRes, revenueRes, fuelRes] = await Promise.all([
      supabase.from('payroll_imports').select('period_date'),
      supabase.from('revenue_imports').select('period_date'),
      supabase.from('fuel_imports').select('date_range_end'),
    ])

    const dates = new Set<string>()
    for (const row of payrollRes.data ?? []) dates.add(row.period_date)
    for (const row of revenueRes.data ?? [])  dates.add(row.period_date)
    for (const row of fuelRes.data ?? [])     dates.add(row.date_range_end)

    const sorted = Array.from(dates).sort((a, b) => (a < b ? 1 : -1))
    return NextResponse.json({ success: true, data: sorted })
  } catch (err) {
    return apiError(err)
  }
}
