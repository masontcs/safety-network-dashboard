import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { buildVendorsView, serverError } from '@/lib/cmr/ap-server'

/**
 * SN Cash Ledger — Vendors: the cross-account rollup (AP Phase 3a). READ ONLY.
 *
 *   GET → every account, each account's current A/P import, every PAYABLE line of those
 *         imports with the canonical vendor it resolves to (vendor_id), and those vendors'
 *         canonical names. ANY CMR role (Controller, Requester, Viewer) — seeing totals is not a
 *         write. A platform admin without a cmr_access grant is refused like anyone else.
 *
 * The rollup — one row per canonical vendor with its total owed across accounts (Σ bills −
 * credits), per-account subtotals and invoices — plus the account filter and the search are
 * computed in the browser from this one response (lib/cmr/vendors), like the AP page.
 *
 * There is deliberately NO write here. Merging / splitting / renaming vendors and the duplicate
 * suggestions (AP Phase 3b) live at /api/cmr/vendors/{merge,split,rename,dismiss,suggestions,
 * catalog} and are Controller-only (guardCmrController); `canManage` only tells the page whether
 * to show those controls.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/ap-server.
 */

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const view = await buildVendorsView(createServiceClient())
    // AP Phase 3b: a Controller also gets the merge / split / rename tools (their routes check again).
    return NextResponse.json({ success: true, data: { ...view, canManage: ctx.role === 'controller' } })
  } catch (err) {
    return serverError(err, 'api/cmr/vendors')
  }
}
