import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; contactId: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const { name, title, email, phone, isPrimary } = body

    if (name !== undefined && !name?.trim()) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    }

    const supabase = createServiceClient()
    type ContactUpdate = { name?: string; title?: string | null; email?: string | null; phone?: string | null; is_primary?: boolean }
    const update: ContactUpdate = {}
    if (name !== undefined)      update.name       = name.trim()
    if (title !== undefined)     update.title      = title?.trim() || null
    if (email !== undefined)     update.email      = email?.trim() || null
    if (phone !== undefined)     update.phone      = phone?.trim() || null
    if (isPrimary !== undefined) update.is_primary = isPrimary === true

    if (isPrimary === true) {
      await supabase.from('ar_customer_contacts').update({ is_primary: false }).eq('customer_id', params.id)
    }

    const { error } = await supabase
      .from('ar_customer_contacts')
      .update(update)
      .eq('id', params.contactId)
      .eq('customer_id', params.id)

    if (error) return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR contact PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; contactId: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('ar_customer_contacts')
      .delete()
      .eq('id', params.contactId)
      .eq('customer_id', params.id)

    if (error) return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR contact DELETE error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
