import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'
import { bad, serverError } from '@/lib/cmr/ap-server'
import { parseVendorName } from '@/lib/cmr/vendors'
import { VendorRefused, idOf, readJsonObject, renameVendor, vendorsWithAliases } from '@/lib/cmr/vendor-admin-server'

/**
 * SN Cash Ledger — rename a canonical vendor (AP Phase 3b). CONTROLLER only.
 *
 *   POST { vendorId, name } → cmr_rename_vendor: the DISPLAY name only (1–200 characters). How
 *        QuickBooks spellings match the vendor (its key and its aliases) is not touched, so the
 *        next import still links the same lines. Refusals: 400 BAD_NAME, 404 NOT_FOUND.
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
    const vendorId = idOf(body.vendorId)
    if (!vendorId) return bad('Choose the vendor to rename.')
    const name = parseVendorName(body.name)
    if (!name.ok) return bad(name.error, 'BAD_NAME')

    const supabase = createServiceClient()
    const before = (await vendorsWithAliases(supabase, [vendorId])).get(vendorId)
    if (!before) return new VendorRefused('NOT_FOUND').response()
    if (before.name === name.value) {
      return NextResponse.json({ success: true, data: { vendorId, name: name.value, changed: false } })
    }

    try {
      await renameVendor(supabase, { vendorId, name: name.value, actor: ctx.userId })
    } catch (e) {
      if (e instanceof VendorRefused) return e.response()
      throw e
    }

    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.vendor.rename',
      resourceType: 'cmr_vendors',
      resourceId: vendorId,
      resourceLabel: name.value,
      metadata: { before: { name: before.name }, after: { name: name.value } },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { vendorId, name: name.value, changed: true } })
  } catch (err) {
    return serverError(err, 'api/cmr/vendors/rename')
  }
}
