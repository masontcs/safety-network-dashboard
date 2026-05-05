import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Database } from '@/lib/supabase/database.types'

type FiscalMonthUpdate = Database['public']['Tables']['fiscal_months']['Update']

function isSaturday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 6
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as {
      name?: string
      year?: number
      start_date?: string
      end_date?: string
      sort_order?: number
      is_active?: boolean
    }

    const { name, year, start_date, end_date, sort_order, is_active } = body

    if (name !== undefined && !name.trim()) {
      return NextResponse.json({ success: false, error: 'name cannot be empty', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (start_date !== undefined && !isSaturday(start_date)) {
      return NextResponse.json({ success: false, error: 'start_date must be a Saturday', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (end_date !== undefined && !isSaturday(end_date)) {
      return NextResponse.json({ success: false, error: 'end_date must be a Saturday', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Fetch current record to merge for overlap check
    const { data: current, error: fetchErr } = await supabase
      .from('fiscal_months')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()
    if (fetchErr) throw new Error(fetchErr.message)
    if (!current) return NextResponse.json({ success: false, error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })

    const effectiveStart = start_date ?? current.start_date
    const effectiveEnd   = end_date   ?? current.end_date

    if (effectiveEnd <= effectiveStart) {
      return NextResponse.json({ success: false, error: 'end_date must be after start_date', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    // Overlap check excluding self
    const { data: overlapping } = await supabase
      .from('fiscal_months')
      .select('id, name')
      .lte('start_date', effectiveEnd)
      .gte('end_date', effectiveStart)
      .neq('id', params.id)
      .limit(1)

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json(
        { success: false, error: `Date range overlaps with "${overlapping[0].name}"`, code: 'CONFLICT' },
        { status: 409 }
      )
    }

    const update: FiscalMonthUpdate = {}
    if (name       !== undefined) update.name       = name.trim()
    if (year       !== undefined) update.year        = year
    if (start_date !== undefined) update.start_date  = start_date
    if (end_date   !== undefined) update.end_date    = end_date
    if (sort_order !== undefined) update.sort_order  = sort_order
    if (is_active  !== undefined) update.is_active   = is_active

    const { data, error } = await supabase
      .from('fiscal_months')
      .update(update)
      .eq('id', params.id)
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, data })
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('fiscal_months')
      .delete()
      .eq('id', params.id)

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
