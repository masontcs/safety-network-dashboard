import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'

/**
 * Western Highways — who can see it. ADMIN ONLY (every method).
 *
 *   GET             → the current allow-list + the active users who could be added
 *   POST {userId}   → grant WH (view + upload)
 *   DELETE ?userId= → revoke it
 *
 * Two things are deliberately separate here:
 *
 *   • Reaching WH needs a wh_access row and nothing else — no role carries it (lib/wh/access.ts).
 *   • MANAGING that list is the platform admin's job, checked on `role` alone. So an admin who
 *     is not on the list still administers it, and being on the list never lets a non-admin hand
 *     it out. That is why this route uses getAccessContext + guardAdminOnly rather than
 *     getWhContext: it is an admin screen that happens to live under /api/wh.
 *
 * Every grant and revoke is audited (wh.access.grant / wh.access.revoke) — the allow-list itself
 * keeps no history, so the audit log is the record of who opened the door and when.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers — helpers below stay local.
 * NOTE: wh_access is service-role only (RLS on, no policies) and not in the generated types yet,
 * hence the narrow casts — the same pattern the WH import routes use.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

function serverError(err: unknown) {
  console.error('[api/wh/access]', err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

type GrantRow = { user_id: string; granted_by: string | null; granted_at: string }
type ProfileRow = { id: string; display_name: string | null; username: string | null; role: string; is_active: boolean }

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const [grantsRes, profilesRes, authRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from('wh_access').select('user_id, granted_by, granted_at').order('granted_at', { ascending: true }),
      supabase.from('user_profiles').select('id, display_name, username, role, is_active'),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ])
    if (grantsRes.error) throw new Error(grantsRes.error.message)
    if (profilesRes.error) throw new Error(profilesRes.error.message)

    const grants = (grantsRes.data ?? []) as GrantRow[]
    const profiles = (profilesRes.data ?? []) as unknown as ProfileRow[]
    const profileById = new Map(profiles.map((p) => [p.id, p]))
    const emailById = new Map(
      (authRes.data?.users ?? []).filter((u) => u.email).map((u) => [u.id, u.email as string]),
    )
    const nameOf = (id: string | null) => (id ? profileById.get(id)?.display_name ?? '' : '')
    const granted = new Set(grants.map((g) => g.user_id))

    return NextResponse.json({
      success: true,
      data: {
        grants: grants.map((g) => ({
          userId: g.user_id,
          displayName: nameOf(g.user_id),
          username: profileById.get(g.user_id)?.username ?? null,
          email: emailById.get(g.user_id) ?? '',
          role: profileById.get(g.user_id)?.role ?? '',
          isActive: profileById.get(g.user_id)?.is_active ?? false,
          grantedAt: g.granted_at,
          grantedByName: nameOf(g.granted_by),
        })),
        candidates: profiles
          .filter((p) => p.is_active && !granted.has(p.id))
          .map((p) => ({
            id: p.id,
            displayName: p.display_name ?? '',
            username: p.username,
            email: emailById.get(p.id) ?? '',
            role: p.role,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      },
    })
  } catch (err) {
    return serverError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    let body: { userId?: unknown }
    try {
      body = (await request.json()) as { userId?: unknown }
    } catch {
      return bad('Invalid request body.')
    }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!UUID_RE.test(userId)) return bad('Choose a person.')

    const supabase = createServiceClient()
    const [{ data: profile, error: profileErr }, existingRes] = await Promise.all([
      supabase.from('user_profiles').select('id, display_name, is_active').eq('id', userId).maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from('wh_access').select('user_id').eq('user_id', userId).maybeSingle(),
    ])
    if (profileErr) throw new Error(profileErr.message)
    if (existingRes.error) throw new Error(existingRes.error.message)

    const target = profile as { id: string; display_name: string | null; is_active: boolean } | null
    if (!target) return bad('That user does not exist.', 'NOT_FOUND', 404)
    if (!target.is_active) return bad('That user is deactivated.')

    // Already on the list: nothing to do, and nothing to audit.
    if (existingRes.data) {
      return NextResponse.json({ success: true, data: { userId, changed: false } })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('wh_access')
      .insert({ user_id: userId, granted_by: ctx.access.userId })
    if (error) throw new Error(error.message)

    await logAudit({
      userId: ctx.access.userId,
      userDisplayName: ctx.access.displayName,
      userRole: ctx.access.role,
      action: 'wh.access.grant',
      resourceType: 'wh_access',
      resourceId: userId,
      resourceLabel: target.display_name ?? undefined,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { userId, changed: true } }, { status: 201 })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const userId = (new URL(request.url).searchParams.get('userId') ?? '').trim()
    if (!UUID_RE.test(userId)) return bad('Choose a person.')

    const supabase = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingRes = await (supabase as any).from('wh_access').select('user_id').eq('user_id', userId).maybeSingle()
    if (existingRes.error) throw new Error(existingRes.error.message)
    if (!existingRes.data) return bad('That person does not have Western Highways access.', 'NOT_FOUND', 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('wh_access').delete().eq('user_id', userId)
    if (error) throw new Error(error.message)

    const { data: prof } = await supabase.from('user_profiles').select('display_name').eq('id', userId).maybeSingle()
    await logAudit({
      userId: ctx.access.userId,
      userDisplayName: ctx.access.displayName,
      userRole: ctx.access.role,
      action: 'wh.access.revoke',
      resourceType: 'wh_access',
      resourceId: userId,
      resourceLabel: (prof as { display_name: string | null } | null)?.display_name ?? undefined,
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { userId, revoked: true } })
  } catch (err) {
    return serverError(err)
  }
}
