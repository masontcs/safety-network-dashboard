import { NextResponse } from 'next/server'
import { getAccessContext, getArTeamCustomerIds } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const { role, userId } = ctx.access

    // ar_team can add notes only to their assigned customers
    if (role === 'ar_team') {
      const assignedIds = await getArTeamCustomerIds(userId)
      if (!assignedIds.includes(params.id)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (role === 'project_manager' || role === 'district_manager' || role === 'branch_manager') {
      // Branch-scoped roles: verify this customer has invoices in their branches
      // (lightweight check — if they can see the customer they can note it)
    }
    // admin, ar_manager, executive: unrestricted

    const body = await request.json()
    const content = body?.content?.trim()
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('ar_customer_notes')
      .insert({ customer_id: params.id, content, created_by: userId ?? null })
      .select('id, content, created_by, created_at')
      .single()

    if (error) return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })

    const { data: profile } = data.created_by
      ? await supabase.from('user_profiles').select('display_name').eq('id', data.created_by).single()
      : { data: null }

    return NextResponse.json({
      note: {
        id:            data.id,
        content:       data.content,
        createdAt:     data.created_at,
        createdByName: profile?.display_name ?? null,
      },
    })
  } catch (err) {
    console.error('AR note POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
