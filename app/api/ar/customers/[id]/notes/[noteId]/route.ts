import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; noteId: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    if (typeof body?.isPinned !== 'boolean') {
      return NextResponse.json({ error: 'isPinned (boolean) is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('ar_customer_notes')
      .update({ is_pinned: body.isPinned })
      .eq('id', params.noteId)
      .eq('customer_id', params.id)

    if (error) return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR note PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; noteId: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('ar_customer_notes')
      .delete()
      .eq('id', params.noteId)
      .eq('customer_id', params.id)

    if (error) return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR note DELETE error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
