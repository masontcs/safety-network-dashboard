import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import WhAgingView from '@/components/wh/WhAgingView'
import { canViewWh, canUploadWh } from '@/lib/wh/access'
import type { WhAgingRow, WhAgingBucket } from '@/lib/wh/summary'

/**
 * Western Highways A/P aging — the current snapshot, read whole. Same shape as the A/R page,
 * with the A/P report's extra past-due days column and Bill / Vendor Credit as the open item.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'A/P Aging' }

interface ImportRow {
  id: string
  report_as_of: string | null
  source_filename: string | null
  imported_at: string | null
  imported_by: string | null
  line_count: number
  report_total_cents: number | null
  payable_total_cents: number
  reconciled: boolean
}

interface LineRow {
  id: string
  txn_date: string | null
  txn_type: string
  num: string | null
  vendor_name: string
  vendor_code: string | null
  location: string | null
  due_date: string | null
  past_due_days: number | null
  aging_bucket: string | null
  open_balance_cents: number
  payable: boolean
  is_intercompany: boolean
}

export default async function WhApPage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const svc = createServiceClient()
  const { data: profile } = await svc.from('user_profiles').select('role').eq('id', user.id).single()
  if (!profile) redirect('/login')
  const role = profile.role as Role
  if (!canViewWh(role)) redirect('/dashboard')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: importRow } = await (svc as any)
    .from('wh_ap_imports')
    .select('id, report_as_of, source_filename, imported_at, imported_by, line_count, report_total_cents, payable_total_cents, reconciled')
    .eq('is_current', true)
    .maybeSingle()
  const current = importRow as ImportRow | null

  if (!current) {
    return <WhAgingView report="ap" snapshot={null} rows={[]} canUpload={canUploadWh(role)} />
  }

  const [{ data: lineRows }, { data: importer }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any)
      .from('wh_ap_lines')
      .select('id, txn_date, txn_type, num, vendor_name, vendor_code, location, due_date, past_due_days, aging_bucket, open_balance_cents, payable, is_intercompany')
      .eq('import_id', current.id),
    current.imported_by
      ? svc.from('user_profiles').select('display_name').eq('id', current.imported_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const rows: WhAgingRow[] = ((lineRows ?? []) as LineRow[]).map((l) => ({
    id: l.id,
    txnDate: l.txn_date,
    txnType: l.txn_type,
    num: l.num,
    counterpartyName: l.vendor_name,
    counterpartyCode: l.vendor_code,
    location: l.location,
    dueDate: l.due_date,
    pastDueDays: l.past_due_days,
    agingBucket: (l.aging_bucket as WhAgingBucket | null) ?? null,
    openBalanceCents: l.open_balance_cents,
    open: l.payable,
    isIntercompany: l.is_intercompany,
  }))

  return (
    <WhAgingView
      report="ap"
      snapshot={{
        reportAsOf: current.report_as_of,
        filename: current.source_filename,
        importedAt: current.imported_at,
        importedBy: (importer as { display_name: string } | null)?.display_name ?? null,
        lineCount: current.line_count,
        reportTotalCents: current.report_total_cents,
        openTotalCents: current.payable_total_cents,
        reconciled: current.reconciled,
      }}
      rows={rows}
      canUpload={canUploadWh(role)}
    />
  )
}
