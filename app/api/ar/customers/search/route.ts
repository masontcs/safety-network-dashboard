import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const q         = searchParams.get('q')?.trim() ?? ''
    const excludeId = searchParams.get('excludeId') ?? null

    if (q.length < 2) return NextResponse.json({ customers: [] })

    const supabase = createServiceClient()

    let query = supabase
      .from('ar_customers')
      .select('id, display_name')
      .ilike('display_name', `%${q}%`)
      .limit(20)

    if (excludeId) query = query.neq('id', excludeId)

    const { data: customers, error } = await query
    if (error) return NextResponse.json({ error: 'Search failed' }, { status: 500 })

    const ids = (customers ?? []).map((c) => c.id as string)
    if (ids.length === 0) return NextResponse.json({ customers: [] })

    const { data: refs } = await supabase
      .from('ar_customer_entity_refs')
      .select('customer_id, entity_code, quickbooks_name')
      .in('customer_id', ids)

    const refsByCustomer = new Map<string, { entityCode: string; quickbooksName: string }[]>()
    for (const ref of refs ?? []) {
      const key = ref.customer_id as string
      if (!refsByCustomer.has(key)) refsByCustomer.set(key, [])
      refsByCustomer.get(key)!.push({ entityCode: ref.entity_code as string, quickbooksName: ref.quickbooks_name as string })
    }

    const result = (customers ?? []).map((c) => ({
      id:          c.id,
      displayName: c.display_name,
      entityRefs:  refsByCustomer.get(c.id as string) ?? [],
    }))

    return NextResponse.json({ customers: result })
  } catch (err) {
    console.error('AR customer search error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
