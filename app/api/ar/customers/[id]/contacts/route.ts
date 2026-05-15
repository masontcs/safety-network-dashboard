import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const body = await request.json()
    const { name, title, email, phone, isPrimary } = body

    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const supabase = createServiceClient()

    // If marking as primary, clear existing primary first
    if (isPrimary) {
      await supabase.from('ar_customer_contacts').update({ is_primary: false }).eq('customer_id', params.id)
    }

    const { data, error } = await supabase
      .from('ar_customer_contacts')
      .insert({
        customer_id: params.id,
        name:        name.trim(),
        title:       title?.trim() || null,
        email:       email?.trim() || null,
        phone:       phone?.trim() || null,
        is_primary:  isPrimary === true,
      })
      .select('id, name, title, email, phone, is_primary, created_at')
      .single()

    if (error) return NextResponse.json({ error: 'Failed to add contact' }, { status: 500 })

    return NextResponse.json({ contact: { id: data.id, name: data.name, title: data.title, email: data.email, phone: data.phone, isPrimary: data.is_primary } })
  } catch (err) {
    console.error('AR contact POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
