import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

// Returns all calendar years that have imported data, with the actual min/max
// period_date within each year. Sorted descending (most recent first).
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

    const datesByYear: Record<number, string[]> = {}

    const addDate = (dateStr: string | null | undefined) => {
      if (!dateStr) return
      const year = parseInt(dateStr.split('-')[0])
      if (isNaN(year)) return
      if (!datesByYear[year]) datesByYear[year] = []
      datesByYear[year].push(dateStr)
    }

    for (const row of payrollRes.data ?? []) addDate(row.period_date)
    for (const row of revenueRes.data ?? []) addDate(row.period_date)
    for (const row of fuelRes.data ?? []) addDate(row.date_range_end)

    const years = Object.entries(datesByYear)
      .map(([yearStr, dates]) => ({
        year: parseInt(yearStr),
        startDate: dates.reduce((a, b) => (a < b ? a : b)),
        endDate: dates.reduce((a, b) => (a > b ? a : b)),
      }))
      .sort((a, b) => b.year - a.year)

    return NextResponse.json({ success: true, data: years })
  } catch (err) {
    return apiError(err)
  }
}
