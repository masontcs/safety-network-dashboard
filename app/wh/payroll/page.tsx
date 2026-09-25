import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import WhPayrollView from '@/components/wh/WhPayrollView'
import { getWhPageContext, whPageRedirect } from '@/lib/wh/access'
import type { WhPayrollLineRow, WhPayrollPeriodRow } from '@/lib/wh/payroll-summary'

/**
 * Western Highways payroll — every imported pay period, newest first.
 *
 * Unlike the A/R and A/P pages, which read ONE current snapshot, this reads the whole series:
 * the periods (a row each, with their derived totals) and the lines of the period being looked
 * at. The trend across periods is built from the period rows alone, so switching weeks in the
 * picker never needs another round trip — a year of WH payroll is fifty-two rows of sixteen.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Payroll' }

interface PeriodRow {
  id: string
  period_start: string
  period_end: string
  source_filename: string | null
  imported_at: string | null
  imported_by: string | null
  employee_count: number
  total_hours: number | string
  gross_total_cents: number
  taxes_total_cents: number
  net_total_cents: number
}

interface LineRow {
  id: string
  period_id: string
  employee_name: string
  is_active: boolean
  hours: number | string
  gross_cents: number
  taxes_cents: number
  net_cents: number
}

/** A Postgres `numeric` arrives as a string over PostgREST. */
function num(v: number | string | null): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return Number.isFinite(n) ? n : 0
}

export default async function WhPayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  // Explicit wh_access grant — an admin or executive who is not on the allow-list never gets
  // here, and the layout has already applied the same gate.
  const ctx = await getWhPageContext()
  if (!ctx.ok) whPageRedirect(ctx.reason)

  const { period: requested } = await searchParams
  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: periodRows } = await (svc as any)
    .from('wh_payroll_periods')
    .select('id, period_start, period_end, source_filename, imported_at, imported_by, employee_count, total_hours, gross_total_cents, taxes_total_cents, net_total_cents')
    .order('period_end', { ascending: false })

  const rawPeriods = (periodRows ?? []) as PeriodRow[]

  if (rawPeriods.length === 0) {
    return <WhPayrollView periods={[]} selectedPeriodId={null} lines={[]} canUpload />
  }

  // The period asked for, when it exists; otherwise the newest.
  const selected = rawPeriods.find((p) => p.id === requested) ?? rawPeriods[0]

  const [{ data: lineRows }, { data: importers }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any)
      .from('wh_payroll_lines')
      .select('id, period_id, employee_name, is_active, hours, gross_cents, taxes_cents, net_cents')
      .eq('period_id', selected.id),
    svc
      .from('user_profiles')
      .select('id, display_name')
      .in('id', [...new Set(rawPeriods.map((p) => p.imported_by).filter((id): id is string => !!id))]),
  ])

  const names = new Map(
    ((importers ?? []) as { id: string; display_name: string | null }[]).map((u) => [u.id, u.display_name ?? null]),
  )

  const periods: WhPayrollPeriodRow[] = rawPeriods.map((p) => ({
    id: p.id,
    periodStart: p.period_start,
    periodEnd: p.period_end,
    sourceFilename: p.source_filename,
    importedAt: p.imported_at,
    importedBy: p.imported_by ? names.get(p.imported_by) ?? null : null,
    employeeCount: p.employee_count,
    totalHours: num(p.total_hours),
    grossTotalCents: p.gross_total_cents,
    taxesTotalCents: p.taxes_total_cents,
    netTotalCents: p.net_total_cents,
  }))

  const lines: WhPayrollLineRow[] = ((lineRows ?? []) as LineRow[]).map((l) => ({
    id: l.id,
    employeeName: l.employee_name,
    isActive: l.is_active,
    hours: num(l.hours),
    grossCents: l.gross_cents,
    taxesCents: l.taxes_cents,
    netCents: l.net_cents,
  }))

  return <WhPayrollView periods={periods} selectedPeriodId={selected.id} lines={lines} canUpload />
}
