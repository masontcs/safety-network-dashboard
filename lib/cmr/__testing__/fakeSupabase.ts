/**
 * A tiny in-memory stand-in for the Supabase service client, for the CMR access tests.
 * Supports the query shapes lib/api/cmr.ts and /api/cmr/access use:
 *   from(t).select(cols, {count, head}).eq(c, v).order(..).maybeSingle() / await
 *   from(t).insert(row) / .update(patch).eq(..) / .delete().eq(..)
 * Every call is recorded in `calls` so tests can assert what was (not) read or written.
 */

type Row = Record<string, unknown>

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  columns?: string
  filters: [string, unknown][]
  payload?: unknown
}

export interface FakeOptions {
  /** Tables whose reads return an error (to prove callers fail closed). */
  failTables?: string[]
  authUsers?: { id: string; email?: string }[]
}

export function fakeSupabase(initial: Record<string, Row[]>, opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(initial).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
  )
  const calls: FakeCall[] = []

  class Query implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }> {
    private op: FakeCall['op'] = 'select'
    private columns = '*'
    private filters: [string, unknown][] = []
    private payload: unknown
    private head = false
    private wantCount = false

    constructor(private table: string) {}

    select(columns = '*', o?: { count?: string; head?: boolean }) {
      this.columns = columns
      if (o?.head) this.head = true
      if (o?.count) this.wantCount = true
      return this
    }
    eq(col: string, val: unknown) { this.filters.push([col, val]); return this }
    order() { return this }
    insert(payload: Row) { this.op = 'insert'; this.payload = payload; return this }
    update(payload: Row) { this.op = 'update'; this.payload = payload; return this }
    delete() { this.op = 'delete'; return this }
    maybeSingle() { return this.exec('maybe') }
    single() { return this.exec('single') }
    then<A, B>(
      onok?: ((v: { data: unknown; error: { message: string } | null; count?: number | null }) => A | PromiseLike<A>) | null,
      onerr?: ((e: unknown) => B | PromiseLike<B>) | null,
    ) {
      return this.exec('many').then(onok, onerr)
    }

    private match = (r: Row) => this.filters.every(([c, v]) => r[c] === v)

    private async exec(mode: 'many' | 'maybe' | 'single') {
      calls.push({ table: this.table, op: this.op, columns: this.columns, filters: [...this.filters], payload: this.payload })
      const rows = (tables[this.table] ??= [])
      if (opts.failTables?.includes(this.table)) return { data: null, error: { message: `${this.table} unavailable` } }

      if (this.op === 'insert') {
        const row = this.payload as Row
        if (this.table === 'cmr_access' && rows.some((r) => r.user_id === row.user_id)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint "cmr_access_pkey"' } }
        }
        rows.push({ created_at: new Date('2026-09-15T12:00:00Z').toISOString(), created_by: null, ...row })
        return { data: null, error: null }
      }
      if (this.op === 'update') {
        rows.filter(this.match).forEach((r) => Object.assign(r, this.payload as Row))
        return { data: null, error: null }
      }
      if (this.op === 'delete') {
        tables[this.table] = rows.filter((r) => !this.match(r))
        return { data: null, error: null }
      }

      const found = rows.filter(this.match).map((r) => ({ ...r }))
      if (this.head) return { data: null, error: null, count: found.length }
      if (mode === 'many') return { data: found, error: null, count: this.wantCount ? found.length : null }
      if (found.length > 1) return { data: null, error: { message: 'multiple rows' } }
      if (found.length === 0 && mode === 'single') return { data: null, error: { message: 'no rows' } }
      return { data: found[0] ?? null, error: null }
    }
  }

  const client = {
    from: (table: string) => new Query(table),
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: opts.authUsers ?? [] }, error: null }),
      },
    },
  }

  return { client, tables, calls }
}

/** A route/server client whose session JWT resolves to `userId` (or no session). */
export function fakeRouteClient(userId: string | null) {
  return {
    auth: {
      getClaims: async () => ({ data: userId ? { claims: { sub: userId } } : null, error: null }),
    },
  }
}
