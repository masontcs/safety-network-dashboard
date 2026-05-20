import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

const PAGE_SIZE = 50

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const entityCode  = searchParams.get('entity') || null
    const branchId    = searchParams.get('branchId') || null
    const agingBucket = searchParams.get('agingBucket') || null
    const customerId  = searchParams.get('customerId') || null
    const search      = searchParams.get('search') || null
    const rowType     = searchParams.get('rowType') || 'invoice'
    const page        = Math.max(1, parseInt(searchParams.get('page') || '1', 10))

    const { branchIds } = ctx.access
    const supabase = createServiceClient()

    // Validate branch access
    if (branchId && branchIds && !branchIds.includes(branchId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const from = (page - 1) * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1

    let query = supabase
      .from('ar_invoices')
      .select(
        `id, entity_code, invoice_number, po_number, job_name,
         invoice_date, due_date, terms, open_balance, aging_bucket, aging_days,
         raw_class_code, row_type, invoice_status,
         branch:branches(id, name),
         customer:ar_customers(id, display_name)`,
        { count: 'exact' }
      )
      .eq('row_type', rowType === 'credit_memo' ? 'credit_memo' : 'invoice')
      .order('due_date', { ascending: true })
      .range(from, to)

    if (entityCode)  query = query.eq('entity_code', entityCode)
    if (agingBucket) query = query.eq('aging_bucket', agingBucket)
    if (customerId)  query = query.eq('customer_id', customerId)

    if (branchId) {
      query = query.eq('branch_id', branchId)
    } else if (branchIds) {
      query = query.in('branch_id', branchIds)
    }

    // Search by invoice number or customer name (customer name requires join filtering)
    if (search) {
      query = query.ilike('invoice_number', `%${search}%`)
    }

    const { data, count, error } = await query
    if (error) {
      return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 })
    }

    return NextResponse.json({
      invoices: data ?? [],
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
      pageCount: Math.ceil((count ?? 0) / PAGE_SIZE),
    })
  } catch (err) {
    console.error('AR invoices error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
