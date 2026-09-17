import { NextResponse } from 'next/server'
import type { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp, type AuditAction } from '@/lib/audit/log'
import type { CmrAccess } from '@/lib/api/cmr'
import { pacificToday } from '@/lib/utils/date'
import { weekEndSaturday, weekStartSunday } from '@/lib/cmr/week'
import {
  CMR_PRIORITY_COLS,
  comparePriorities,
  computePriorityTotals,
  toCmrPriority,
  type CmrPrioritiesView,
  type CmrPriorityLinks,
  type CmrPriorityRow,
} from '@/lib/cmr/priorities'

/**
 * Server-only helpers shared by the /api/cmr/priorities route handlers. They live here, not in
 * the route files, because a route.ts may export only HTTP handlers + route config (BUG-019).
 *
 * Nothing here checks access — every handler calls getCmrContext() + guardCmr /
 * guardCmrController BEFORE touching any of these.
 */

export type Supabase = ReturnType<typeof createServiceClient>

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function bad(error: string, code = 'VALIDATION_ERROR', status = 400): NextResponse {
  return NextResponse.json({ success: false, error, code }, { status })
}

export function serverError(where: string, err: unknown): NextResponse {
  console.error(`[api/cmr/priorities${where}]`, err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

// A DB check / foreign-key rejection is the caller's input, not a server fault.
export const isInputViolation = (e: { code?: string } | null): boolean => !!e && (e.code === '23514' || e.code === '23503')

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Every priority of one week (its Sunday), in display order. */
export async function weekRows(supabase: Supabase, weekStart: string): Promise<CmrPriorityRow[]> {
  const { data, error } = await supabase
    .from('cmr_weekly_priorities')
    .select(CMR_PRIORITY_COLS)
    .eq('week_start', weekStart)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as CmrPriorityRow[]).sort((a, b) =>
    comparePriorities(
      { sortOrder: a.sort_order, createdAt: a.created_at, id: a.id },
      { sortOrder: b.sort_order, createdAt: b.created_at, id: b.id },
    ),
  )
}

export async function priorityById(supabase: Supabase, id: string): Promise<CmrPriorityRow | null> {
  const { data, error } = await supabase.from('cmr_weekly_priorities').select(CMR_PRIORITY_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as CmrPriorityRow | null) ?? null
}

export const nextSortOrder = (rows: { sort_order: number }[]): number =>
  rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1

/** Display names for the paid stamp (unknown ids are simply absent). */
export async function displayNames(supabase: Supabase, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))]
  if (!wanted.length) return new Map()
  const { data, error } = await supabase.from('user_profiles').select('id, display_name').in('id', wanted)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { id: string; display_name: string | null }[]
  return new Map(rows.filter((r) => r.display_name).map((r) => [r.id, r.display_name as string]))
}

/**
 * Resolve both ends of every carry touching these rows: a 'carried' original → the week its
 * forward copy landed in, and a forward copy → the week it came from. Both live on OTHER rows,
 * so this is two id lookups, and only when such rows exist.
 */
export async function priorityLinks(supabase: Supabase, rows: CmrPriorityRow[]): Promise<CmrPriorityLinks> {
  const links: CmrPriorityLinks = { carriedTo: new Map(), carriedFrom: new Map() }
  const carriedIds = rows.filter((r) => r.status === 'carried').map((r) => r.id)
  const fromIds = [...new Set(rows.map((r) => r.carried_from_id).filter((x): x is string => !!x))]
  if (!carriedIds.length && !fromIds.length) return links

  type Lite = { id: string; week_start: string; carried_from_id: string | null }
  const lite = async (col: 'id' | 'carried_from_id', ids: string[]): Promise<Lite[]> => {
    if (!ids.length) return []
    const { data, error } = await supabase.from('cmr_weekly_priorities').select('id, week_start, carried_from_id').in(col, ids)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Lite[]
  }
  const [copies, sources] = await Promise.all([lite('carried_from_id', carriedIds), lite('id', fromIds)])

  for (const c of copies) if (c.carried_from_id) links.carriedTo.set(c.carried_from_id, c.week_start)
  const weekOf = new Map(sources.map((r) => [r.id, r.week_start]))
  for (const r of rows) {
    const w = r.carried_from_id ? weekOf.get(r.carried_from_id) : undefined
    if (w) links.carriedFrom.set(r.id, w)
  }
  return links
}

// ── carry (service role only) ───────────────────────────────────────────────

/** A carry the DB refused: the priority had already moved on, or it is already in that week. */
export class CarryConflict extends Error {
  constructor(readonly reason: 'NOT_FOUND' | 'NOT_OPEN' | 'SAME_WEEK') {
    super(reason)
    this.name = 'CarryConflict'
  }
}

/**
 * Copy an open priority into another week AND mark the original carried in ONE database call
 * (cmr_carry_priority), which re-checks the priority is still open while holding its row
 * locked — so it can never be carried twice or half-carried. Returns the new id.
 *
 * Called as a member of the client — supabase-js rpc() needs `this`. Cast because the Database
 * `Functions` type is deliberately empty (see database.types.ts).
 */
export async function carryPriority(
  supabase: Supabase,
  args: { priorityId: string; actorId: string; weekStart: string; sortOrder: number },
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc('cmr_carry_priority', {
    p_priority_id: args.priorityId,
    p_actor: args.actorId,
    p_week_start: args.weekStart,
    p_sort_order: args.sortOrder,
  })) as { data: unknown; error: { message: string } | null }
  if (error) {
    for (const reason of ['NOT_FOUND', 'NOT_OPEN', 'SAME_WEEK'] as const) {
      if (error.message.includes(reason)) throw new CarryConflict(reason)
    }
    throw new Error(error.message)
  }
  if (typeof data !== 'string' || !UUID_RE.test(data)) throw new Error('Carrying the priority did not return the new row.')
  return data
}

/** Everything the Weekly priorities screen needs for one week, with the derived totals. */
export async function buildPrioritiesView(supabase: Supabase, weekStart: string, canEdit: boolean): Promise<CmrPrioritiesView> {
  const rows = await weekRows(supabase, weekStart)
  const [names, links] = await Promise.all([
    displayNames(supabase, rows.map((r) => r.paid_by)),
    priorityLinks(supabase, rows),
  ])
  const priorities = rows.map((r) => toCmrPriority(r, names, links))
  const today = pacificToday()
  return {
    weekStart,
    weekEnd: weekEndSaturday(weekStart),
    today,
    thisWeekStart: weekStartSunday(today),
    priorities,
    totals: computePriorityTotals(priorities),
    canEdit,
  }
}

/** The audit snapshot of a priority's fields, in API (camelCase) terms. */
export function snapshot(r: Partial<CmrPriorityRow>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('week_start' in r) out.weekStart = r.week_start
  if ('description' in r) out.description = r.description
  if ('amount_cents' in r) out.amountCents = r.amount_cents == null ? null : Number(r.amount_cents)
  if ('due_date' in r) out.dueDate = r.due_date
  if ('notes' in r) out.notes = r.notes
  if ('is_top_priority' in r) out.isTopPriority = r.is_top_priority
  if ('status' in r) out.status = r.status
  if ('paid_at' in r) out.paidAt = r.paid_at
  if ('paid_by' in r) out.paidBy = r.paid_by
  if ('sort_order' in r) out.sortOrder = r.sort_order
  if ('carried_from_id' in r) out.carriedFromId = r.carried_from_id
  return out
}

export function pick<K extends keyof CmrPriorityRow>(r: CmrPriorityRow, keys: readonly K[]): Pick<CmrPriorityRow, K> {
  return Object.fromEntries(keys.map((k) => [k, r[k]])) as Pick<CmrPriorityRow, K>
}

export function auditor(ctx: CmrAccess, request: Request) {
  const ip = getClientIp(request)
  return (action: AuditAction, resourceId: string | undefined, resourceLabel: string, metadata: Record<string, unknown>) =>
    logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action,
      resourceType: 'cmr_weekly_priorities',
      resourceId,
      resourceLabel,
      metadata,
      ipAddress: ip,
    })
}

/** Same members, any order, no duplicates on either side. */
export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return s.size === a.length && new Set(b).size === b.length && b.every((id) => s.has(id))
}

export function parseIdList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 500) return null
  if (!v.every((x) => typeof x === 'string' && UUID_RE.test(x))) return null
  return v as string[]
}
