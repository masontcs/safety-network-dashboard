import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOrExecutive } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { isValidDate } from '@/lib/utils/date'
import { apiError } from '@/lib/utils/errors'

// GET /api/payroll/group-breakdown?startDate=&endDate=
// Executive/admin only. Company-wide payroll COST composition for the date range:
// Gross wages / Employer Taxes / Fringes / Other. (No employee withholdings exist
// in the imported data — see migration 20260618000002.)
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOrExecutive(ctx.access.role)
    if (guard) return guard

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate must be valid dates (YYYY-MM-DD)', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // payroll_group_breakdown is defined in migration 20260618000002 but isn't in the
    // generated DB types, so the rpc call is typed locally.
    const callBreakdown = supabase.rpc as unknown as (
      fn: 'payroll_group_breakdown',
      args: { p_start: string; p_end: string },
    ) => Promise<{
      data: Array<{ gross: number; fringes: number; other: number; employer_tax: number }> | null
      error: { message: string } | null
    }>
    const { data, error } = await callBreakdown('payroll_group_breakdown', { p_start: startDate, p_end: endDate })
    if (error) {
      return NextResponse.json({ success: false, error: error.message, code: 'DB_ERROR' }, { status: 500 })
    }

    const row = data?.[0] ?? { gross: 0, fringes: 0, other: 0, employer_tax: 0 }
    const gross = Number(row.gross) || 0
    const fringes = Number(row.fringes) || 0
    const other = Number(row.other) || 0
    const employerTax = Number(row.employer_tax) || 0
    const total = gross + employerTax + fringes + other

    return NextResponse.json({ success: true, data: { gross, employerTax, fringes, other, total } })
  } catch (err) {
    return apiError(err)
  }
}
