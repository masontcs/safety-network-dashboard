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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const { id } = params

    const body = await request.json() as {
      name?: string
      quarterNumber?: number
      year?: number
      fiscalMonthIds?: string[]
    }

    const { name, quarterNumber, year, fiscalMonthIds } = body

    if (name !== undefined && !name.trim()) {
      return NextResponse.json({ success: false, error: 'name cannot be empty', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (quarterNumber !== undefined && (!Number.isInteger(quarterNumber) || quarterNumber < 1 || quarterNumber > 4)) {
      return NextResponse.json({ success: false, error: 'quarterNumber must be 1–4', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (year !== undefined && !Number.isInteger(year)) {
      return NextResponse.json({ success: false, error: 'year must be an integer', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (fiscalMonthIds !== undefined) {
      if (!Array.isArray(fiscalMonthIds) || fiscalMonthIds.length !== 3) {
        return NextResponse.json({ success: false, error: 'exactly 3 fiscalMonthIds are required', code: 'VALIDATION_ERROR' }, { status: 400 })
      }
      const uniqueIds = new Set(fiscalMonthIds)
      if (uniqueIds.size !== 3) {
        return NextResponse.json({ success: false, error: 'fiscalMonthIds must be distinct', code: 'VALIDATION_ERROR' }, { status: 400 })
      }
    }

    const supabase = createServiceClient()

    // Verify quarter exists
    const { data: existing, error: fetchErr } = await supabase
      .from('fiscal_quarters')
      .select('id')
      .eq('id', id)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ success: false, error: 'Quarter not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    // If updating month assignments, check new months aren't already assigned to a different quarter
    if (fiscalMonthIds) {
      const { data: conflicts, error: conflictErr } = await supabase
        .from('fiscal_quarter_months')
        .select('fiscal_month_id')
        .in('fiscal_month_id', fiscalMonthIds)
        .neq('fiscal_quarter_id', id)

      if (conflictErr) throw new Error(conflictErr.message)
      if (conflicts && conflicts.length > 0) {
        return NextResponse.json(
          { success: false, error: 'One or more months are already assigned to another quarter', code: 'CONFLICT' },
          { status: 409 }
        )
      }
    }

    // Update quarter fields if any provided
    type QuarterUpdate = { name?: string; quarter_number?: number; year?: number }
    const updates: QuarterUpdate = {}
    if (name !== undefined) updates.name = name.trim()
    if (quarterNumber !== undefined) updates.quarter_number = quarterNumber
    if (year !== undefined) updates.year = year

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabase
        .from('fiscal_quarters')
        .update(updates)
        .eq('id', id)

      if (updateErr) {
        if (updateErr.code === '23505') {
          return NextResponse.json(
            { success: false, error: `Q${quarterNumber ?? ''} ${year ?? ''} already exists`, code: 'DUPLICATE' },
            { status: 409 }
          )
        }
        throw new Error(updateErr.message)
      }
    }

    // Replace month assignments if provided
    if (fiscalMonthIds) {
      const { error: delErr } = await supabase
        .from('fiscal_quarter_months')
        .delete()
        .eq('fiscal_quarter_id', id)

      if (delErr) throw new Error(delErr.message)

      const monthRows = fiscalMonthIds.map((mid, i) => ({
        fiscal_quarter_id: id,
        fiscal_month_id: mid,
        sort_order: i + 1,
      }))

      const { error: insErr } = await supabase.from('fiscal_quarter_months').insert(monthRows)
      if (insErr) throw new Error(insErr.message)
    }

    // Re-fetch shaped quarter
    const { data: full, error: refetchErr } = await supabase
      .from('fiscal_quarters')
      .select(`id, name, quarter_number, year, is_active, created_at, fiscal_quarter_months(sort_order, fiscal_months(id, name, start_date, end_date))`)
      .eq('id', id)
      .single()

    if (refetchErr) throw new Error(refetchErr.message)

    return NextResponse.json({ success: true, data: shapeQuarter(full as unknown as RawQuarterRow) })
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const { id } = params
    const supabase = createServiceClient()

    const { error } = await supabase
      .from('fiscal_quarters')
      .delete()
      .eq('id', id)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
