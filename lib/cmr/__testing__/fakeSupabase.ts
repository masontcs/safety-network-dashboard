/**
 * A tiny in-memory stand-in for the Supabase service client, for the CMR access tests.
 * Supports the query shapes lib/api/cmr.ts and the /api/cmr routes use:
 *   from(t).select(cols, {count, head}).eq(c, v).order(..).maybeSingle() / await
 *   from(t).insert(row) / .update(patch).eq(..) / .delete().eq(..)
 *   from(t).insert(row).select(..).single()   (returns the inserted row)
 *   from(t).upsert(row, {onConflict, ignoreDuplicates}).select(..)   (returns written rows)
 *   rpc(name, args)                           (handlers supplied via options.rpc)
 * Every call is recorded in `calls` so tests can assert what was (not) read or written.
 */

type Row = Record<string, unknown>

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc'
  columns?: string
  filters: [string, unknown][]
  payload?: unknown
}

export interface FakeOptions {
  /** Tables whose reads return an error (to prove callers fail closed). */
  failTables?: string[]
  authUsers?: { id: string; email?: string }[]
  /** Column defaults applied on insert, per table (e.g. a generated id). */
  defaults?: Record<string, () => Row>
  /** Unique checks run on insert/update, per table: return an error message to reject. */
  unique?: Record<string, (candidate: Row, others: Row[]) => string | null>
  /** rpc(name, args) handlers; they may mutate `tables` directly. */
  rpc?: Record<string, (args: Record<string, unknown>, tables: Record<string, Row[]>) => { message: string } | null>
}

type FakeError = { message: string; code?: string }

export function fakeSupabase(initial: Record<string, Row[]>, opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(initial).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
  )
  const calls: FakeCall[] = []

  class Query implements PromiseLike<{ data: unknown; error: FakeError | null; count?: number | null }> {
    private op: FakeCall['op'] = 'select'
    private columns = '*'
    private filters: [string, unknown][] = []
    private payload: unknown
    private head = false
    private wantCount = false
    private returning = false
    private conflict: { keys: string[]; ignore: boolean } = { keys: ['id'], ignore: false }

    constructor(private table: string) {}

    select(columns = '*', o?: { count?: string; head?: boolean }) {
      if (this.op !== 'select') { this.returning = true; return this }
      this.columns = columns
      if (o?.head) this.head = true
      if (o?.count) this.wantCount = true
      return this
    }
    eq(col: string, val: unknown) { this.filters.push([col, val]); return this }
    order() { return this }
    insert(payload: Row) { this.op = 'insert'; this.payload = payload; return this }
    upsert(payload: Row, o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      this.op = 'upsert'
      this.payload = payload
      this.conflict = { keys: (o?.onConflict ?? 'id').split(',').map((k) => k.trim()), ignore: !!o?.ignoreDuplicates }
      return this
    }
    update(payload: Row) { this.op = 'update'; this.payload = payload; return this }
    delete() { this.op = 'delete'; return this }
    maybeSingle() { return this.exec('maybe') }
    single() { return this.exec('single') }
    then<A, B>(
      onok?: ((v: { data: unknown; error: FakeError | null; count?: number | null }) => A | PromiseLike<A>) | null,
      onerr?: ((e: unknown) => B | PromiseLike<B>) | null,
    ) {
      return this.exec('many').then(onok, onerr)
    }

    private match = (r: Row) => this.filters.every(([c, v]) => r[c] === v)

    private async exec(mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: FakeError | null; count?: number | null }> {
      calls.push({ table: this.table, op: this.op, columns: this.columns, filters: [...this.filters], payload: this.payload })
      const rows = (tables[this.table] ??= [])
      if (opts.failTables?.includes(this.table)) return { data: null, error: { message: `${this.table} unavailable` } }

      if (this.op === 'upsert') {
        const row = this.payload as Row
        const hit = rows.find((r) => this.conflict.keys.every((k) => r[k] === row[k]))
        if (hit) {
          if (!this.conflict.ignore) Object.assign(hit, row)
          const out = this.conflict.ignore ? [] : [{ ...hit }]
          if (!this.returning) return { data: null, error: null }
          return { data: mode === 'many' ? out : out[0] ?? null, error: null }
        }
        // no conflict → behaves like insert
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const row = this.payload as Row
        if (this.table === 'cmr_access' && rows.some((r) => r.user_id === row.user_id)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint "cmr_access_pkey"' } }
        }
        const full: Row = {
          created_at: new Date('2026-09-15T12:00:00Z').toISOString(),
          created_by: null,
          ...(opts.defaults?.[this.table]?.() ?? {}),
          ...row,
        }
        const clash = opts.unique?.[this.table]?.(full, rows)
        if (clash) return { data: null, error: { message: clash, code: '23505' } }
        rows.push(full)
        if (!this.returning) return { data: null, error: null }
        return { data: mode === 'many' ? [{ ...full }] : { ...full }, error: null }
      }
      if (this.op === 'update') {
        const hit = rows.filter(this.match)
        for (const r of hit) {
          const next = { ...r, ...(this.payload as Row) }
          const clash = opts.unique?.[this.table]?.(next, rows.filter((o) => o !== r))
          if (clash) return { data: null, error: { message: clash, code: '23505' } }
        }
        hit.forEach((r) => Object.assign(r, this.payload as Row))
        if (!this.returning) return { data: null, error: null }
        const out = hit.map((r) => ({ ...r }))
        return { data: mode === 'many' ? out : out[0] ?? null, error: null }
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
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ table: name, op: 'rpc', filters: [], payload: args })
      const fn = opts.rpc?.[name]
      if (!fn) return { data: null, error: { message: `function ${name} does not exist` } }
      const error = fn(args, tables)
      return { data: null, error }
    },
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
