import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea, guardQbExport } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { loadQbConfig, assembleForExport } from '@/lib/billing/qbExport'

/**
 * What's available to export as of a date range: one row per entity with an invoice count
 * and total, so the export screen can offer a separate .iif download per entity.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const areaGuard = guardBillingArea(ctx.access, 'invoices')
    if (areaGuard) return areaGuard
    const capGuard = guardQbExport(ctx.access)
    if (capGuard) return capGuard

    const url = new URL(request.url)
    const start = url.searchParams.get('start')
    const end = url.searchParams.get('end')
    const includeExported = url.searchParams.get('includeExported') === '1'
    if (!start || !end) return NextResponse.json({ success: false, error: 'start and end dates are required' }, { status: 400 })

    const svc = createServiceClient()
    const cfg = await loadQbConfig(svc)
    const groups = await assembleForExport(svc, cfg, { start, end, includeExported, branchIds: ctx.access.branchIds })

    const entityIds = groups.map((g) => g.entityId)
    const nameById = new Map<string, { code: string; name: string }>()
    if (entityIds.length) {
      const { data: ents } = await svc.from('entities').select('id, code, name').in('id', entityIds)
      for (const e of (ents ?? []) as { id: string; code: string; name: string }[]) nameById.set(e.id, { code: e.code, name: e.name })
    }

    const entities = groups.map((g) => ({
      entityId: g.entityId,
      code: nameById.get(g.entityId)?.code ?? '',
      name: nameById.get(g.entityId)?.name ?? '',
      invoiceCount: g.invoiceIds.length,
      totalCents: g.details.reduce((s, d) => s + d.totalCents, 0),
      invoices: g.details, // per-invoice preview rows: number, date, qbName, branch, total, exported
    })).sort((a, b) => a.code.localeCompare(b.code))

    return NextResponse.json({ success: true, data: { start, end, includeExported, entities } })
  } catch (err) {
    return billingApiError(err)
  }
}
