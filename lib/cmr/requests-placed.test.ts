import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/lib/cmr/__testing__/fakeSupabase'
import { ID_BATCH, idBatches, placedRowStates, type Supabase } from '@/lib/cmr/requests-server'
import { unplaceRefusal, type CmrPlacedRowState, type CmrRequestRow } from '@/lib/cmr/requests'

/**
 * The placed-row lookup reads the row each PLACED request created. Those ids travel in the URL
 * (PostgREST `in.(…)`) and placed requests only accumulate, so they go in ID_BATCH-sized
 * batches — exactly like the A/P snapshot read (requestInvoiceRows). The batching may not
 * change what comes back: same rows, same order, whether the list fits in one batch or not.
 */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ACC = '50000000-0000-4000-8000-000000000001'
const WHO = '00000000-0000-4000-8000-00000000c0c0'

const PENDING_STATES = ['pending', 'paid', 'pushed'] as const
const PRIORITY_STATES = ['open', 'paid', 'resolved', 'carried'] as const

type Kind = 'pending' | 'priority'

const request = (n: number, over: Partial<CmrRequestRow> = {}): CmrRequestRow => ({
  id: U(n),
  requested_by: WHO,
  account_id: ACC,
  vendor: `VENDOR ${n}`,
  amount_cents: 100 + n,
  due_date: null,
  notes: null,
  status: 'placed',
  placed_kind: 'pending',
  placed_ref_id: U(900_000 + n),
  placed_at: '2026-09-22T12:00:00Z',
  placed_by: WHO,
  created_at: '2026-09-01T00:00:00Z',
  ...over,
})

/**
 * `count` placed requests, alternating pending / priority. Every 7th row's target has since
 * been deleted (so it comes back `{ present: false }`), and the rest cycle through the
 * statuses the undo rule cares about.
 */
function world(count: number) {
  const rows: CmrRequestRow[] = []
  const pending: Record<string, unknown>[] = []
  const priorities: Record<string, unknown>[] = []
  for (let n = 1; n <= count; n++) {
    const kind: Kind = n % 2 === 0 ? 'priority' : 'pending'
    const row = request(n, { placed_kind: kind })
    rows.push(row)
    if (n % 7 === 0) continue // the row it created is gone
    const id = row.placed_ref_id as string
    if (kind === 'pending') pending.push({ id, status: PENDING_STATES[n % PENDING_STATES.length], sort_order: n })
    else priorities.push({ id, status: PRIORITY_STATES[n % PRIORITY_STATES.length], sort_order: n })
  }
  const fake = fakeSupabase({ cmr_pending_items: pending, cmr_weekly_priorities: priorities })
  return { rows, fake }
}

/** What the lookup should say about every row, worked out straight from the tables. */
const expected = (rows: CmrRequestRow[], fake: ReturnType<typeof fakeSupabase>): [string, CmrPlacedRowState][] =>
  rows.map((r) => {
    const table = r.placed_kind === 'pending' ? fake.tables.cmr_pending_items : fake.tables.cmr_weekly_priorities
    const hit = table.find((t) => t.id === r.placed_ref_id)
    return [r.placed_ref_id as string, hit ? { present: true, status: hit.status as 'pending' } : { present: false }]
  })

/** The id lists this run sent to one table, in the order it sent them. */
const sentTo = (fake: ReturnType<typeof fakeSupabase>, table: string): string[][] =>
  fake.calls
    .filter((c) => c.table === table && c.op === 'select')
    .map((c) => (c.filters.find(([k]) => k === 'id')![1] as { in: string[] }).in)

describe('placedRowStates — batched id reads', () => {
  it('sends the ids in batches of at most ID_BATCH, covering every id once, in order', async () => {
    const { rows, fake } = world(801) // 401 pending + 400 priority — several batches of each
    await placedRowStates(fake.client as unknown as Supabase, rows)

    for (const table of ['cmr_pending_items', 'cmr_weekly_priorities']) {
      const sent = sentTo(fake, table)
      const wanted = rows.filter((r) => r.placed_kind === (table === 'cmr_pending_items' ? 'pending' : 'priority')).map((r) => r.placed_ref_id)
      expect(sent.length).toBe(Math.ceil(wanted.length / ID_BATCH))
      expect(Math.max(...sent.map((b) => b.length))).toBeLessThanOrEqual(ID_BATCH)
      expect(sent.flat()).toEqual(wanted) // every id, once, in the order the requests are in
    }
  })

  it('a list larger than one batch returns the same rows as a single read would, in the same order', async () => {
    const { rows, fake } = world(801)
    const many = await placedRowStates(fake.client as unknown as Supabase, rows)

    // Parity: every request's state is what the tables say, and nothing extra came back.
    const want = expected(rows, fake)
    expect(rows.map((r) => [r.placed_ref_id, many.get(r.placed_ref_id as string)])).toEqual(want)
    expect(many.size).toBe(new Set(rows.map((r) => r.placed_ref_id)).size)

    // And the same list read one batch at a time gives identical answers in the same order —
    // the batch boundaries are invisible to the caller.
    const merged = new Map<string, CmrPlacedRowState>()
    for (const chunk of idBatches(rows, 150)) {
      const part = await placedRowStates(fake.client as unknown as Supabase, chunk)
      for (const [k, v] of part) merged.set(k, v)
    }
    expect(rows.map((r) => merged.get(r.placed_ref_id as string))).toEqual(rows.map((r) => many.get(r.placed_ref_id as string)))

    // The undo rule the screen shows is unchanged, row for row.
    expect(rows.map((r) => unplaceRefusal(r, many.get(r.placed_ref_id as string) ?? null))).toEqual(
      want.map(([, state], i) => unplaceRefusal(rows[i], state)),
    )
  })

  it('a list that fits in one batch is still a single read per table, and nothing is read for unplaced requests', async () => {
    const { rows, fake } = world(40)
    const small = await placedRowStates(fake.client as unknown as Supabase, rows)
    expect(sentTo(fake, 'cmr_pending_items').length).toBe(1)
    expect(sentTo(fake, 'cmr_weekly_priorities').length).toBe(1)
    expect(rows.map((r) => [r.placed_ref_id, small.get(r.placed_ref_id as string)])).toEqual(expected(rows, fake))

    const queued = fakeSupabase({ cmr_pending_items: [], cmr_weekly_priorities: [] })
    const none = await placedRowStates(queued.client as unknown as Supabase, [
      request(1, { status: 'queued', placed_kind: null, placed_ref_id: null }),
      request(2, { status: 'declined', placed_kind: null, placed_ref_id: null }),
    ])
    expect(none.size).toBe(0)
    expect(queued.calls).toHaveLength(0)
  })
})

describe('idBatches', () => {
  it('cuts a list into ordered batches and leaves a short list alone', () => {
    expect(idBatches([])).toEqual([])
    expect(idBatches(['a', 'b', 'c'])).toEqual([['a', 'b', 'c']])
    const ids = Array.from({ length: 301 }, (_, i) => U(i))
    const cut = idBatches(ids)
    expect(cut.map((b) => b.length)).toEqual([150, 150, 1])
    expect(cut.flat()).toEqual(ids)
    expect(idBatches(ids, 100).map((b) => b.length)).toEqual([100, 100, 100, 1])
  })
})
