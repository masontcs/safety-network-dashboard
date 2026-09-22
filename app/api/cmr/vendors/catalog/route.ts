import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/cmr/ap-server'
import { vendorCatalog } from '@/lib/cmr/vendor-admin-server'

/**
 * SN Cash Ledger — Vendors: the Controller's catalog (AP Phase 3b).
 *
 *   GET → every canonical vendor (also ones with nothing open right now), each with its
 *         QuickBooks spellings (alias ids, for Split), the accounts it is in and the amount owed.
 *         CONTROLLER only — it feeds "Merge with…" and "Split"; the read-only rollup every role
 *         sees is GET /api/cmr/vendors.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const vendors = await vendorCatalog(createServiceClient())
    return NextResponse.json({ success: true, data: { vendors } })
  } catch (err) {
    return serverError(err, 'api/cmr/vendors/catalog')
  }
}
