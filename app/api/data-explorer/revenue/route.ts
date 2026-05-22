import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOrExecutive } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

type RawRow = {
  id: string
  period_date: string
  branch_id: string
  entity_id: string
  labor: number
  rental: number
  one_time_charges: number
  sales_tax: number
  total_revenue: number
  branches: { id: string; name: string } | null
  entities: { code: string } | null
  revenue_codes: { code: string } | null
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOrExecutive(ctx.access.role)
    if (guard) return guard

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') ?? ''
    const endDate = searchParams.get('endDate') ?? ''
    const branchId = searchParams.get('branchId') ?? ''
    const entityCode = searchParams.get('entityCode') ?? ''
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') ?? '50', 10)))

    if (!startDate || !endDate) {
      return NextResponse.json({ success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Resolve entity UUID
    let entityId: string | null = null
    if (entityCode) {
      const { data: ent } = await supabase.from('entities').select('id').eq('code', entityCode).single()
      if (!ent) return NextResponse.json({ success: true, data: emptyResponse(page, pageSize) })
      entityId = ent.id
    }

    // ── Summary: all rows ──────────────────────────────────────────────────────
    let sumQ = supabase
      .from('revenue_transactions')
      .select('labor, rental, one_time_charges, sales_tax, total_revenue, branch_id', { count: 'exact' })
      .gte('period_date', startDate)
      .lte('period_date', endDate)
      .limit(10000)
    if (branchId) sumQ = sumQ.eq('branch_id', branchId)
    if (entityId) sumQ = sumQ.eq('entity_id', entityId)

    const { data: sumData, count, error: sumErr } = await sumQ
    if (sumErr) throw new Error(sumErr.message)

    const rows0 = sumData ?? []
    const totalRevenue = rows0.reduce((s, r) => s + (r.total_revenue ?? 0), 0)
    const totalLabor = rows0.reduce((s, r) => s + (r.labor ?? 0), 0)
    const totalRental = rows0.reduce((s, r) => s + (r.rental ?? 0), 0)
    const totalOneTime = rows0.reduce((s, r) => s + (r.one_time_charges ?? 0), 0)
    const totalSalesTax = rows0.reduce((s, r) => s + (r.sales_tax ?? 0), 0)
    const branchCount = new Set(rows0.map((r) => r.branch_id)).size

    // ── Paginated rows ─────────────────────────────────────────────────────────
    const from = page * pageSize
    const to = from + pageSize - 1

    let rowQ = supabase
      .from('revenue_transactions')
      .select(`
        id, period_date, branch_id, entity_id, labor, rental, one_time_charges, sales_tax, total_revenue,
        branches(id, name),
        entities(code),
        revenue_codes(code)
      `)
      .gte('period_date', startDate)
      .lte('period_date', endDate)
      .order('period_date', { ascending: false })
      .range(from, to)
    if (branchId) rowQ = rowQ.eq('branch_id', branchId)
    if (entityId) rowQ = rowQ.eq('entity_id', entityId)

    const { data: rowData, error: rowErr } = await rowQ
    if (rowErr) throw new Error(rowErr.message)

    const rows = (rowData as unknown as RawRow[]).map((r) => ({
      id: r.id,
      periodDate: r.period_date,
      branchId: r.branches?.id ?? r.branch_id,
      branchName: r.branches?.name ?? '—',
      entityCode: r.entities?.code ?? '—',
      revenueCode: r.revenue_codes?.code ?? null,
      labor: r.labor,
      rental: r.rental,
      oneTime: r.one_time_charges,
      salesTax: r.sales_tax,
      total: r.total_revenue,
    }))

    return NextResponse.json({
      success: true,
      data: {
        summary: { totalRevenue, totalLabor, totalRental, totalOneTime, totalSalesTax, branchCount },
        rows,
        total: count ?? 0,
        page,
        pageSize,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}

function emptyResponse(page: number, pageSize: number) {
  return {
    summary: { totalRevenue: 0, totalLabor: 0, totalRental: 0, totalOneTime: 0, totalSalesTax: 0, branchCount: 0 },
    rows: [],
    total: 0,
    page,
    pageSize,
  }
}
