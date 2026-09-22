import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'
import { bad, serverError } from '@/lib/cmr/ap-server'
import { parseVendorName } from '@/lib/cmr/vendors'
import {
  VendorRefused,
  idOf,
  readJsonObject,
  splitVendor,
  vendorLineCount,
  vendorsWithAliases,
} from '@/lib/cmr/vendor-admin-server'

/**
 * SN Cash Ledger — split spellings off a canonical vendor (AP Phase 3b). CONTROLLER only.
 *
 *   POST { vendorId, aliasIds: string[], name } → cmr_split_vendor: a NEW vendor named `name`
 *        takes the chosen QuickBooks spellings and the vendor's A/P lines spelled that way — the
 *        reverse of a merge. Refusals: 400 BAD_ALIAS / BAD_NAME / VALIDATION_ERROR, 404
 *        NOT_FOUND, 409 WOULD_EMPTY (the vendor would keep no spelling) / NAME_TAKEN.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

const MAX_ALIASES = 500

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJsonObject(request)
    if (!body) return bad('Invalid request body.')
    const vendorId = idOf(body.vendorId)
    if (!vendorId) return bad('Choose the vendor to split.')
    if (!Array.isArray(body.aliasIds) || body.aliasIds.length === 0 || body.aliasIds.length > MAX_ALIASES) {
      return bad('Choose the QuickBooks spellings to split off.', 'BAD_ALIAS')
    }
    const aliasIds = body.aliasIds.map(idOf)
    if (aliasIds.some((a) => a === null)) return bad('Choose the QuickBooks spellings to split off.', 'BAD_ALIAS')
    const ids = [...new Set(aliasIds as string[])]
    const name = parseVendorName(body.name)
    if (!name.ok) return bad(name.error, 'BAD_NAME')

    const supabase = createServiceClient()
    const source = (await vendorsWithAliases(supabase, [vendorId])).get(vendorId)
    if (!source) return new VendorRefused('NOT_FOUND').response()

    let newId: string
    try {
      newId = await splitVendor(supabase, { sourceId: vendorId, aliasIds: ids, name: name.value, actor: ctx.userId })
    } catch (e) {
      if (e instanceof VendorRefused) return e.response()
      throw e
    }
    const linesMoved = await vendorLineCount(supabase, newId)
    const moved = source.aliases.filter((a) => ids.includes(a.id)).map((a) => a.raw_name).sort()

    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.vendor.split',
      resourceType: 'cmr_vendors',
      resourceId: newId,
      resourceLabel: name.value,
      metadata: {
        source: { id: vendorId, name: source.name },
        created: { id: newId, name: name.value },
        aliasesMoved: moved.length,
        spellingsMoved: moved,
        linesRepointed: linesMoved,
      },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { vendorId: newId, name: name.value, aliasesMoved: moved.length, linesRepointed: linesMoved } }, { status: 201 })
  } catch (err) {
    return serverError(err, 'api/cmr/vendors/split')
  }
}
