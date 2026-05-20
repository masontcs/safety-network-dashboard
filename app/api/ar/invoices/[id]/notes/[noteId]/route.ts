import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

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
      .from('ar_invoice_notes')
      .delete()
      .eq('id', params.noteId)
      .eq('invoice_id', params.id)

    if (error) return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR invoice note DELETE error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
