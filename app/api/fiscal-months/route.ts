import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

function isSunday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 0
}

function isSaturday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 6
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('fiscal_months')
      .select('*')
      .order('year', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('start_date', { ascending: true })

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, data: data ?? [] })
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
      year?: number
      start_date?: string
      end_date?: string
      sort_order?: number
      is_active?: boolean
    }

    const { name, year, start_date, end_date, sort_order = 0, is_active = true } = body

    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'name is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!year || !Number.isInteger(year)) {
      return NextResponse.json({ success: false, error: 'year must be an integer', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!start_date || !isSunday(start_date)) {
      return NextResponse.json({ success: false, error: 'start_date must be a Sunday (YYYY-MM-DD)', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!end_date || !isSaturday(end_date)) {
      return NextResponse.json({ success: false, error: 'end_date must be a Saturday (YYYY-MM-DD)', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (end_date <= start_date) {
      return NextResponse.json({ success: false, error: 'end_date must be after start_date', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Overlap check: any existing fiscal month whose range intersects with [start_date, end_date]
    const { data: overlapping } = await supabase
      .from('fiscal_months')
      .select('id, name')
      .lte('start_date', end_date)
      .gte('end_date', start_date)
      .limit(1)

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json(
        { success: false, error: `Date range overlaps with existing fiscal month "${overlapping[0].name}"`, code: 'CONFLICT' },
        { status: 409 }
      )
    }

    const { data, error } = await supabase
      .from('fiscal_months')
      .insert({ name: name.trim(), year, start_date, end_date, sort_order, is_active })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (err) {
    return apiError(err)
  }
}
