import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Field technicians. The tech-facing side of the system isn't built yet — for now
 * admins enter labor on their behalf, so this list exists mainly to exercise the
 * labor model. This data is disposable: tickets/jobs/techs get reset before launch.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // The pickers (dispatch, crew, labor) want only ACTIVE techs; the management screen
    // passes ?includeInactive=1 to see everyone and each one's active state.
    const includeInactive = new URL(request.url).searchParams.get('includeInactive') === '1'

    const supabase = createServiceClient()
    let q = supabase.from('billing_technicians').select('id, name, is_active, user_id').order('name')
    if (!includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const techs = (data ?? []) as { id: string; name: string; is_active: boolean; user_id: string | null }[]

    // Pickers get just id+name. The management view (admins) also gets each tech's login
    // status — username + email — so the office can see who can actually sign in.
    if (!includeInactive) return NextResponse.json({ success: true, data: techs.map((t) => ({ id: t.id, name: t.name })) })

    const isAdmin = ctx.access.role === 'admin'
    const usernameById = new Map<string, string | null>()
    const emailById = new Map<string, string>()
    if (isAdmin) {
      const linked = techs.map((t) => t.user_id).filter((v): v is string => !!v)
      if (linked.length) {
        const { data: profs } = await supabase.from('user_profiles').select('id, username').in('id', linked)
        for (const p of (profs ?? []) as { id: string; username: string | null }[]) usernameById.set(p.id, p.username)
        const { data: authList } = await supabase.auth.admin.listUsers()
        for (const u of authList?.users ?? []) if (u.id && u.email) emailById.set(u.id, u.email)
      }
    }

    return NextResponse.json({
      success: true,
      data: techs.map((t) => ({
        id: t.id, name: t.name, isActive: t.is_active,
        hasLogin: !!t.user_id,
        username: isAdmin && t.user_id ? (usernameById.get(t.user_id) ?? null) : null,
        email: isAdmin && t.user_id ? (emailById.get(t.user_id) ?? null) : null,
      })),
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as { name?: string }
    const name = body.name?.trim()
    if (!name) return bad('A technician name is required')

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_technicians')
      .insert({ name })
      .select('id, name')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'Failed to add technician')

    return NextResponse.json({ success: true, data })
  } catch (err) {
    return billingApiError(err)
  }
}
