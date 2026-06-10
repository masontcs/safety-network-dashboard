import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

const AR_WRITE_ROLES = ['admin', 'executive', 'ar_manager', 'ar_team', 'office_team']

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const weekOf = searchParams.get('weekOf')
    if (!weekOf || !/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) {
      return NextResponse.json({ error: 'weekOf (YYYY-MM-DD) is required' }, { status: 400 })
    }

    const monday = getMondayOf(weekOf)
    const supabase = createServiceClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ar_promises')
      .select('id, customer_id, customer_name, amount, note, created_by, created_by_name, created_at')
      .eq('week_of', monday)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: 'Failed to load promises' }, { status: 500 })

    type PromiseRow = { id: string; amount: number }
    const total = ((data ?? []) as PromiseRow[]).reduce((s, p) => s + Number(p.amount), 0)

    return NextResponse.json({ promises: data ?? [], total, weekOf: monday })
  } catch (err) {
    console.error('AR promises GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (!AR_WRITE_ROLES.includes(ctx.access.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { customerId, customerName, weekOf, amount, note } = body as {
      customerId?: string
      customerName?: string
      weekOf?: string
      amount?: number
      note?: string
    }

    if (!customerName?.trim()) return NextResponse.json({ error: 'customerName is required' }, { status: 400 })
    if (!weekOf || !/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) return NextResponse.json({ error: 'weekOf (YYYY-MM-DD) is required' }, { status: 400 })
    if (!amount || amount <= 0) return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 })

    const monday = getMondayOf(weekOf)
    const supabase = createServiceClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('ar_promises')
      .insert({
        customer_id:     customerId ?? null,
        customer_name:   customerName.trim(),
        week_of:         monday,
        amount,
        note:            note?.trim() || null,
        created_by:      ctx.access.userId,
        created_by_name: ctx.access.displayName,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: 'Failed to save promise' }, { status: 500 })

    return NextResponse.json({ promise: data })
  } catch (err) {
    console.error('AR promises POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
