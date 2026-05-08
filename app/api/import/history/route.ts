import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (ctx.access.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin only.', code: 'FORBIDDEN' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    if (type !== 'payroll' && type !== 'revenue' && type !== 'fuel') {
      return NextResponse.json(
        { success: false, error: 'type must be payroll, revenue, or fuel', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    if (type === 'payroll') {
      const { data, error } = await supabase
        .from('payroll_imports')
        .select('id, entity_id, period_date, imported_at, status')
        .order('period_date', { ascending: false })
        .order('imported_at', { ascending: false })

      if (error) throw new Error(error.message)

      // Resolve entity codes
      const { data: entities } = await supabase.from('entities').select('id, code')
      const entityMap: Record<string, string> = {}
      for (const e of entities ?? []) entityMap[e.id] = e.code

      const rows = (data ?? []).map((r) => ({
        id: r.id,
        periodDate: r.period_date,
        entityCode: entityMap[r.entity_id] ?? r.entity_id,
        importedAt: r.imported_at,
        status: r.status,
      }))

      return NextResponse.json({ success: true, data: rows })
    }

    if (type === 'revenue') {
      const { data, error } = await supabase
        .from('revenue_imports')
        .select('id, period_date, imported_at, status')
        .order('period_date', { ascending: false })
        .order('imported_at', { ascending: false })

      if (error) throw new Error(error.message)

      const rows = (data ?? []).map((r) => ({
        id: r.id,
        periodDate: r.period_date,
        importedAt: r.imported_at,
        status: r.status,
      }))

      return NextResponse.json({ success: true, data: rows })
    }

    // fuel
    const { data, error } = await supabase
      .from('fuel_imports')
      .select('id, vendor, date_range_start, date_range_end, imported_at, status')
      .order('date_range_end', { ascending: false })
      .order('imported_at', { ascending: false })

    if (error) throw new Error(error.message)

    const rows = (data ?? []).map((r) => ({
      id: r.id,
      vendor: r.vendor as string,
      dateRangeStart: r.date_range_start,
      dateRangeEnd: r.date_range_end,
      importedAt: r.imported_at,
      status: r.status,
    }))

    return NextResponse.json({ success: true, data: rows })
  } catch (err) {
    return apiError(err)
  }
}
