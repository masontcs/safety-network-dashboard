import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/cmr/ap-server'
import { buildVendorSuggestions } from '@/lib/cmr/vendor-admin-server'

/**
 * SN Cash Ledger — Vendors: possible duplicates (AP Phase 3b). ADVISORY ONLY — this route never
 * writes, and nothing merges on its own: a Controller confirms each pair (POST …/merge) or
 * dismisses it (POST …/dismiss).
 *
 *   GET        → candidate pairs from the deterministic matcher (lib/cmr/vendor-suggest): each
 *                with both vendors (id, name, accounts, amount owed, spellings) and a reason.
 *   GET ?ai=1  → the same, plus the AI review (lib/ai/vendors), which annotates each pair and may
 *                add a few the rules missed. If AI is unavailable the rule-based list still returns.
 *   Dismissed pairs are never returned. CONTROLLER only.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'
// The optional AI review can take a few seconds.
export const maxDuration = 60

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const ai = new URL(request.url).searchParams.get('ai') === '1'
    const data = await buildVendorSuggestions(createServiceClient(), { ai })
    return NextResponse.json({ success: true, data })
  } catch (err) {
    return serverError(err, 'api/cmr/vendors/suggestions')
  }
}
