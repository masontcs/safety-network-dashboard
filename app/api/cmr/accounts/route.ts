import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp, type AuditAction } from '@/lib/audit/log'
import {
  compareAccounts,
  findActiveNameClash,
  parseAccountName,
  parseAccountType,
  toCmrAccount,
  type CmrAccountRow,
} from '@/lib/cmr/accounts'

/**
 * SN Cash Ledger — accounts.
 *
 *   GET                                        → every account (inactive included). ANY CMR role.
 *   POST  { name, accountType? }               → create at the end of the order. CONTROLLER.
 *   PATCH { id, name?, accountType?, active? } → rename / set type / (de)activate. CONTROLLER.
 *   (reorder lives at /api/cmr/accounts/reorder)
 *
 * There is deliberately NO DELETE: later tables reference accounts, so they're retired with
 * active = false. Every mutation is written to audit_logs with before → after.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers stay local
 * or live in lib/cmr/accounts.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLS = 'id, name, account_type, active, sort_order, created_by, created_at'

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

function serverError(err: unknown) {
  console.error('[api/cmr/accounts]', err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

const clashError = (name: string) =>
  bad(`There's already an active account named “${name}”.`, 'DUPLICATE_NAME', 409)

const isUniqueViolation = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '23505' || /duplicate key|cmr_accounts_active_name_uniq/i.test(e.message ?? ''))

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function allAccounts(supabase: ReturnType<typeof createServiceClient>): Promise<CmrAccountRow[]> {
  const { data, error } = await supabase
    .from('cmr_accounts')
    .select(COLS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as CmrAccountRow[]
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const accounts = (await allAccounts(createServiceClient())).map(toCmrAccount).sort(compareAccounts)
    return NextResponse.json({ success: true, data: { accounts, canEdit: ctx.role === 'controller' } })
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

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    const name = parseAccountName(body.name)
    if (!name.ok) return bad(name.error)
    const accountType = parseAccountType(body.accountType)
    if (!accountType.ok) return bad(accountType.error)

    const supabase = createServiceClient()
    const rows = await allAccounts(supabase)
    if (findActiveNameClash(rows, name.value)) return clashError(name.value)
    const sortOrder = rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1

    const { data, error } = await supabase
      .from('cmr_accounts')
      .insert({ name: name.value, account_type: accountType.value, active: true, sort_order: sortOrder, created_by: ctx.userId })
      .select(COLS)
      .single()
    if (isUniqueViolation(error)) return clashError(name.value)
    if (error || !data) throw new Error(error?.message ?? 'Could not create the account.')
    const row = data as CmrAccountRow

    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.account.create',
      resourceType: 'cmr_accounts',
      resourceId: row.id,
      resourceLabel: row.name,
      metadata: { after: { name: row.name, accountType: row.account_type, active: row.active, sortOrder: row.sort_order } },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { account: toCmrAccount(row) } }, { status: 201 })
  } catch (err) {
    return serverError(err)
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!UUID_RE.test(id)) return bad('Choose an account.')

    const patch: Partial<Pick<CmrAccountRow, 'name' | 'account_type' | 'active'>> = {}
    if ('name' in body) {
      const n = parseAccountName(body.name)
      if (!n.ok) return bad(n.error)
      patch.name = n.value
    }
    if ('accountType' in body) {
      const t = parseAccountType(body.accountType)
      if (!t.ok) return bad(t.error)
      patch.account_type = t.value
    }
    if ('active' in body) {
      if (typeof body.active !== 'boolean') return bad('Active must be true or false.')
      patch.active = body.active
    }
    if (!Object.keys(patch).length) return bad('Nothing to change.')

    const supabase = createServiceClient()
    const rows = await allAccounts(supabase)
    const before = rows.find((r) => r.id === id)
    if (!before) return bad('That account does not exist.', 'NOT_FOUND', 404)

    // Only keep fields that actually change.
    const changes: typeof patch = {}
    if (patch.name !== undefined && patch.name !== before.name) changes.name = patch.name
    if (patch.account_type !== undefined && patch.account_type !== before.account_type) changes.account_type = patch.account_type
    if (patch.active !== undefined && patch.active !== before.active) changes.active = patch.active
    if (!Object.keys(changes).length) {
      return NextResponse.json({ success: true, data: { account: toCmrAccount(before), changed: false } })
    }

    const after: CmrAccountRow = { ...before, ...changes }
    if (after.active) {
      const clash = findActiveNameClash(rows, after.name, id)
      if (clash) {
        return changes.active
          ? bad(`Can't reactivate — “${clash.name}” is already an active account. Rename one of them first.`, 'DUPLICATE_NAME', 409)
          : clashError(after.name)
      }
    }

    const { error } = await supabase.from('cmr_accounts').update(changes).eq('id', id)
    if (isUniqueViolation(error)) return clashError(after.name)
    if (error) throw new Error(error.message)

    // One audit entry per kind of change, each with before → after.
    const entries: { action: AuditAction; metadata: Record<string, unknown> }[] = []
    if (changes.name !== undefined) {
      entries.push({ action: 'cmr.account.rename', metadata: { before: { name: before.name }, after: { name: after.name } } })
    }
    if (changes.account_type !== undefined) {
      entries.push({ action: 'cmr.account.retype', metadata: { before: { accountType: before.account_type }, after: { accountType: after.account_type } } })
    }
    if (changes.active !== undefined) {
      entries.push({
        action: after.active ? 'cmr.account.activate' : 'cmr.account.deactivate',
        metadata: { before: { active: before.active }, after: { active: after.active } },
      })
    }
    const ip = getClientIp(request)
    for (const e of entries) {
      await logAudit({
        userId: ctx.userId,
        userDisplayName: ctx.displayName,
        userRole: `cmr:${ctx.role}`,
        action: e.action,
        resourceType: 'cmr_accounts',
        resourceId: id,
        resourceLabel: after.name,
        metadata: e.metadata,
        ipAddress: ip,
      })
    }

    return NextResponse.json({ success: true, data: { account: toCmrAccount(after), changed: true } })
  } catch (err) {
    return serverError(err)
  }
}
