import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Manage one technician: rename, activate/deactivate, or delete. A technician who has
 * ever been on a ticket (assigned or logged labor) can't be deleted — deactivate them
 * instead, which hides them from the pickers but keeps history intact.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as { name?: string; isActive?: boolean }
    const patch: { name?: string; is_active?: boolean } = {}
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return bad('Technician name cannot be empty')
      patch.name = name
    }
    if (body.isActive !== undefined) patch.is_active = body.isActive
    if (Object.keys(patch).length === 0) return bad('Nothing to update')

    const supabase = createServiceClient()
    const { error } = await supabase.from('billing_technicians').update(patch).eq('id', params.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    // Block delete if the tech has any history (FKs would also block it, but give a clean message).
    const [{ count: asg }, { count: lab }] = await Promise.all([
      supabase.from('billing_ticket_assignments').select('id', { count: 'exact', head: true }).eq('technician_id', params.id),
      supabase.from('billing_ticket_labor').select('id', { count: 'exact', head: true }).eq('technician_id', params.id),
    ])
    if ((asg ?? 0) > 0 || (lab ?? 0) > 0) {
      return bad('This technician has ticket history — deactivate them instead of deleting.', 'CONFLICT', 409)
    }

    const { error } = await supabase.from('billing_technicians').delete().eq('id', params.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
