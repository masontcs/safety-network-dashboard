import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { logAudit, getClientIp } from '@/lib/audit/log'

/**
 * Give a technician a real login (POST) or reset their password (PATCH). Admin-only.
 *
 * A working tech login needs three linked things (see lib/api/tech.ts): an auth user, a
 * user_profiles row with role='tech', and billing_technicians.user_id pointing at that auth
 * id. Techs get BOTH a username and a real email (they can sign in with either), and a temp
 * password they MUST change on first login (must_change_password: true; the middleware sends
 * them to /change-password, and clear-must-change-password now works for techs).
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

type SB = ReturnType<typeof createServiceClient>
async function loadTech(supabase: SB, id: string) {
  const { data } = await supabase.from('billing_technicians').select('id, name, user_id, is_active').eq('id', id).maybeSingle()
  return data as { id: string; name: string; user_id: string | null; is_active: boolean } | null
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const tech = await loadTech(supabase, params.id)
    if (!tech) return bad('Technician not found', 'NOT_FOUND', 404)
    if (tech.user_id) return bad('This technician already has a login. Use reset password instead.', 'CONFLICT', 409)

    const body = (await request.json()) as { email?: string; username?: string; temporaryPassword?: string }
    const email = body.email?.trim()
    const uname = body.username?.trim().toLowerCase() || null
    const password = body.temporaryPassword
    if (!email) return bad('An email is required')
    if (!uname || !/^[a-z0-9_]{3,20}$/.test(uname)) return bad('Username must be 3–20 chars: lowercase letters, numbers, underscore')
    if (!password || password.length < 8) return bad('A temporary password of at least 8 characters is required')

    // Username uniqueness before creating anything.
    const { data: taken } = await supabase.from('user_profiles').select('id').eq('username', uname).maybeSingle()
    if (taken) return bad(`Username "${uname}" is already taken`, 'CONFLICT', 409)

    const { data: created, error: cErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { must_change_password: true },
    })
    if (cErr) {
      const m = cErr.message?.toLowerCase() ?? ''
      if (m.includes('already') && (m.includes('registered') || m.includes('exists'))) return bad(`An account with ${email} already exists`, 'CONFLICT', 409)
      throw new Error(cErr.message)
    }
    const userId = created.user?.id
    if (!userId) throw new Error('Failed to create the auth user')

    const { error: pErr } = await supabase.from('user_profiles')
      .insert({ id: userId, role: 'tech', display_name: tech.name, username: uname, must_change_password: true })
    if (pErr) { await supabase.auth.admin.deleteUser(userId); throw new Error(pErr.message) }

    const { error: linkErr } = await supabase.from('billing_technicians').update({ user_id: userId, is_active: true }).eq('id', params.id)
    if (linkErr) { await supabase.from('user_profiles').delete().eq('id', userId); await supabase.auth.admin.deleteUser(userId); throw new Error(linkErr.message) }

    await logAudit({
      userId: ctx.access.userId, userDisplayName: ctx.access.displayName, userRole: ctx.access.role,
      action: 'tech.provision_login', resourceType: 'technician', resourceId: params.id, resourceLabel: tech.name,
      metadata: { email, username: uname }, ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { userId, username: uname, email } }, { status: 201 })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()

    const tech = await loadTech(supabase, params.id)
    if (!tech) return bad('Technician not found', 'NOT_FOUND', 404)
    if (!tech.user_id) return bad('This technician has no login yet. Create one first.', 'CONFLICT', 409)

    const body = (await request.json()) as { temporaryPassword?: string }
    const password = body.temporaryPassword
    if (!password || password.length < 8) return bad('A temporary password of at least 8 characters is required')

    const { error: uErr } = await supabase.auth.admin.updateUserById(tech.user_id, { password })
    if (uErr) throw new Error(uErr.message)
    const { error: pErr } = await supabase.from('user_profiles').update({ must_change_password: true }).eq('id', tech.user_id)
    if (pErr) throw new Error(pErr.message)

    await logAudit({
      userId: ctx.access.userId, userDisplayName: ctx.access.displayName, userRole: ctx.access.role,
      action: 'tech.reset_password', resourceType: 'technician', resourceId: params.id, resourceLabel: tech.name,
      metadata: {}, ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
