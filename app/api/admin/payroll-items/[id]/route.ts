import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const { groupId } = body as { groupId: string }

    if (!groupId?.trim()) {
      return NextResponse.json(
        { success: false, error: 'groupId is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Verify group exists
    const { data: group, error: groupErr } = await supabase
      .from('payroll_item_groups')
      .select('id, name')
      .eq('id', groupId)
      .maybeSingle()

    if (groupErr) throw new Error(groupErr.message)
    if (!group) {
      return NextResponse.json(
        { success: false, error: 'Group not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const { data: updated, error: updateErr } = await supabase
      .from('payroll_items')
      .update({ group_id: groupId })
      .eq('id', params.id)
      .select('id, name, group_id, is_confirmed')
      .single()

    if (updateErr || !updated) {
      return NextResponse.json(
        { success: false, error: updateErr?.message ?? 'Item not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        groupId: updated.group_id,
        groupName: group.name,
        isConfirmed: updated.is_confirmed,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
