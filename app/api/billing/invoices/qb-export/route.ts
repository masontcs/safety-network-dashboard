import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { loadQbConfig, assembleForExport } from '@/lib/billing/qbExport'
import { buildInvoiceIif } from '@/lib/billing/quickbooksIif'

/**
 * Download one entity's issued invoices as a QuickBooks Desktop .iif for a date range.
 * Defaults to invoices not yet exported and stamps them exported on download (markExported=1)
 * so they aren't double-posted; pass includeExported=1 to re-export, markExported=0 to peek
 * without stamping.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'invoices')
    if (guard) return guard

    const url = new URL(request.url)
    const start = url.searchParams.get('start')
    const end = url.searchParams.get('end')
    const entityId = url.searchParams.get('entityId') || undefined
    const includeExported = url.searchParams.get('includeExported') === '1'
    const markExported = url.searchParams.get('markExported') !== '0'
    if (!start || !end) return NextResponse.json({ success: false, error: 'start and end dates are required' }, { status: 400 })
    if (!entityId) return NextResponse.json({ success: false, error: 'entityId is required' }, { status: 400 })

    const svc = createServiceClient()
    const cfg = await loadQbConfig(svc)
    const groups = await assembleForExport(svc, cfg, { start, end, entityId, includeExported, branchIds: ctx.access.branchIds })
    const group = groups.find((g) => g.entityId === entityId)
    if (!group || group.invoices.length === 0) {
      return NextResponse.json({ success: false, error: 'No issued invoices to export for that entity and range.', code: 'EMPTY' }, { status: 404 })
    }

    const iif = buildInvoiceIif(group.invoices, cfg)

    if (markExported) {
      const { error } = await svc.from('billing_invoices')
        .update({ qb_exported_at: new Date().toISOString(), qb_exported_by: ctx.access.userId })
        .in('id', group.invoiceIds)
      if (error) throw new Error(error.message)
    }

    const { data: ent } = await svc.from('entities').select('code').eq('id', entityId).maybeSingle()
    const code = (ent as { code: string } | null)?.code ?? 'ALL'
    const filename = `QuickBooks_${code}_${start}_to_${end}.iif`

    return new NextResponse(iif, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}
