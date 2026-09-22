import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { buildApView, serverError } from '@/lib/cmr/ap-server'

/**
 * SN Cash Ledger — Accounts Payable (AP Phase 1).
 *
 *   GET → every account's CURRENT A/P snapshot: the accounts, each account's current import
 *         with its reconciliation figures (payable total, imported total vs the report's TOTAL),
 *         and every line of those imports. ANY CMR role — Requesters need it to build requests.
 *
 * `canImport` is true only for a Controller and only decides whether the Import control
 * renders; importing goes to /api/cmr/ap/import/{preview,commit}, which re-check the role.
 * The account filter, vendor grouping and totals are computed in the browser from this one
 * response (lib/cmr/ap), so switching accounts costs no round trip.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/ap-server.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const view = await buildApView(createServiceClient(), ctx.role === 'controller')
    return NextResponse.json({ success: true, data: view })
  } catch (err) {
    return serverError(err)
  }
}
