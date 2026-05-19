import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

const ALLOWED_ROLES = ['admin', 'executive', 'ar_manager', 'district_manager', 'branch_manager']

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; userId: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (!ALLOWED_ROLES.includes(ctx.access.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('ar_customer_pm_assignments')
      .delete()
      .eq('customer_id', params.id)
      .eq('user_id', params.userId)

    if (error) return NextResponse.json({ error: 'Failed to remove PM' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR PM remove error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
