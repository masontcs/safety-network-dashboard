import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { linesToSplits, type QbInvoice, type QbKindMap, type QbConfig } from './quickbooksIif'

/**
 * Data assembly for the QuickBooks .iif export. Turns issued invoices (optionally scoped to
 * one entity / branch / date range) into the fully-formed QbInvoice[] the generator needs,
 * resolving the per-profile QuickBooks customer name, net-terms due date, per-branch class,
 * and the kind→account/item mapping from billing_qb_export_config.
 *
 * Kept separate from the route so it's straightforward to reason about and reuse.
 */

type DB = SupabaseClient<Database>

export interface QbExportConfigResolved extends QbConfig {
  defaultNetDays: number
  nameIncludesJob: boolean
  kindMap: QbKindMap
  branchClass: Record<string, string>
}

export interface QbExportFilters {
  start: string // ISO yyyy-mm-dd (inclusive, invoice_date)
  end: string // ISO yyyy-mm-dd (inclusive)
  entityId?: string
  includeExported?: boolean // default false → only not-yet-exported
  branchIds?: string[] | null // access scoping (null = all)
}

export async function loadQbConfig(svc: DB): Promise<QbExportConfigResolved> {
  const { data } = await svc.from('billing_qb_export_config').select('*').eq('id', 1).maybeSingle()
  const c = data as Database['public']['Tables']['billing_qb_export_config']['Row'] | null
  return {
    arAccount: c?.ar_account ?? 'ACCOUNTS RECEIVABLE',
    taxAccount: c?.tax_account ?? 'Sales Tax Payable',
    taxZeroMemo: c?.tax_zero_memo ?? 'NO TAX',
    taxExtra: c?.tax_extra ?? 'AUTOSTAX',
    defaultNetDays: c?.default_net_days ?? 30,
    nameIncludesJob: c?.name_includes_job ?? false,
    kindMap: (c?.kind_map as QbKindMap) ?? {},
    branchClass: (c?.branch_class as Record<string, string>) ?? {},
  }
}

/** invoice_date + net days → ISO yyyy-mm-dd (UTC-safe, date-only). */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface InvoiceRow {
  id: string; invoice_number: string; invoice_date: string; entity_id: string; branch_id: string
  profile_id: string; job_id: string; tax_cents: number
}

/** One entity's worth of export-ready invoices (plus the raw ids for stamping). */
export interface AssembledEntity {
  entityId: string
  invoiceIds: string[]
  invoices: QbInvoice[]
}

export async function assembleForExport(
  svc: DB,
  cfg: QbExportConfigResolved,
  filters: QbExportFilters,
): Promise<AssembledEntity[]> {
  let q = svc
    .from('billing_invoices')
    .select('id, invoice_number, invoice_date, entity_id, branch_id, profile_id, job_id, tax_cents')
    .eq('status', 'issued')
    .gte('invoice_date', filters.start)
    .lte('invoice_date', filters.end)
    .order('invoice_date')
    .order('invoice_number')
  if (filters.entityId) q = q.eq('entity_id', filters.entityId)
  if (!filters.includeExported) q = q.is('qb_exported_at', null)
  if (filters.branchIds && filters.branchIds.length) q = q.in('branch_id', filters.branchIds)
  const { data: invRaw, error } = await q
  if (error) throw new Error(error.message)
  const invoices = (invRaw ?? []) as InvoiceRow[]
  if (invoices.length === 0) return []

  const profileIds = [...new Set(invoices.map((i) => i.profile_id))]
  const jobIds = [...new Set(invoices.map((i) => i.job_id))]
  const invIds = invoices.map((i) => i.id)

  const [{ data: profs }, { data: jobs }, { data: terms }, { data: lineRows }] = await Promise.all([
    svc.from('billing_profiles').select('id, name, payment_term_id, billing_customers(name, default_payment_term_id)').in('id', profileIds),
    svc.from('billing_jobs').select('id, name, po_number, customer_job_number').in('id', jobIds),
    svc.from('billing_payment_terms').select('id, net_days'),
    svc.from('billing_invoice_lines').select('invoice_id, kind, amount_cents').in('invoice_id', invIds),
  ])

  const netDaysById = new Map((terms ?? []).map((t) => [t.id as string, t.net_days as number]))
  type Prof = { id: string; name: string; payment_term_id: string | null; billing_customers: { name: string; default_payment_term_id: string | null } | null }
  const profById = new Map((profs as Prof[] ?? []).map((p) => [p.id, p]))
  type Job = { id: string; name: string | null; po_number: string | null; customer_job_number: string | null }
  const jobById = new Map((jobs as Job[] ?? []).map((j) => [j.id, j]))
  const linesByInvoice = new Map<string, { kind: string; amountCents: number }[]>()
  for (const l of (lineRows ?? []) as { invoice_id: string; kind: string; amount_cents: number }[]) {
    const arr = linesByInvoice.get(l.invoice_id) ?? []
    arr.push({ kind: l.kind, amountCents: l.amount_cents })
    linesByInvoice.set(l.invoice_id, arr)
  }

  const byEntity = new Map<string, AssembledEntity>()
  for (const inv of invoices) {
    const prof = profById.get(inv.profile_id)
    const cust = prof?.billing_customers ?? null
    const baseName = cust ? `${cust.name} - ${prof!.name}` : (prof?.name ?? '')
    const job = jobById.get(inv.job_id)
    const customerName = cfg.nameIncludesJob && job?.name ? `${baseName}:${job.name}` : baseName
    const netDays =
      (prof?.payment_term_id ? netDaysById.get(prof.payment_term_id) : undefined)
      ?? (cust?.default_payment_term_id ? netDaysById.get(cust.default_payment_term_id) : undefined)
      ?? cfg.defaultNetDays
    const klass = cfg.branchClass[inv.branch_id] ?? ''
    const splits = linesToSplits(linesByInvoice.get(inv.id) ?? [], cfg.kindMap, klass)

    const qb: QbInvoice = {
      docNum: inv.invoice_number,
      date: inv.invoice_date,
      dueDate: addDaysISO(inv.invoice_date, netDays),
      customerName,
      memo: job?.name ?? '',
      poNum: job?.po_number || job?.customer_job_number || '',
      nameIsTaxable: true, // mimic the source export; QuickBooks uses item taxability regardless
      taxCents: inv.tax_cents,
      splits,
    }

    const bucket = byEntity.get(inv.entity_id) ?? { entityId: inv.entity_id, invoiceIds: [], invoices: [] }
    bucket.invoiceIds.push(inv.id)
    bucket.invoices.push(qb)
    byEntity.set(inv.entity_id, bucket)
  }

  return [...byEntity.values()]
}
