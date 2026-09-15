import type { createServiceClient } from '@/lib/supabase/server'

/**
 * SN Cash Ledger (CMR) accounts — shared shapes + validation for /api/cmr/accounts and the
 * Accounts screen. Dependency-free at runtime (type-only imports), so client components can
 * import it too.
 *
 * Accounts are never deleted: later tables reference them, so they're retired with
 * active = false. Names are unique among ACTIVE accounts, case-insensitively (the DB enforces
 * this with a partial unique index on lower(btrim(name)) where active).
 */

export interface CmrAccount {
  id: string
  name: string
  accountType: string | null
  active: boolean
  sortOrder: number
  createdAt: string
}

export type CmrAccountRow = {
  id: string
  name: string
  account_type: string | null
  active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
}

export const CMR_ACCOUNT_NAME_MAX = 60
export const CMR_ACCOUNT_TYPE_MAX = 40

/** Suggestions for the free-text type field — not an enforced list. */
export const CMR_ACCOUNT_TYPE_SUGGESTIONS = ['Checking', 'Operating', 'Payroll', 'Savings', 'Money Market'] as const

export const toCmrAccount = (r: CmrAccountRow): CmrAccount => ({
  id: r.id,
  name: r.name,
  accountType: r.account_type,
  active: r.active,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
})

/** List order: sort_order, then name (case-insensitive), then id for a stable tie-break. */
export function compareAccounts(a: { sortOrder: number; name: string; id: string }, b: { sortOrder: number; name: string; id: string }): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
}

/** The key the DB unique index uses: lower(btrim(name)). */
export const accountNameKey = (name: string): string => name.trim().toLowerCase()

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Trim and collapse inner runs of whitespace; 1..60 chars. */
export function parseAccountName(v: unknown): Parsed<string> {
  if (typeof v !== 'string') return { ok: false, error: 'Enter an account name.' }
  const name = v.replace(/\s+/g, ' ').trim()
  if (!name) return { ok: false, error: 'Enter an account name.' }
  if (name.length > CMR_ACCOUNT_NAME_MAX) return { ok: false, error: `Account names can be at most ${CMR_ACCOUNT_NAME_MAX} characters.` }
  return { ok: true, value: name }
}

/** Optional type: blank / null → null; otherwise trimmed, 1..40 chars. */
export function parseAccountType(v: unknown): Parsed<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'Account type must be text.' }
  const t = v.replace(/\s+/g, ' ').trim()
  if (!t) return { ok: true, value: null }
  if (t.length > CMR_ACCOUNT_TYPE_MAX) return { ok: false, error: `Account types can be at most ${CMR_ACCOUNT_TYPE_MAX} characters.` }
  return { ok: true, value: t }
}

/** A clash with an existing active account (excluding `selfId`), or null. */
export function findActiveNameClash<T extends { id: string; name: string; active: boolean }>(
  rows: T[],
  name: string,
  selfId?: string,
): T | null {
  const key = accountNameKey(name)
  return rows.find((r) => r.active && r.id !== selfId && accountNameKey(r.name) === key) ?? null
}

/**
 * Rewrite sort_order from an ordered id list in ONE statement (cmr_reorder_accounts, service
 * role only). Called as a member of the client — supabase-js rpc() needs `this`. Cast because
 * the Database `Functions` type is deliberately empty (see database.types.ts).
 */
export async function reorderCmrAccounts(supabase: ReturnType<typeof createServiceClient>, ids: string[]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = (await (supabase as any).rpc('cmr_reorder_accounts', { p_ids: ids })) as {
    error: { message: string } | null
  }
  if (error) throw new Error(error.message)
}
