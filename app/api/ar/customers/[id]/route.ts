import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const isExcluded = body?.isExcluded

    if (typeof isExcluded !== 'boolean') {
      return NextResponse.json({ error: 'isExcluded must be a boolean' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('ar_customers')
      .update({ is_excluded: isExcluded })
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR customer PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
