import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { isCmrRole, type CmrRole } from '@/lib/cmr/roles'
import { logAudit, getClientIp } from '@/lib/audit/log'

/**
 * SN Cash Ledger — access grants. CONTROLLER ONLY (every method).
 *
 *   GET              → current grants + active users who could be added
 *   POST {userId, role} → grant, or change an existing grant's role
 *   DELETE ?userId=  → revoke
 *
 * Grants are explicit: nobody (admins included) reaches CMR without a row here. The last
 * Controller can't be removed or demoted, so the ledger can never be locked out from the app.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers — helpers below stay local.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

function serverError(err: unknown) {
  console.error('[api/cmr/access]', err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

type GrantRow = { user_id: string; role: CmrRole; created_by: string | null; created_at: string }
type ProfileRow = { id: string; display_name: string | null; username: string | null; is_active: boolean }

async function controllerCount(supabase: ReturnType<typeof createServiceClient>): Promise<number> {
  const { count, error } = await supabase
    .from('cmr_access')
    .select('user_id', { count: 'exact', head: true })
    .eq('role', 'controller')
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const supabase = createServiceClient()
    const [grantsRes, profilesRes, authRes] = await Promise.all([
      supabase.from('cmr_access').select('user_id, role, created_by, created_at').order('created_at', { ascending: true }),
      supabase.from('user_profiles').select('id, display_name, username, is_active'),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ])
    if (grantsRes.error) throw new Error(grantsRes.error.message)
    if (profilesRes.error) throw new Error(profilesRes.error.message)

    const grants = (grantsRes.data ?? []) as GrantRow[]
    const profiles = (profilesRes.data ?? []) as ProfileRow[]
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
          isActive: profileById.get(g.user_id)?.is_active ?? false,
          role: g.role,
          createdAt: g.created_at,
          createdByName: nameOf(g.created_by),
        })),
        candidates: profiles
          .filter((p) => p.is_active && !granted.has(p.id))
          .map((p) => ({
            id: p.id,
            displayName: p.display_name ?? '',
            username: p.username,
            email: emailById.get(p.id) ?? '',
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
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    let body: { userId?: unknown; role?: unknown }
    try {
      body = (await request.json()) as { userId?: unknown; role?: unknown }
    } catch {
      return bad('Invalid request body.')
    }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const role = body.role
    if (!UUID_RE.test(userId)) return bad('Choose a user.')
    if (!isCmrRole(role)) return bad('Role must be controller, requester or viewer.')

    const supabase = createServiceClient()
    const [{ data: profile, error: profileErr }, { data: existing, error: existingErr }] = await Promise.all([
      supabase.from('user_profiles').select('id, display_name, is_active').eq('id', userId).maybeSingle(),
      supabase.from('cmr_access').select('user_id, role').eq('user_id', userId).maybeSingle(),
    ])
    if (profileErr) throw new Error(profileErr.message)
    if (existingErr) throw new Error(existingErr.message)
    const target = profile as { id: string; display_name: string | null; is_active: boolean } | null
    if (!target) return bad('That user does not exist.', 'NOT_FOUND', 404)
    if (!target.is_active) return bad('That user is deactivated.')

    const prior = existing as { user_id: string; role: CmrRole } | null
    if (prior && prior.role === role) {
      return NextResponse.json({ success: true, data: { userId, role, changed: false } })
    }

    if (prior) {
      if (prior.role === 'controller' && role !== 'controller' && (await controllerCount(supabase)) <= 1) {
        return bad('Cash Ledger needs at least one Controller. Add another Controller first.', 'LAST_CONTROLLER', 409)
      }
      const { error } = await supabase.from('cmr_access').update({ role }).eq('user_id', userId)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('cmr_access').insert({ user_id: userId, role, created_by: ctx.userId })
      if (error) throw new Error(error.message)
    }

    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: prior ? 'cmr.access.update' : 'cmr.access.grant',
      resourceType: 'cmr_access',
      resourceId: userId,
      resourceLabel: target.display_name ?? undefined,
      metadata: { role, previousRole: prior?.role ?? null },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { userId, role, changed: true } }, { status: prior ? 200 : 201 })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const userId = (new URL(request.url).searchParams.get('userId') ?? '').trim()
    if (!UUID_RE.test(userId)) return bad('Choose a user.')

    const supabase = createServiceClient()
    const { data: existing, error: existingErr } = await supabase
      .from('cmr_access').select('user_id, role').eq('user_id', userId).maybeSingle()
    if (existingErr) throw new Error(existingErr.message)
    const prior = existing as { user_id: string; role: CmrRole } | null
    if (!prior) return bad('That user has no Cash Ledger access.', 'NOT_FOUND', 404)

    if (prior.role === 'controller' && (await controllerCount(supabase)) <= 1) {
      return bad('Cash Ledger needs at least one Controller. Add another Controller first.', 'LAST_CONTROLLER', 409)
    }

    const { error } = await supabase.from('cmr_access').delete().eq('user_id', userId)
    if (error) throw new Error(error.message)

    const { data: prof } = await supabase.from('user_profiles').select('display_name').eq('id', userId).maybeSingle()
    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.access.revoke',
      resourceType: 'cmr_access',
      resourceId: userId,
      resourceLabel: (prof as { display_name: string | null } | null)?.display_name ?? undefined,
      metadata: { previousRole: prior.role },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { userId, revoked: true } })
  } catch (err) {
    return serverError(err)
  }
}
