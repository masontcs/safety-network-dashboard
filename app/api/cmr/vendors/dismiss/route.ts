import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'
import { bad, serverError } from '@/lib/cmr/ap-server'
import { VendorRefused, dismissPair, idOf, readJsonObject, vendorsWithAliases } from '@/lib/cmr/vendor-admin-server'

/**
 * SN Cash Ledger — dismiss a suggested duplicate pair (AP Phase 3b). CONTROLLER only.
 *
 *   POST { vendorIdA, vendorIdB } → records the pair in cmr_vendor_merge_dismissals (stored
 *        ordered), so it is not suggested again. Idempotent. The row goes away with either vendor
 *        (e.g. when one is merged into something else). Refusals: 400 SAME_VENDOR /
 *        VALIDATION_ERROR, 404 NOT_FOUND.
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
    const x = idOf(body.vendorIdA)
    const y = idOf(body.vendorIdB)
    if (!x || !y) return bad('Choose the two vendors.')
    if (x === y) return new VendorRefused('SAME_VENDOR').response()

    const supabase = createServiceClient()
    const both = await vendorsWithAliases(supabase, [x, y])
    if (!both.has(x) || !both.has(y)) return new VendorRefused('NOT_FOUND').response()
    if (!(await dismissPair(supabase, x, y, ctx.userId))) return new VendorRefused('NOT_FOUND').response()

    const [a, b] = x < y ? [x, y] : [y, x]
    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.vendor.dismiss',
      resourceType: 'cmr_vendor_merge_dismissals',
      resourceLabel: `${both.get(a)!.name} ↔ ${both.get(b)!.name}`,
      metadata: { vendorA: { id: a, name: both.get(a)!.name }, vendorB: { id: b, name: both.get(b)!.name } },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { vendorIdA: a, vendorIdB: b } })
  } catch (err) {
    return serverError(err, 'api/cmr/vendors/dismiss')
  }
}
