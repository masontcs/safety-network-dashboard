import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { guardWhAccess, guardWhUpload } from '@/lib/wh/access'
import { createServiceClient } from '@/lib/supabase/server'
import { parseWhArFile } from '@/lib/wh/ar-import'
import { WH_BUCKET_ORDER, type WhAgingBucket } from '@/lib/wh/qbo'
import type { WhImportPreview, WhImportCommitted, WhImportSampleRow } from '@/lib/wh/import-preview'
import { logAudit, getClientIp } from '@/lib/audit/log'

/**
 * Upload the Western Highways **A/R Aging Detail** export (.xlsx or .csv).
 *
 *   mode=preview (default) — parse only. Nothing is written. Returns the counts, both totals,
 *                            whether the file reconciles to its own TOTAL row, the
 *                            outside/intercompany split and a few sample rows.
 *   mode=commit            — replace the current WH A/R snapshot with this file, in one
 *                            transaction (wh_ar_replace_import), and audit it.
 *
 * Two gates before anything is read: the caller must have a session (getAccessContext → 401),
 * must be allowed to see WH (guardWhAccess → 403) and to upload (guardWhUpload → 403). A file
 * that does not parse as *this* report is refused with 400 — the A/P layout has an extra
 * column, so accepting it here would import the wrong column as the open balance.
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

    const parsed = parseWhArFile(Buffer.from(await file.arrayBuffer()))
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
    }
    const data = parsed.data

    // An explicit yyyy-mm-dd from the preview screen wins; otherwise the report's own date.
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
      if (l.receivable) openLineCount += 1
    }

    const sample: WhImportSampleRow[] = data.lines.slice(0, 8).map((l) => ({
      txnDate: l.txnDate,
      txnType: l.txnType,
      num: l.num,
      counterparty: l.customerName,
      location: l.location,
      dueDate: l.dueDate,
      agingBucket: l.agingBucket,
      openBalanceCents: l.openBalanceCents,
      isIntercompany: l.isIntercompany,
    }))

    const preview: WhImportPreview = {
      report: 'ar',
      filename: file.name,
      reportAsOf,
      reportAsOfSource: data.reportAsOf ? 'title' : 'none',
      reportAsOfEvidence: 0,
      lineCount: data.lines.length,
      typeCounts: data.typeCounts,
      sumOpenCents: data.sumOpenCents,
      reportTotalCents: data.reportTotalCents,
      reconciled: data.reconciled,
      openTotalCents: data.receivableTotalCents,
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
    const supabase = createServiceClient()

    // What this upload is about to replace, captured for the audit entry before it is gone.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: previousRow } = await (supabase as any)
      .from('wh_ar_imports')
      .select('report_as_of, source_filename, line_count')
      .eq('is_current', true)
      .maybeSingle()
    const previous = previousRow as { report_as_of: string | null; source_filename: string | null; line_count: number } | null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: importId, error } = await (supabase as any).rpc('wh_ar_replace_import', {
      p_actor: ctx.access.userId,
      p_source_filename: file.name,
      p_report_as_of: reportAsOf,
      p_report_total_cents: data.reportTotalCents,
      p_lines: data.lines.map((l) => ({
        txn_date: l.txnDate,
        txn_type: l.txnType,
        num: l.num,
        customer_name: l.customerName,
        customer_code: l.customerCode,
        location: l.location,
        due_date: l.dueDate,
        aging_bucket: l.agingBucket,
        amount_cents: l.amountCents,
        open_balance_cents: l.openBalanceCents,
      })),
    })

    if (error) {
      const message = String(error.message ?? '')
      if (message.includes('NO_LINES')) {
        return NextResponse.json({ success: false, error: 'That file has no A/R lines to import.' }, { status: 400 })
      }
      if (message.includes('BAD_LINES')) {
        return NextResponse.json({ success: false, error: 'The import payload was rejected.' }, { status: 400 })
      }
      console.error('WH A/R import failed:', error)
      return NextResponse.json({ success: false, error: 'The import could not be saved.' }, { status: 500 })
    }

    await logAudit({
      userId: ctx.access.userId,
      userDisplayName: ctx.access.displayName,
      userRole: ctx.access.role,
      action: 'wh.ar.import',
      resourceType: 'wh_ar_import',
      resourceId: typeof importId === 'string' ? importId : undefined,
      resourceLabel: file.name,
      metadata: {
        reportAsOf,
        lineCount: data.lines.length,
        reportTotalCents: data.reportTotalCents,
        sumOpenCents: data.sumOpenCents,
        receivableTotalCents: data.receivableTotalCents,
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
    console.error('WH A/R import error:', err)
    return NextResponse.json({ success: false, error: 'Import failed.' }, { status: 500 })
  }
}
