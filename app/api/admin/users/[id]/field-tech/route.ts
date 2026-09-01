import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import { logAudit, getClientIp } from '@/lib/audit/log'

/**
 * Make an existing DESKTOP user also a field technician (POST), or revoke it (DELETE).
 * This is the reverse of provisioning from the Technicians page: it keeps their desktop
 * role and adds field-app access (field_access) + a linked technician record.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const { data: profile } = await supabase.from('user_profiles').select('id, display_name').eq('id', params.id).maybeSingle()
    if (!profile) return bad('User not found', 'NOT_FOUND', 404)

    // Grant field access.
    const { error: fErr } = await supabase.from('user_profiles').update({ field_access: true }).eq('id', params.id)
    if (fErr) throw new Error(fErr.message)

    // Ensure a linked technician record exists (create one named after them if not).
    const { data: existing } = await supabase.from('billing_technicians').select('id, is_active').eq('user_id', params.id).maybeSingle()
    if (existing) {
      if (!existing.is_active) await supabase.from('billing_technicians').update({ is_active: true }).eq('id', existing.id)
    } else {
      const { error: tErr } = await supabase.from('billing_technicians').insert({ name: profile.display_name, user_id: params.id, is_active: true })
      if (tErr) throw new Error(tErr.message)
    }

    await logAudit({
      userId: ctx.access.userId, userDisplayName: ctx.access.displayName, userRole: ctx.access.role,
      action: 'tech.provision_login', resourceType: 'user', resourceId: params.id, resourceLabel: profile.display_name,
      metadata: { fieldTech: true }, ipAddress: getClientIp(request),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const { data: profile } = await supabase.from('user_profiles').select('id, display_name').eq('id', params.id).maybeSingle()
    if (!profile) return bad('User not found', 'NOT_FOUND', 404)

    // Revoke field access and unlink the technician (keeps the technician record + history).
    const { error: fErr } = await supabase.from('user_profiles').update({ field_access: false }).eq('id', params.id)
    if (fErr) throw new Error(fErr.message)
    await supabase.from('billing_technicians').update({ user_id: null }).eq('user_id', params.id)

    await logAudit({
      userId: ctx.access.userId, userDisplayName: ctx.access.displayName, userRole: ctx.access.role,
      action: 'tech.reset_password', resourceType: 'user', resourceId: params.id, resourceLabel: profile.display_name,
      metadata: { fieldTechRevoked: true }, ipAddress: getClientIp(request),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
