import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Vendor } from '@/lib/supabase/database.types'

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

function toCSV(headers: string[], rows: string[][]): string {
  return [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
}

export async function GET(
  request: Request,
  { params }: { params: { dataset: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (ctx.access.role !== 'admin' && ctx.access.role !== 'executive') {
      return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
    }

    const { dataset } = params
    if (!['payroll', 'revenue', 'fuel'].includes(dataset)) {
      return NextResponse.json({ success: false, error: 'Invalid dataset', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate') ?? ''
    const endDate = searchParams.get('endDate') ?? ''
    const branchId = searchParams.get('branchId') ?? ''
    const entityCode = searchParams.get('entityCode') ?? ''
    const vendor = searchParams.get('vendor') ?? ''

    if (!startDate || !endDate) {
      return NextResponse.json({ success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()
    let csvContent = ''
    const filename = `${dataset}-export-${startDate}-to-${endDate}.csv`

    const PAGE_SIZE = 1000

    if (dataset === 'payroll') {
      let entityId: string | null = null
      if (entityCode) {
        const { data: ent } = await supabase.from('entities').select('id').eq('code', entityCode).single()
        entityId = ent?.id ?? null
      }
      let codeIds: string[] | null = null
      if (branchId) {
        const { data: codes } = await supabase.from('payroll_codes').select('id').eq('branch_id', branchId).eq('is_active', true)
        codeIds = (codes ?? []).map((c) => c.id)
      }

      type R = {
        id: string; period_date: string; hours: number | null; rate: number | null; amount: number
        employees: { first_name: string; last_name: string } | null
        payroll_codes: { code: string; branches: { id: string; name: string } | null } | null
        entities: { code: string } | null
        payroll_items: { name: string; payroll_item_groups: { name: string } | null } | null
      }
      const data: R[] = []
      {
        let from = 0
        while (true) {
          let q = supabase
            .from('payroll_transactions')
            .select(`id, period_date, hours, rate, amount, employees(first_name, last_name), payroll_codes(code, branches(id, name)), entities(code), payroll_items(name, payroll_item_groups(name))`)
            .gte('period_date', startDate)
            .lte('period_date', endDate)
            .order('period_date', { ascending: false })
            .range(from, from + PAGE_SIZE - 1)
          if (entityId) q = q.eq('entity_id', entityId)
          if (codeIds) q = q.in('payroll_code_id', codeIds)
          const { data: page, error } = await q
          if (error) throw new Error(error.message)
          if (!page || page.length === 0) break
          data.push(...(page as unknown as R[]))
          if (page.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
      }

      const headers = ['Period Date', 'Employee', 'Branch', 'Entity', 'Payroll Code', 'Item', 'Group', 'Hours', 'Rate', 'Amount']
      const csvRows = data.map((r) => [
        r.period_date,
        r.employees ? `${r.employees.first_name} ${r.employees.last_name}`.trim() : '',
        r.payroll_codes?.branches?.name ?? '',
        r.entities?.code ?? '',
        r.payroll_codes?.code ?? '',
        r.payroll_items?.name ?? '',
        r.payroll_items?.payroll_item_groups?.name ?? '',
        String(r.hours ?? ''),
        String(r.rate ?? ''),
        String(r.amount),
      ])
      csvContent = toCSV(headers, csvRows)
    }

    if (dataset === 'revenue') {
      let entityId: string | null = null
      if (entityCode) {
        const { data: ent } = await supabase.from('entities').select('id').eq('code', entityCode).single()
        entityId = ent?.id ?? null
      }

      type R = {
        id: string; period_date: string; labor: number; rental: number
        one_time_charges: number; sales_tax: number; total_revenue: number
        branches: { id: string; name: string } | null
        entities: { code: string } | null
        revenue_codes: { code: string } | null
      }
      const data: R[] = []
      {
        let from = 0
        while (true) {
          let q = supabase
            .from('revenue_transactions')
            .select(`id, period_date, labor, rental, one_time_charges, sales_tax, total_revenue, branches(id, name), entities(code), revenue_codes(code)`)
            .gte('period_date', startDate)
            .lte('period_date', endDate)
            .order('period_date', { ascending: false })
            .range(from, from + PAGE_SIZE - 1)
          if (branchId) q = q.eq('branch_id', branchId)
          if (entityId) q = q.eq('entity_id', entityId)
          const { data: page, error } = await q
          if (error) throw new Error(error.message)
          if (!page || page.length === 0) break
          data.push(...(page as unknown as R[]))
          if (page.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
      }

      const headers = ['Period Date', 'Branch', 'Entity', 'Revenue Code', 'Labor', 'Rental', 'One-Time', 'Sales Tax', 'Total Revenue']
      const csvRows = data.map((r) => [
        r.period_date,
        r.branches?.name ?? '',
        r.entities?.code ?? '',
        r.revenue_codes?.code ?? '',
        String(r.labor),
        String(r.rental),
        String(r.one_time_charges),
        String(r.sales_tax),
        String(r.total_revenue),
      ])
      csvContent = toCSV(headers, csvRows)
    }

    if (dataset === 'fuel') {
      type R = {
        id: string; transaction_date: string; vendor: string; product: string | null
        site_name: string | null; site_city: string | null; site_state: string | null
        gallons: number | null; price_per_gallon: number | null
        total_pretax: number | null; tax: number | null; total_with_tax: number; mpg: number | null
        branches: { id: string; name: string } | null
        employees: { first_name: string; last_name: string } | null
        fuel_card_assignments: { card_name: string } | null
      }
      const data: R[] = []
      {
        let from = 0
        while (true) {
          let q = supabase
            .from('fuel_transactions')
            .select(`id, transaction_date, vendor, product, site_name, site_city, site_state, gallons, price_per_gallon, total_pretax, tax, total_with_tax, mpg, branches(id, name), employees(first_name, last_name), fuel_card_assignments(card_name)`)
            .gte('transaction_date', startDate)
            .lte('transaction_date', endDate)
            .is('business_tag', null)
            .order('transaction_date', { ascending: false })
            .range(from, from + PAGE_SIZE - 1)
          if (branchId) q = q.eq('branch_id', branchId)
          if (vendor) q = q.eq('vendor', vendor as Vendor)
          const { data: page, error } = await q
          if (error) throw new Error(error.message)
          if (!page || page.length === 0) break
          data.push(...(page as unknown as R[]))
          if (page.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
      }

      const headers = ['Date', 'Card/Driver', 'Branch', 'Vendor', 'Product', 'Site', 'City', 'State', 'Gallons', 'Price/Gal', 'Pre-tax', 'Tax', 'Total', 'MPG']
      const csvRows = data.map((r) => {
        let cardDriver = ''
        if (r.employees) cardDriver = `${r.employees.first_name} ${r.employees.last_name}`.trim()
        else if (r.fuel_card_assignments) cardDriver = r.fuel_card_assignments.card_name
        return [
          r.transaction_date, cardDriver, r.branches?.name ?? '',
          r.vendor, r.product ?? '', r.site_name ?? '', r.site_city ?? '', r.site_state ?? '',
          String(r.gallons ?? ''), String(r.price_per_gallon ?? ''),
          String(r.total_pretax ?? ''), String(r.tax ?? ''),
          String(r.total_with_tax), String(r.mpg ?? ''),
        ]
      })
      csvContent = toCSV(headers, csvRows)
    }

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
