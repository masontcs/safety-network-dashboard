import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Vendor } from '@/lib/supabase/database.types'

type RawRow = {
  id: string
  transaction_date: string
  vendor: string
  product: string | null
  site_name: string | null
  site_city: string | null
  site_state: string | null
  gallons: number | null
  price_per_gallon: number | null
  total_pretax: number | null
  tax: number | null
  total_with_tax: number
  mpg: number | null
  branches: { id: string; name: string } | null
  employees: { first_name: string; last_name: string } | null
  fuel_card_assignments: { card_name: string } | null
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (ctx.access.role !== 'admin' && ctx.access.role !== 'executive') {
      return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') ?? ''
    const endDate = searchParams.get('endDate') ?? ''
    const branchId = searchParams.get('branchId') ?? ''
    const vendor = searchParams.get('vendor') ?? ''
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') ?? '50', 10)))

    if (!startDate || !endDate) {
      return NextResponse.json({ success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── Summary: all rows ──────────────────────────────────────────────────────
    let sumQ = supabase
      .from('fuel_transactions')
      .select('total_with_tax, gallons, price_per_gallon, fuel_card_assignment_id, employee_id', { count: 'exact' })
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .is('business_tag', null) // SN only
      .limit(10000)
    if (branchId) sumQ = sumQ.eq('branch_id', branchId)
    if (vendor) sumQ = sumQ.eq('vendor', vendor as Vendor)

    const { data: sumData, count, error: sumErr } = await sumQ
    if (sumErr) throw new Error(sumErr.message)

    const rows0 = sumData ?? []
    const totalCost = rows0.reduce((s, r) => s + (r.total_with_tax ?? 0), 0)
    const totalGallons = rows0.reduce((s, r) => s + (r.gallons ?? 0), 0)
    const gallonedRows = rows0.filter((r) => r.gallons && r.price_per_gallon)
    const avgPricePerGallon = gallonedRows.length > 0
      ? gallonedRows.reduce((s, r) => s + (r.price_per_gallon ?? 0), 0) / gallonedRows.length
      : 0
    const cardSet = new Set([
      ...rows0.filter((r) => r.fuel_card_assignment_id).map((r) => r.fuel_card_assignment_id),
      ...rows0.filter((r) => r.employee_id).map((r) => `emp:${r.employee_id}`),
    ])
    const uniqueCards = cardSet.size

    // ── Paginated rows ─────────────────────────────────────────────────────────
    const from = page * pageSize
    const to = from + pageSize - 1

    let rowQ = supabase
      .from('fuel_transactions')
      .select(`
        id, transaction_date, vendor, product, site_name, site_city, site_state,
        gallons, price_per_gallon, total_pretax, tax, total_with_tax, mpg,
        branches(id, name),
        employees(first_name, last_name),
        fuel_card_assignments(card_name)
      `)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .is('business_tag', null)
      .order('transaction_date', { ascending: false })
      .range(from, to)
    if (branchId) rowQ = rowQ.eq('branch_id', branchId)
    if (vendor) rowQ = rowQ.eq('vendor', vendor as Vendor)

    const { data: rowData, error: rowErr } = await rowQ
    if (rowErr) throw new Error(rowErr.message)

    const rows = (rowData as unknown as RawRow[]).map((r) => {
      let cardDriver = '—'
      if (r.employees) {
        cardDriver = `${r.employees.first_name} ${r.employees.last_name}`.trim()
      } else if (r.fuel_card_assignments) {
        cardDriver = r.fuel_card_assignments.card_name
      }
      return {
        id: r.id,
        transactionDate: r.transaction_date,
        cardDriver,
        branchId: r.branches?.id ?? null,
        branchName: r.branches?.name ?? null,
        vendor: r.vendor,
        product: r.product,
        siteName: r.site_name,
        siteCity: r.site_city,
        siteState: r.site_state,
        gallons: r.gallons,
        pricePerGallon: r.price_per_gallon,
        totalPreTax: r.total_pretax,
        tax: r.tax,
        totalWithTax: r.total_with_tax,
        mpg: r.mpg,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        summary: { totalCost, totalGallons, avgPricePerGallon, transactionCount: count ?? 0, uniqueCards },
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
