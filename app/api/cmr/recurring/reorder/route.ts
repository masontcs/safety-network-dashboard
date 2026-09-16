import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'
import {
  CMR_RECURRING_COLS,
  CMR_RECURRING_SECTION_LABEL,
  compareVendors,
  parseSection,
  reorderCmrRecurringVendors,
  toCmrRecurringVendor,
  type CmrRecurringVendorRow,
} from '@/lib/cmr/recurring'

/**
 * SN Cash Ledger — reorder the vendors WITHIN one recurring section. CONTROLLER ONLY.
 *
 *   POST { section, ids: string[] }  → ids is EVERY vendor id in that section (inactive
 *                                      included) in the new order.
 *
 * The list must be exactly the section's current set — if a vendor was added or moved in
 * another tab the request is refused with 409 STALE rather than guessing. The new order is
 * written in one statement (cmr_reorder_recurring_vendors) and audited with before → after.
 * Moving a vendor to another section is a PATCH on /api/cmr/recurring, not a reorder.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return bad('Invalid request body.')
    }
    const b = (body && typeof body === 'object' ? body : {}) as { section?: unknown; ids?: unknown }
    const section = parseSection(b.section)
    if (!section.ok) return bad(section.error)
    const raw = b.ids
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every((v) => typeof v === 'string' && UUID_RE.test(v))) {
      return bad('Send the full list of vendor ids in this section, in their new order.')
    }
    const ids = raw as string[]
    if (new Set(ids).size !== ids.length) return bad('The order lists a vendor twice.')

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('cmr_recurring_vendors')
      .select(CMR_RECURRING_COLS)
      .eq('section', section.value)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    const current = ((data ?? []) as unknown as CmrRecurringVendorRow[])
      .map((r) => toCmrRecurringVendor(r, new Map()))
      .sort(compareVendors)

    const known = new Set(current.map((v) => v.id))
    if (ids.length !== current.length || !ids.every((id) => known.has(id))) {
      return bad(
        `The ${CMR_RECURRING_SECTION_LABEL[section.value]} list changed since you loaded it. Reload and try again.`,
        'STALE',
        409,
      )
    }

    const beforeIds = current.map((v) => v.id)
    const alreadyNormal = current.every((v, i) => v.sortOrder === i)
    if (alreadyNormal && beforeIds.every((id, i) => id === ids[i])) {
      return NextResponse.json({ success: true, data: { changed: false } })
    }

    await reorderCmrRecurringVendors(supabase, ids)

    const nameById = new Map(current.map((v) => [v.id, v.vendorName]))
    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.recurring.reorder',
      resourceType: 'cmr_recurring_vendors',
      resourceLabel: CMR_RECURRING_SECTION_LABEL[section.value],
      metadata: {
        section: section.value,
        before: current.map((v) => v.vendorName),
        after: ids.map((id) => nameById.get(id) ?? id),
        ids,
      },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { changed: true } })
  } catch (err) {
    console.error('[api/cmr/recurring/reorder]', err)
    const message = err instanceof Error ? err.message : 'Unexpected error.'
    return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
