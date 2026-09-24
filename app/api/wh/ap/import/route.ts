import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { guardWhAccess, guardWhUpload } from '@/lib/wh/access'
import { createServiceClient } from '@/lib/supabase/server'
import { parseWhApFile } from '@/lib/wh/ap-import'
import { WH_BUCKET_ORDER, type WhAgingBucket } from '@/lib/wh/qbo'
import type { WhImportPreview, WhImportCommitted, WhImportSampleRow } from '@/lib/wh/import-preview'
import { logAudit, getClientIp } from '@/lib/audit/log'

/**
 * Upload the Western Highways **A/P Aging Detail** export (.xlsx or .csv).
 *
 * Same contract as the A/R route (preview then commit, two gates, replace-in-one-transaction),
 * with one difference worth knowing: the A/P export carries NO title block, so it has no
 * "As of" line. The parser derives the as-of day from the data — due date + past-due days,
 * which every past-due line must agree on — and the preview shows that date, where it came
 * from and how many lines agreed, so the uploader confirms or overrides it before committing.
 * If it cannot be derived, the client must supply one.
 *
 * No SN table is touched.
 */

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const accessGuard = guardWhAccess(ctx.access.role)
    if (accessGuard) return accessGuard
    const uploadGuard = guardWhUpload(ctx.access.role)
    if (uploadGuard) return uploadGuard

    const form = await request.formData()
    const file = form.get('file')
    const mode = form.get('mode') === 'commit' ? 'commit' : 'preview'
    const asOfOverride = form.get('reportAsOf')

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'Choose a file to upload.' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, error: 'That file is empty.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'File too large (max 10MB).' }, { status: 413 })
    }

    const parsed = parseWhApFile(Buffer.from(await file.arrayBuffer()))
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
    }
    const data = parsed.data

    const override =
      typeof asOfOverride === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOfOverride)
        ? asOfOverride
        : null
    const reportAsOf = override ?? data.reportAsOf

    const buckets = Object.fromEntries(WH_BUCKET_ORDER.map((b) => [b, 0])) as Record<WhAgingBucket, number>
    let intercompanyCents = 0
    let intercompanyLineCount = 0
    let openLineCount = 0
    for (const l of data.lines) {
      if (l.agingBucket) buckets[l.agingBucket] += l.openBalanceCents
      if (l.isIntercompany) {
        intercompanyCents += l.openBalanceCents
        intercompanyLineCount += 1
      }
      if (l.payable) openLineCount += 1
    }

    const sample: WhImportSampleRow[] = data.lines.slice(0, 8).map((l) => ({
      txnDate: l.txnDate,
      txnType: l.txnType,
      num: l.num,
      counterparty: l.vendorName,
      location: l.location,
      dueDate: l.dueDate,
      agingBucket: l.agingBucket,
      openBalanceCents: l.openBalanceCents,
      isIntercompany: l.isIntercompany,
    }))

    const preview: WhImportPreview = {
      report: 'ap',
      filename: file.name,
      reportAsOf,
      reportAsOfSource: override ? 'none' : data.reportAsOfSource,
      reportAsOfEvidence: data.reportAsOfEvidence,
      lineCount: data.lines.length,
      typeCounts: data.typeCounts,
      sumOpenCents: data.sumOpenCents,
      reportTotalCents: data.reportTotalCents,
      reconciled: data.reconciled,
      openTotalCents: data.payableTotalCents,
      openLineCount,
      intercompanyCents,
      outsideCents: data.sumOpenCents - intercompanyCents,
      intercompanyLineCount,
      locations: [...new Set(data.lines.map((l) => l.location).filter((l): l is string => !!l))].sort(),
      buckets,
      sample,
    }

    if (mode === 'preview') {
      return NextResponse.json({ success: true, preview })
    }

    // ── commit ──────────────────────────────────────────────────────────────
    // The A/P export has no date of its own, so a snapshot must never be stored undated —
    // an aging with no as-of day cannot be read later.
    if (!reportAsOf) {
      return NextResponse.json(
        { success: false, error: 'This A/P export has no report date and one could not be derived — set the report date before importing.' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: previousRow } = await (supabase as any)
      .from('wh_ap_imports')
      .select('report_as_of, source_filename, line_count')
      .eq('is_current', true)
      .maybeSingle()
    const previous = previousRow as { report_as_of: string | null; source_filename: string | null; line_count: number } | null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: importId, error } = await (supabase as any).rpc('wh_ap_replace_import', {
      p_actor: ctx.access.userId,
      p_source_filename: file.name,
      p_report_as_of: reportAsOf,
      p_report_total_cents: data.reportTotalCents,
      p_lines: data.lines.map((l) => ({
        txn_date: l.txnDate,
        txn_type: l.txnType,
        num: l.num,
        vendor_name: l.vendorName,
        vendor_code: l.vendorCode,
        location: l.location,
        due_date: l.dueDate,
        past_due_days: l.pastDueDays,
        aging_bucket: l.agingBucket,
        amount_cents: l.amountCents,
        open_balance_cents: l.openBalanceCents,
      })),
    })

    if (error) {
      const message = String(error.message ?? '')
      if (message.includes('NO_LINES')) {
        return NextResponse.json({ success: false, error: 'That file has no A/P lines to import.' }, { status: 400 })
      }
      if (message.includes('BAD_LINES')) {
        return NextResponse.json({ success: false, error: 'The import payload was rejected.' }, { status: 400 })
      }
      console.error('WH A/P import failed:', error)
      return NextResponse.json({ success: false, error: 'The import could not be saved.' }, { status: 500 })
    }

    await logAudit({
      userId: ctx.access.userId,
      userDisplayName: ctx.access.displayName,
      userRole: ctx.access.role,
      action: 'wh.ap.import',
      resourceType: 'wh_ap_import',
      resourceId: typeof importId === 'string' ? importId : undefined,
      resourceLabel: file.name,
      metadata: {
        reportAsOf,
        reportAsOfSource: preview.reportAsOfSource,
        lineCount: data.lines.length,
        reportTotalCents: data.reportTotalCents,
        sumOpenCents: data.sumOpenCents,
        payableTotalCents: data.payableTotalCents,
        reconciled: data.reconciled,
        intercompanyCents,
        replaced: previous
          ? { reportAsOf: previous.report_as_of, filename: previous.source_filename, lineCount: previous.line_count }
          : null,
      },
      ipAddress: getClientIp(request),
    })

    const committed: WhImportCommitted = {
      ...preview,
      importId: typeof importId === 'string' ? importId : null,
      replaced: previous
        ? { reportAsOf: previous.report_as_of, filename: previous.source_filename, lineCount: previous.line_count }
        : null,
    }

    return NextResponse.json({ success: true, committed })
  } catch (err) {
    console.error('WH A/P import error:', err)
    return NextResponse.json({ success: false, error: 'Import failed.' }, { status: 500 })
  }
}
