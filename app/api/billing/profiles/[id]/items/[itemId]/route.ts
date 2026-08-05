import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

const bad = (error: string, code = 'VALIDATION_ERROR', status = 400) =>
  NextResponse.json({ success: false, error, code }, { status })

/** Delete a profile-scoped custom item — blocked if it's already on a ticket line. */
export async function DELETE(_req: Request, { params }: { params: { id: string; itemId: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    // Scope the delete to THIS profile so one profile can't delete another's item.
    const { data: item } = await supabase
      .from('billing_items')
      .select('id')
      .eq('id', params.itemId)
      .eq('owner_profile_id', params.id)
      .maybeSingle()
    if (!item) return bad('Item not found', 'NOT_FOUND', 404)

    const { count } = await supabase
      .from('billing_ticket_lines')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', params.itemId)
    if ((count ?? 0) > 0) return bad('This item is already used on a ticket — it can’t be deleted.', 'CONFLICT', 409)

    const { error } = await supabase.from('billing_items').delete().eq('id', params.itemId).eq('owner_profile_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
