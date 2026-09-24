import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import WhAgingView from '@/components/wh/WhAgingView'
import { canViewWh, canUploadWh } from '@/lib/wh/access'
import type { WhAgingRow, WhAgingBucket } from '@/lib/wh/summary'

/**
 * Western Highways A/R aging — the current snapshot, read whole.
 *
 * The snapshot is one import's worth of rows (213 on the real export), so the page loads them
 * all once and the client component does the filtering and roll-ups. The wh_ar_* tables are
 * service-role only (RLS on, no policies), which is why this reads through the service client
 * after the gate rather than from the browser.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'A/R Aging' }

interface ImportRow {
  id: string
  report_as_of: string | null
  source_filename: string | null
  imported_at: string | null
  imported_by: string | null
  line_count: number
  report_total_cents: number | null
  receivable_total_cents: number
  reconciled: boolean
}

interface LineRow {
  id: string
  txn_date: string | null
  txn_type: string
  num: string | null
  customer_name: string
  customer_code: string | null
  location: string | null
  due_date: string | null
  aging_bucket: string | null
  open_balance_cents: number
  receivable: boolean
  is_intercompany: boolean
}

export default async function WhArPage() {
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
    .from('wh_ar_imports')
    .select('id, report_as_of, source_filename, imported_at, imported_by, line_count, report_total_cents, receivable_total_cents, reconciled')
    .eq('is_current', true)
    .maybeSingle()
  const current = importRow as ImportRow | null

  if (!current) {
    return <WhAgingView report="ar" snapshot={null} rows={[]} canUpload={canUploadWh(role)} />
  }

  const [{ data: lineRows }, { data: importer }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any)
      .from('wh_ar_lines')
      .select('id, txn_date, txn_type, num, customer_name, customer_code, location, due_date, aging_bucket, open_balance_cents, receivable, is_intercompany')
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
    counterpartyName: l.customer_name,
    counterpartyCode: l.customer_code,
    location: l.location,
    dueDate: l.due_date,
    pastDueDays: null,
    agingBucket: (l.aging_bucket as WhAgingBucket | null) ?? null,
    openBalanceCents: l.open_balance_cents,
    open: l.receivable,
    isIntercompany: l.is_intercompany,
  }))

  return (
    <WhAgingView
      report="ar"
      snapshot={{
        reportAsOf: current.report_as_of,
        filename: current.source_filename,
        importedAt: current.imported_at,
        importedBy: (importer as { display_name: string } | null)?.display_name ?? null,
        lineCount: current.line_count,
        reportTotalCents: current.report_total_cents,
        openTotalCents: current.receivable_total_cents,
        reconciled: current.reconciled,
      }}
      rows={rows}
      canUpload={canUploadWh(role)}
    />
  )
}
