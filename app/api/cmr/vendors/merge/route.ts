import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'
import { bad, serverError } from '@/lib/cmr/ap-server'
import {
  VendorRefused,
  idOf,
  mergeVendors,
  readJsonObject,
  vendorLineCount,
  vendorsWithAliases,
} from '@/lib/cmr/vendor-admin-server'

/**
 * SN Cash Ledger — merge two canonical vendors (AP Phase 3b). CONTROLLER only.
 *
 *   POST { targetId, sourceId } → cmr_merge_vendors: every QuickBooks spelling and A/P line of the
 *        source moves to the target (whose name is kept); the source is deleted. One transaction.
 *        Because the spellings move, re-imports keep resolving them to the target. Reversible
 *        with POST /api/cmr/vendors/split. Refusals: 400 SAME_VENDOR / VALIDATION_ERROR, 404
 *        NOT_FOUND.
 *
 * Nothing ever calls this on its own — a suggestion becomes a merge only when a Controller
 * confirms it. Payments are untouched (requests stay per-account, on their raw spellings).
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJsonObject(request)
    if (!body) return bad('Invalid request body.')
    const targetId = idOf(body.targetId)
    const sourceId = idOf(body.sourceId)
    if (!targetId || !sourceId) return bad('Choose the two vendors to merge.')
    if (targetId === sourceId) return new VendorRefused('SAME_VENDOR').response()

    const supabase = createServiceClient()
    // Read for the audit entry only (the database re-checks everything under its locks).
    const before = await vendorsWithAliases(supabase, [targetId, sourceId])
    const target = before.get(targetId)
    const source = before.get(sourceId)
    if (!target || !source) return new VendorRefused('NOT_FOUND').response()
    const linesMoved = await vendorLineCount(supabase, sourceId)

    try {
      await mergeVendors(supabase, { targetId, sourceId, actor: ctx.userId })
    } catch (e) {
      if (e instanceof VendorRefused) return e.response()
      throw e
    }

    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.vendor.merge',
      resourceType: 'cmr_vendors',
      resourceId: targetId,
      resourceLabel: target.name,
      metadata: {
        target: { id: targetId, name: target.name },
        source: { id: sourceId, name: source.name },
        aliasesMoved: source.aliases.length,
        spellingsMoved: source.aliases.map((a) => a.raw_name).sort(),
        linesRepointed: linesMoved,
      },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { vendorId: targetId, name: target.name, aliasesMoved: source.aliases.length, linesRepointed: linesMoved } })
  } catch (err) {
    return serverError(err, 'api/cmr/vendors/merge')
  }
}
