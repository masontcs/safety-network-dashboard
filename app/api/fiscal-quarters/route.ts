import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

type RawQuarterRow = {
  id: string
  name: string
  quarter_number: number
  year: number
  is_active: boolean
  created_at: string
  fiscal_quarter_months: Array<{
    sort_order: number
    fiscal_months: { id: string; name: string; start_date: string; end_date: string } | null
  }>
}

function shapeQuarter(row: RawQuarterRow) {
  const months = (row.fiscal_quarter_months ?? [])
    .filter((fqm) => fqm.fiscal_months != null)
    .map((fqm) => ({ ...fqm.fiscal_months!, sort_order: fqm.sort_order }))
    .sort((a, b) => a.sort_order - b.sort_order)

  return {
    id: row.id,
    name: row.name,
    quarter_number: row.quarter_number,
    year: row.year,
    is_active: row.is_active,
    created_at: row.created_at,
    months,
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('fiscal_quarters')
      .select(`
        id, name, quarter_number, year, is_active, created_at,
        fiscal_quarter_months(sort_order, fiscal_months(id, name, start_date, end_date))
      `)
      .order('year', { ascending: true })
      .order('quarter_number', { ascending: true })

    if (error) throw new Error(error.message)

    const shaped = (data ?? []).map((row) => shapeQuarter(row as unknown as RawQuarterRow))
    return NextResponse.json({ success: true, data: shaped })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as {
      name?: string
      quarterNumber?: number
      year?: number
      fiscalMonthIds?: string[]
    }

    const { name, quarterNumber, year, fiscalMonthIds } = body

    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'name is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!quarterNumber || !Number.isInteger(quarterNumber) || quarterNumber < 1 || quarterNumber > 4) {
      return NextResponse.json({ success: false, error: 'quarterNumber must be 1–4', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!year || !Number.isInteger(year)) {
      return NextResponse.json({ success: false, error: 'year must be an integer', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!Array.isArray(fiscalMonthIds) || fiscalMonthIds.length !== 3) {
      return NextResponse.json({ success: false, error: 'exactly 3 fiscalMonthIds are required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    const uniqueIds = new Set(fiscalMonthIds)
    if (uniqueIds.size !== 3) {
      return NextResponse.json({ success: false, error: 'fiscalMonthIds must be distinct', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Check none of the 3 months are already assigned to any quarter
    const { data: existing, error: existErr } = await supabase
      .from('fiscal_quarter_months')
      .select('fiscal_month_id')
      .in('fiscal_month_id', fiscalMonthIds)

    if (existErr) throw new Error(existErr.message)
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { success: false, error: 'One or more months are already assigned to another quarter', code: 'CONFLICT' },
        { status: 409 }
      )
    }

    // Insert quarter
    const { data: quarter, error: qErr } = await supabase
      .from('fiscal_quarters')
      .insert({ name: name.trim(), quarter_number: quarterNumber, year, is_active: true })
      .select('id')
      .single()

    if (qErr) {
      if (qErr.code === '23505') {
        return NextResponse.json(
          { success: false, error: `Q${quarterNumber} ${year} already exists`, code: 'DUPLICATE' },
          { status: 409 }
        )
      }
      throw new Error(qErr.message)
    }

    // Insert the 3 month assignments
    const monthRows = fiscalMonthIds.map((mid, i) => ({
      fiscal_quarter_id: quarter.id,
      fiscal_month_id: mid,
      sort_order: i + 1,
    }))

    const { error: mErr } = await supabase.from('fiscal_quarter_months').insert(monthRows)
    if (mErr) {
      // Roll back the quarter row on failure
      await supabase.from('fiscal_quarters').delete().eq('id', quarter.id)
      throw new Error(mErr.message)
    }

    // Re-fetch the full shaped quarter
    const { data: full, error: fetchErr } = await supabase
      .from('fiscal_quarters')
      .select(`id, name, quarter_number, year, is_active, created_at, fiscal_quarter_months(sort_order, fiscal_months(id, name, start_date, end_date))`)
      .eq('id', quarter.id)
      .single()

    if (fetchErr) throw new Error(fetchErr.message)

    return NextResponse.json({ success: true, data: shapeQuarter(full as unknown as RawQuarterRow) }, { status: 201 })
  } catch (err) {
    return apiError(err)
  }
}
