import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const entityCode = searchParams.get('entity') || null

    const supabase = createServiceClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('ar_payments')
      .select('id, entity_code, payment_date, reference_number, amount, memo, qb_customer_name')
      .eq('customer_id', params.id)
      .order('payment_date', { ascending: false })
      .limit(200)

    if (entityCode) query = query.eq('entity_code', entityCode)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 })

    return NextResponse.json({ payments: data ?? [] })
  } catch (err) {
    console.error('Customer payments GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
