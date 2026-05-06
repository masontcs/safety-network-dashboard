import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

type RawRow = {
  id: string
  period_date: string
  hours: number | null
  rate: number | null
  amount: number
  entity_id: string
  employees: { first_name: string; last_name: string } | null
  payroll_codes: { code: string; branches: { id: string; name: string } | null } | null
  entities: { code: string } | null
  payroll_items: { name: string; payroll_item_groups: { name: string } | null } | null
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

    // Resolve payroll code IDs for branch filter
    let codeIds: string[] | null = null
    if (branchId) {
      const { data: codes } = await supabase.from('payroll_codes').select('id').eq('branch_id', branchId).eq('is_active', true)
      codeIds = (codes ?? []).map((c) => c.id)
      if (codeIds.length === 0) return NextResponse.json({ success: true, data: emptyResponse(page, pageSize) })
    }

    // ── Summary: all matching rows (limit 10000) ───────────────────────────────
    let sumQ = supabase
      .from('payroll_transactions')
      .select('amount, hours, employee_id', { count: 'exact' })
      .gte('period_date', startDate)
      .lte('period_date', endDate)
      .limit(10000)
    if (entityId) sumQ = sumQ.eq('entity_id', entityId)
    if (codeIds) sumQ = sumQ.in('payroll_code_id', codeIds)

    const { data: sumData, count, error: sumErr } = await sumQ
    if (sumErr) throw new Error(sumErr.message)

    const totalAmount = (sumData ?? []).reduce((s, r) => s + (r.amount ?? 0), 0)
    const totalHours = (sumData ?? []).reduce((s, r) => s + (r.hours ?? 0), 0)
    const employeeSet = new Set((sumData ?? []).map((r) => r.employee_id))
    const employeeCount = employeeSet.size
    const avgPerEmployee = employeeCount > 0 ? totalAmount / employeeCount : 0

    // Taxes (entity + date filtered only — payroll_taxes has no branch column)
    let taxQ = supabase
      .from('payroll_taxes')
      .select('amount')
      .gte('period_date', startDate)
      .lte('period_date', endDate)
      .limit(10000)
    if (entityId) taxQ = taxQ.eq('entity_id', entityId)
    const { data: taxData } = await taxQ
    const totalTaxes = (taxData ?? []).reduce((s, r) => s + (r.amount ?? 0), 0)

    // ── Paginated rows ─────────────────────────────────────────────────────────
    const from = page * pageSize
    const to = from + pageSize - 1

    let rowQ = supabase
      .from('payroll_transactions')
      .select(`
        id, period_date, hours, rate, amount, entity_id,
        employees(first_name, last_name),
        payroll_codes(code, branches(id, name)),
        entities(code),
        payroll_items(name, payroll_item_groups(name))
      `)
      .gte('period_date', startDate)
      .lte('period_date', endDate)
      .order('period_date', { ascending: false })
      .range(from, to)
    if (entityId) rowQ = rowQ.eq('entity_id', entityId)
    if (codeIds) rowQ = rowQ.in('payroll_code_id', codeIds)

    const { data: rowData, error: rowErr } = await rowQ
    if (rowErr) throw new Error(rowErr.message)

    const rows = (rowData as unknown as RawRow[]).map((r) => ({
      id: r.id,
      periodDate: r.period_date,
      employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}`.trim() : '—',
      branchId: r.payroll_codes?.branches?.id ?? '',
      branchName: r.payroll_codes?.branches?.name ?? '—',
      entityCode: r.entities?.code ?? '—',
      payrollCode: r.payroll_codes?.code ?? '—',
      itemName: r.payroll_items?.name ?? null,
      groupName: r.payroll_items?.payroll_item_groups?.name ?? null,
      hours: r.hours,
      rate: r.rate,
      amount: r.amount,
    }))

    return NextResponse.json({
      success: true,
      data: {
        summary: { totalAmount, totalHours, totalTaxes, employeeCount, avgPerEmployee },
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
    summary: { totalAmount: 0, totalHours: 0, totalTaxes: 0, employeeCount: 0, avgPerEmployee: 0 },
    rows: [],
    total: 0,
    page,
    pageSize,
  }
}
