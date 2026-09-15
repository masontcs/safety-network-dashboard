import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'
import { compareAccounts, reorderCmrAccounts, toCmrAccount, type CmrAccountRow } from '@/lib/cmr/accounts'

/**
 * SN Cash Ledger — reorder accounts. CONTROLLER ONLY.
 *
 *   POST { ids: string[] }  → ids is EVERY account id (inactive included) in the new order.
 *
 * The list must be exactly the current set — if someone added an account in another tab the
 * request is refused with 409 STALE rather than guessing where it goes. The new order is
 * written in one statement (cmr_reorder_accounts) and audited with before → after.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return bad('Invalid request body.')
    }
    const raw = (body as { ids?: unknown } | null)?.ids
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every((v) => typeof v === 'string' && UUID_RE.test(v))) {
      return bad('Send the full list of account ids in their new order.')
    }
    const ids = raw as string[]
    if (new Set(ids).size !== ids.length) return bad('The order lists an account twice.')

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('cmr_accounts')
      .select('id, name, account_type, active, sort_order, created_by, created_at')
      .order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    const current = ((data ?? []) as CmrAccountRow[]).map(toCmrAccount).sort(compareAccounts)

    const known = new Set(current.map((a) => a.id))
    if (ids.length !== current.length || !ids.every((id) => known.has(id))) {
      return bad('The account list changed since you loaded it. Reload and try again.', 'STALE', 409)
    }

    const beforeIds = current.map((a) => a.id)
    const alreadyNormal = current.every((a, i) => a.sortOrder === i)
    if (alreadyNormal && beforeIds.every((id, i) => id === ids[i])) {
      return NextResponse.json({ success: true, data: { changed: false } })
    }

    await reorderCmrAccounts(supabase, ids)

    const nameById = new Map(current.map((a) => [a.id, a.name]))
    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.account.reorder',
      resourceType: 'cmr_accounts',
      metadata: {
        before: current.map((a) => a.name),
        after: ids.map((id) => nameById.get(id) ?? id),
        ids,
      },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { changed: true } })
  } catch (err) {
    console.error('[api/cmr/accounts/reorder]', err)
    const message = err instanceof Error ? err.message : 'Unexpected error.'
    return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
