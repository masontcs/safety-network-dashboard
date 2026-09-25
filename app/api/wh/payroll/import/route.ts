import { NextResponse } from 'next/server'
import { getWhContext } from '@/lib/wh/access'
import { createServiceClient } from '@/lib/supabase/server'
import { parseWhPayrollFile } from '@/lib/wh/payroll-import'
import type { WhPayrollImportPreview, WhPayrollImportCommitted } from '@/lib/wh/import-preview'
import { logAudit, getClientIp } from '@/lib/audit/log'

/**
 * Upload the Western Highways **Payroll summary by employee** export (.xls or .xlsx).
 *
 * Same two-step contract as the A/R and A/P routes — parse, show the preview, write only on an
 * explicit second call — with the one difference that defines this phase: a payroll import does
 * NOT replace "the current snapshot". It replaces (or adds) exactly ONE pay period, keyed on the
 * two dates in the report's own period line, and leaves every other period in the history
 * alone. The preview therefore names the period and says whether a period with those dates is
 * already stored, so the uploader knows which of the two is about to happen.
 *
 * The dates come from the file and are never supplied by the client: a payroll period is a fact
 * about the report, not a choice, and an operator free-typing them is how two spellings of one
 * week end up in the series. A file whose period line cannot be read is refused by the parser.
 *
 * Gated on the explicit wh_access grant, like every other /api/wh route: a platform admin or an
 * executive without a row is refused. No SN table is touched, and no WH A/R or A/P data.
 */

export const dynamic = 'force-dynamic'

const MAX_BYTES = 10 * 1024 * 1024

interface ExistingPeriodRow {
  id: string
  period_start: string
  period_end: string
  source_filename: string | null
  employee_count: number
  gross_total_cents: number
  imported_at: string | null
}

export async function POST(request: Request): Promise<Response> {
  try {
    // One gate, explicit grant only: no session → 401, no wh_access row → 403 (an admin or
    // executive who is not on the allow-list included), unreadable grant → 500. A grant covers
    // uploading, so there is no second role check.
    const ctx = await getWhContext()
    if (!ctx.ok) return ctx.response

    const form = await request.formData()
    const file = form.get('file')
    const mode = form.get('mode') === 'commit' ? 'commit' : 'preview'

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'Choose a file to upload.' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, error: 'That file is empty.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'File too large (max 10MB).' }, { status: 413 })
    }

    const parsed = parseWhPayrollFile(Buffer.from(await file.arrayBuffer()))
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
    }
    const data = parsed.data

    const supabase = createServiceClient()

    // Is this week already in the history? The answer changes what the uploader is agreeing to,
    // so it is read for the preview as well as the commit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingRow } = await (supabase as any)
      .from('wh_payroll_periods')
      .select('id, period_start, period_end, source_filename, employee_count, gross_total_cents, imported_at')
      .eq('period_start', data.periodStart)
      .eq('period_end', data.periodEnd)
      .maybeSingle()
    const existing = existingRow as ExistingPeriodRow | null

    const employees = [...data.employees]
      .sort((a, b) => b.grossCents - a.grossCents || a.name.localeCompare(b.name))
      .map((e) => ({
        name: e.name,
        isActive: e.isActive,
        hours: e.hours,
        grossCents: e.grossCents,
        taxesCents: e.taxesCents,
        netCents: e.netCents,
      }))

    const preview: WhPayrollImportPreview = {
      report: 'payroll',
      filename: file.name,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      employeeCount: data.employees.length,
      inactiveCount: data.inactiveCount,
      totalHours: data.sums.hours,
      grossTotalCents: data.sums.grossCents,
      taxesTotalCents: data.sums.taxesCents,
      adjustedGrossTotalCents: data.sums.adjustedGrossCents,
      netTotalCents: data.sums.netCents,
      reportTotals: {
        hours: data.totals.hours,
        grossCents: data.totals.grossCents,
        taxesCents: data.totals.taxesCents,
        adjustedGrossCents: data.totals.adjustedGrossCents,
        netCents: data.totals.netCents,
      },
      reconciled: data.reconciled,
      checks: data.checks,
      existingPeriod: existing
        ? {
            periodStart: existing.period_start,
            periodEnd: existing.period_end,
            filename: existing.source_filename,
            employeeCount: existing.employee_count,
            grossTotalCents: existing.gross_total_cents,
            importedAt: existing.imported_at,
          }
        : null,
      employees,
    }

    if (mode === 'preview') {
      return NextResponse.json({ success: true, preview })
    }

    // ── commit ──────────────────────────────────────────────────────────────
    // A file whose employee columns do not add up to its own Total column was not read
    // faithfully, and a payroll that misstates what was paid is worse than no payroll at all —
    // so unlike the aging imports, which store a non-reconciling snapshot and flag it, this one
    // refuses. There is no "import anyway".
    if (!data.reconciled) {
      return NextResponse.json(
        {
          success: false,
          error: `The employee columns add up to ${(data.sums.grossCents / 100).toFixed(2)} but the report's own Total column says ${(data.totals.grossCents / 100).toFixed(2)}. The file was not read correctly, so nothing was imported — send it to Mason rather than importing it.`,
        },
        { status: 400 },
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: periodId, error } = await (supabase as any).rpc('wh_payroll_replace_period', {
      p_actor: ctx.userId,
      p_source_filename: file.name,
      p_period_start: data.periodStart,
      p_period_end: data.periodEnd,
      // employee_count and the four totals are deliberately NOT sent: the function sums them
      // from the rows that land.
      p_lines: data.employees.map((e) => ({
        employee_name: e.name,
        is_active: e.isActive,
        hours: e.hours,
        gross_cents: e.grossCents,
        taxes_cents: e.taxesCents,
        net_cents: e.netCents,
        detail: e.detail,
      })),
    })

    if (error) {
      const message = String(error.message ?? '')
      if (message.includes('NO_LINES')) {
        return NextResponse.json({ success: false, error: 'That file has no employees to import.' }, { status: 400 })
      }
      if (message.includes('BAD_DATES')) {
        return NextResponse.json({ success: false, error: 'The pay period in that file is not a valid date range.' }, { status: 400 })
      }
      if (message.includes('BAD_LINES')) {
        return NextResponse.json({ success: false, error: 'The import payload was rejected.' }, { status: 400 })
      }
      console.error('WH payroll import failed:', error)
      return NextResponse.json({ success: false, error: 'The import could not be saved.' }, { status: 500 })
    }

    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: ctx.role,
      action: 'wh.payroll.import',
      resourceType: 'wh_payroll_period',
      resourceId: typeof periodId === 'string' ? periodId : undefined,
      resourceLabel: file.name,
      metadata: {
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        employeeCount: data.employees.length,
        inactiveCount: data.inactiveCount,
        totalHours: data.sums.hours,
        grossTotalCents: data.sums.grossCents,
        taxesTotalCents: data.sums.taxesCents,
        netTotalCents: data.sums.netCents,
        reconciled: data.reconciled,
        // Which of the two things happened — a week added, or a week overwritten.
        replaced: existing
          ? {
              periodStart: existing.period_start,
              periodEnd: existing.period_end,
              filename: existing.source_filename,
              employeeCount: existing.employee_count,
              grossTotalCents: existing.gross_total_cents,
            }
          : null,
      },
      ipAddress: getClientIp(request),
    })

    const committed: WhPayrollImportCommitted = {
      ...preview,
      periodId: typeof periodId === 'string' ? periodId : null,
      replacedExisting: !!existing,
    }

    return NextResponse.json({ success: true, committed })
  } catch (err) {
    console.error('WH payroll import error:', err)
    return NextResponse.json({ success: false, error: 'Import failed.' }, { status: 500 })
  }
}
