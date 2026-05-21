import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const entity   = searchParams.get('entity') || null
    const dateFrom = searchParams.get('dateFrom') || null
    const dateTo   = searchParams.get('dateTo') || null
    const search   = searchParams.get('search') || null
    const page     = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = 100

    const supabase = createServiceClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ar_payments')
      .select(
        'id, entity_code, payment_date, reference_number, amount, memo, qb_customer_name, customer_id, payment_type, ar_customers!customer_id(display_name)',
        { count: 'exact' }
      )
      .order('payment_date', { ascending: false })
      .order('created_at',   { ascending: false })

    if (entity)   query = query.eq('entity_code', entity)
    if (dateFrom) query = query.gte('payment_date', dateFrom)
    if (dateTo)   query = query.lte('payment_date', dateTo)

    // Push search into the DB so pagination applies to filtered results.
    // Split into words and AND each one — "lasar const" matches "LASAR CONSTRUCTION"
    // without needing the exact full name. qb_customer_name is always populated.
    if (search) {
      const words = search.trim().split(/\s+/).filter(Boolean)
      for (const word of words) {
        query = query.ilike('qb_customer_name', `%${word}%`)
      }
    }

    // Apply pagination after all filters
    query = query.range((page - 1) * pageSize, page * pageSize - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('AR payments list error:', error)
      return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 })
    }

    type PaymentRow = {
      id: string
      entity_code: string
      payment_date: string
      reference_number: string | null
      amount: number
      memo: string | null
      qb_customer_name: string
      customer_id: string | null
      payment_type: string | null
      ar_customers: { display_name: string } | null
    }

    const payments = ((data ?? []) as PaymentRow[]).map((r) => ({
      id:               r.id,
      entity_code:      r.entity_code,
      payment_date:     r.payment_date,
      reference_number: r.reference_number,
      amount:           r.amount,
      memo:             r.memo,
      customer_name:    r.ar_customers?.display_name ?? r.qb_customer_name,
      customer_id:      r.customer_id,
      payment_type:     r.payment_type ?? 'payment',
      unmatched:        !r.customer_id,
    }))

    return NextResponse.json({
      payments,
      total: count ?? 0,
      page,
      pageSize,
    })
  } catch (err) {
    console.error('AR payments list error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
