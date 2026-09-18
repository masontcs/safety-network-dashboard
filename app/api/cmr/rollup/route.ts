import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { parseWeek } from '@/lib/cmr/priorities'
import { thisWeekStart } from '@/lib/cmr/week'
import { bad, buildRollupView, serverError } from '@/lib/cmr/rollup-server'

/**
 * SN Cash Ledger — the weekly rollup.
 *
 *   GET ?week=YYYY-MM-DD → the week's cash picture (every saved AM/PM snapshot with its derived
 *        (default: this week)  balance), what is pending and what the priorities still need,
 *                              and every recurring vendor's standing for the week — due,
 *                              already handled, or not yet. ANY CMR role.
 *
 * Any day resolves to its Sunday. Reading is open to Controller, Requester and Viewer alike;
 * `canEdit` is true only for a Controller, and it only decides whether the Add buttons render —
 * accepting a suggestion goes to /api/cmr/recurring/place, which re-checks the role itself.
 *
 * The account filter and the by-frequency totals are computed in the browser from this one
 * response (lib/cmr/rollup), so changing the filter costs no round trip and both sides agree.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/rollup-server.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const raw = new URL(request.url).searchParams.get('week')
    const week = raw ? parseWeek(raw) : { ok: true as const, value: thisWeekStart() }
    if (!week.ok) return bad('Choose a valid week.')

    const view = await buildRollupView(createServiceClient(), week.value, ctx.role === 'controller')
    return NextResponse.json({ success: true, data: view })
  } catch (err) {
    return serverError(err)
  }
}
