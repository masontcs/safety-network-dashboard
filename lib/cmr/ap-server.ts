import { NextResponse } from 'next/server'
import type { createServiceClient } from '@/lib/supabase/server'
import {
  CMR_AP_MAX_FILE_BYTES,
  parseCmrApWorkbook,
  type CmrApParseCode,
  type CmrApParsed,
  type CmrApParsedLine,
} from '@/lib/cmr/ap-import'
import { type CmrApAccountRef, type CmrApImport, type CmrApLine, type CmrApPickerView, type CmrApPreviewSummary, type CmrApView } from '@/lib/cmr/ap'
import { normalizeVendorName, pickerVendorGroups, type CmrVendorRef, type CmrVendorsView } from '@/lib/cmr/vendors'

/**
 * Server-only helpers for /api/cmr/ap and /api/cmr/ap/import/{preview,commit}. They live here,
 * not in the route files, because a route.ts may export only HTTP handlers + route config
 * (BUG-019).
 *
 * Nothing here checks access — every handler calls getCmrContext() and its guard first.
 */

export type Supabase = ReturnType<typeof createServiceClient>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PostgREST hands back at most 1,000 rows per request by default; lines are read in pages. */
const PAGE = 1000

export function bad(error: string, code = 'VALIDATION_ERROR', status = 400): NextResponse {
  return NextResponse.json({ success: false, error, code }, { status })
}

export function serverError(err: unknown, where = 'api/cmr/ap'): NextResponse {
  console.error(`[${where}]`, err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

// ── accounts ────────────────────────────────────────────────────────────────

export async function apAccounts(supabase: Supabase): Promise<CmrApAccountRef[]> {
  const { data, error } = await supabase
    .from('cmr_accounts')
    .select('id, name, active, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as { id: string; name: string; active: boolean; sort_order: number }[]).map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    sortOrder: r.sort_order,
  }))
}

// ── the upload ──────────────────────────────────────────────────────────────

export interface ApUpload {
  bytes: Uint8Array
  fileName: string
  accountId: string
  /** Commit only: what the Preview showed, so a different file can't slip in between. */
  expectedLineCount: number | null
  expectedReportTotalCents: number | null
}

/** A display-safe file name: no path, no control characters, at most 255 characters. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const t = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return t.slice(0, 255)
}

const optInt = (v: FormDataEntryValue | null): number | null | 'bad' => {
  if (v === null || v === '') return null
  if (typeof v !== 'string' || !/^-?\d{1,15}$/.test(v.trim())) return 'bad'
  return Number(v.trim())
}

/**
 * Read and check the multipart body both import steps share: an `accountId` and one `.xlsx`
 * `file`. Returns the refusal response when anything is wrong. The workbook itself is parsed by
 * the caller (after the account is checked).
 */
export async function readApUpload(request: Request): Promise<{ ok: true; value: ApUpload } | { ok: false; response: NextResponse }> {
  const fail = (error: string, code = 'VALIDATION_ERROR', status = 400) => ({ ok: false as const, response: bad(error, code, status) })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('Send the report as a file upload.')
  }

  const accountId = typeof form.get('accountId') === 'string' ? String(form.get('accountId')).trim() : ''
  if (!UUID_RE.test(accountId)) return fail('Choose an account.')

  const file = form.get('file')
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
    return fail('Choose the A/P Aging Detail .xlsx file to import.')
  }
  const blob = file as File
  const fileName = cleanFileName(typeof blob.name === 'string' ? blob.name : '')
  if (!/\.xlsx$/i.test(fileName)) {
    return fail('Upload the report as an Excel .xlsx file (QuickBooks: Excel → Create New Worksheet).', 'NOT_XLSX')
  }
  if (blob.size === 0) return fail('That file is empty.', 'NOT_XLSX')
  if (blob.size > CMR_AP_MAX_FILE_BYTES) return fail('That file is larger than 10 MB — it is not a daily A/P aging report.', 'TOO_LARGE', 413)

  const bytes = new Uint8Array(await blob.arrayBuffer())
  // An .xlsx is a zip archive: it always starts "PK\x03\x04".
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return fail('That file is not an Excel .xlsx workbook.', 'NOT_XLSX')
  }

  const expectedLineCount = optInt(form.get('expectedLineCount'))
  const expectedReportTotalCents = optInt(form.get('expectedReportTotalCents'))
  if (expectedLineCount === 'bad' || expectedReportTotalCents === 'bad') return fail('Invalid preview figures.')

  return { ok: true, value: { bytes, fileName, accountId, expectedLineCount, expectedReportTotalCents } }
}

/** The account an upload is for — it must exist and be active. */
export async function importAccount(
  supabase: Supabase,
  accountId: string,
): Promise<{ ok: true; value: CmrApAccountRef } | { ok: false; response: NextResponse }> {
  const account = (await apAccounts(supabase)).find((a) => a.id === accountId)
  if (!account) return { ok: false, response: bad('That account does not exist.', 'NOT_FOUND', 404) }
  if (!account.active) {
    return { ok: false, response: bad(`${account.name} is inactive. Reactivate it before importing its AP.`, 'ACCOUNT_INACTIVE', 409) }
  }
  return { ok: true, value: account }
}

const PARSE_STATUS: Record<CmrApParseCode, number> = {
  NOT_AP_AGING: 400,
  NO_TOTAL: 400,
  BAD_ROW: 400,
  TOO_MANY_LINES: 413,
  UNREADABLE: 400,
}

export function parseApUpload(bytes: Uint8Array): { ok: true; value: CmrApParsed } | { ok: false; response: NextResponse } {
  const r = parseCmrApWorkbook(bytes)
  if (!r.ok) return { ok: false, response: bad(r.error, r.code, PARSE_STATUS[r.code]) }
  return { ok: true, value: r.value }
}

// ── the current snapshot ────────────────────────────────────────────────────

export type CmrApImportRow = {
  id: string
  account_id: string
  source_filename: string | null
  report_total_cents: number | string | null
  payable_total_cents: number | string | null
  line_count: number
  imported_by: string | null
  imported_at: string
  is_current: boolean
}

export type CmrApLineRow = {
  id: string
  import_id: string
  account_id: string
  vendor_name: string
  invoice_num: string | null
  doc_type: string
  bill_date: string | null
  due_date: string | null
  aging_days: number | null
  aging_bucket: string | null
  open_balance_cents: number | string
  payable: boolean
  /** AP Phase 3a — the canonical vendor (cmr_vendors); absent in rows read before it existed. */
  vendor_id?: string | null
}

export const CMR_AP_IMPORT_COLS =
  'id, account_id, source_filename, report_total_cents, payable_total_cents, line_count, imported_by, imported_at, is_current'
export const CMR_AP_LINE_COLS =
  'id, import_id, account_id, vendor_name, invoice_num, doc_type, bill_date, due_date, aging_days, aging_bucket, open_balance_cents, payable, vendor_id'

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

export async function currentImports(supabase: Supabase, accountId?: string): Promise<CmrApImportRow[]> {
  let q = supabase.from('cmr_ap_imports').select(CMR_AP_IMPORT_COLS).eq('is_current', true)
  if (accountId) q = q.eq('account_id', accountId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as CmrApImportRow[]
}

async function linesOf(supabase: Supabase, importIds: string[]): Promise<CmrApLineRow[]> {
  if (!importIds.length) return []
  const out: CmrApLineRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('cmr_ap_lines')
      .select(CMR_AP_LINE_COLS)
      .in('import_id', importIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as CmrApLineRow[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

async function displayNames(supabase: Supabase, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  const { data, error } = await supabase.from('user_profiles').select('id, display_name').in('id', unique)
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as { id: string; display_name: string | null }[]).map((r) => [r.id, r.display_name ?? '']))
}

export const toCmrApLine = (r: CmrApLineRow): CmrApLine => ({
  id: r.id,
  importId: r.import_id,
  accountId: r.account_id,
  vendorName: r.vendor_name,
  invoiceNum: r.invoice_num,
  docType: r.doc_type,
  billDate: r.bill_date,
  dueDate: r.due_date,
  agingDays: r.aging_days,
  agingBucket: r.aging_bucket,
  openBalanceCents: num(r.open_balance_cents),
  payable: r.payable,
  vendorId: r.vendor_id ?? null,
})

/** Every account's current AP snapshot, with each import's reconciliation computed from its lines. */
export async function buildApView(supabase: Supabase, canImport: boolean): Promise<CmrApView> {
  const [accounts, importRows] = await Promise.all([apAccounts(supabase), currentImports(supabase)])
  const [lineRows, names] = await Promise.all([
    linesOf(supabase, importRows.map((i) => i.id)),
    displayNames(supabase, importRows.map((i) => i.imported_by).filter((v): v is string => !!v)),
  ])
  const lines = lineRows.map(toCmrApLine)

  const perImport = new Map<string, { total: number; count: number; payableLines: number; vendors: Set<string> }>()
  for (const l of lines) {
    let s = perImport.get(l.importId)
    if (!s) { s = { total: 0, count: 0, payableLines: 0, vendors: new Set() }; perImport.set(l.importId, s) }
    s.total += l.openBalanceCents
    s.count++
    if (l.payable) { s.payableLines++; s.vendors.add(l.vendorName) }
  }

  const order = new Map(accounts.map((a) => [a.id, a.sortOrder]))
  const imports: CmrApImport[] = importRows
    .map((r) => {
      const s = perImport.get(r.id)
      const importedTotalCents = s?.total ?? 0
      const reportTotalCents = num(r.report_total_cents)
      return {
        id: r.id,
        accountId: r.account_id,
        sourceFilename: r.source_filename,
        reportTotalCents,
        payableTotalCents: num(r.payable_total_cents),
        importedTotalCents,
        lineCount: r.line_count,
        payableLineCount: s?.payableLines ?? 0,
        vendorCount: s?.vendors.size ?? 0,
        importedAt: r.imported_at,
        importedByName: r.imported_by ? names.get(r.imported_by) || null : null,
        // A stored line count that disagrees with the lines present also fails reconciliation.
        reconciled: importedTotalCents === reportTotalCents && (s?.count ?? 0) === r.line_count,
      }
    })
    .sort((a, b) => (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0))

  return { accounts, imports, lines, canImport }
}

/** What a Preview says the commit will replace, for the confirm step. */
export async function replacedSummary(
  supabase: Supabase,
  accountId: string,
): Promise<{ importId: string; importedAt: string; sourceFilename: string | null; lineCount: number; payableTotalCents: number; importedByName: string | null } | null> {
  const [row] = await currentImports(supabase, accountId)
  if (!row) return null
  const names = await displayNames(supabase, row.imported_by ? [row.imported_by] : [])
  return {
    importId: row.id,
    importedAt: row.imported_at,
    sourceFilename: row.source_filename,
    lineCount: row.line_count,
    payableTotalCents: num(row.payable_total_cents),
    importedByName: row.imported_by ? names.get(row.imported_by) || null : null,
  }
}

// ── preview figures ─────────────────────────────────────────────────────────


export function previewSummary(p: CmrApParsed, sample = 8): CmrApPreviewSummary {
  const byVendor = new Map<string, { owedCents: number; lineCount: number }>()
  for (const l of p.lines) {
    if (!l.payable) continue
    const v = byVendor.get(l.vendorName) ?? { owedCents: 0, lineCount: 0 }
    v.owedCents += l.openBalanceCents
    v.lineCount++
    byVendor.set(l.vendorName, v)
  }
  const sampleVendors = [...byVendor.entries()]
    .map(([vendorName, v]) => ({ vendorName, ...v }))
    .sort((a, b) => b.owedCents - a.owedCents || a.vendorName.localeCompare(b.vendorName))
    .slice(0, sample)
  return {
    lineCount: p.lineCount,
    payableLineCount: p.payableLineCount,
    vendorCount: p.vendorCount,
    payableVendorCount: p.payableVendorCount,
    docTypeCounts: p.docTypeCounts,
    reportTotalCents: p.reportTotalCents,
    importedTotalCents: p.importedTotalCents,
    payableTotalCents: p.payableTotalCents,
    differenceCents: p.importedTotalCents - p.reportTotalCents,
    reconciled: p.reconciled,
    sampleVendors,
  }
}

// ── commit ──────────────────────────────────────────────────────────────────

/** The JSON array cmr_ap_replace_import reads (snake_case; payable is derived by the database). */
export const toReplaceLines = (lines: CmrApParsedLine[]) =>
  lines.map((l) => ({
    vendor_name: l.vendorName,
    invoice_num: l.invoiceNum,
    doc_type: l.docType,
    bill_date: l.billDate,
    due_date: l.dueDate,
    aging_days: l.agingDays,
    aging_bucket: l.agingBucket,
    open_balance_cents: l.openBalanceCents,
  }))

export class ApReplaceRefused extends Error {
  constructor(public code: 'NOT_FOUND' | 'INACTIVE', message: string) {
    super(message)
  }
}

/**
 * Replace the account's snapshot in ONE database transaction (cmr_ap_replace_import): the old
 * current import and its lines go, the new import and its lines land, or nothing changes.
 * Called as a member of the client — supabase-js rpc() needs `this`; cast because the Database
 * `Functions` type is deliberately empty (see database.types.ts).
 */
export async function replaceApImport(
  supabase: Supabase,
  args: { accountId: string; actor: string; fileName: string; reportTotalCents: number; lines: CmrApParsedLine[] },
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc('cmr_ap_replace_import', {
    p_account_id: args.accountId,
    p_actor: args.actor,
    p_source_filename: args.fileName,
    p_report_total_cents: args.reportTotalCents,
    p_lines: toReplaceLines(args.lines),
  })) as { data: unknown; error: { message: string } | null }
  if (error) {
    if (/\bNOT_FOUND\b/.test(error.message)) throw new ApReplaceRefused('NOT_FOUND', 'That account does not exist.')
    if (/\bINACTIVE\b/.test(error.message)) throw new ApReplaceRefused('INACTIVE', 'That account is inactive. Reactivate it before importing its AP.')
    throw new Error(error.message)
  }
  if (typeof data !== 'string' || !UUID_RE.test(data)) throw new Error('The import did not return its id.')
  return data
}

// ── AP Phase 2: current lines for the request picker and the compose pre-check ─

/**
 * The lines of the CURRENT import of each account in `accountIds` — payable only by default,
 * and only one vendor's when `vendorName` is given (exact QuickBooks spelling). Paged.
 */
export async function currentApLines(
  supabase: Supabase,
  accountIds: string[],
  opts: { payableOnly?: boolean; vendorName?: string } = {},
): Promise<CmrApLine[]> {
  const ids = [...new Set(accountIds)]
  if (!ids.length) return []
  const { data: imps, error: impErr } = await supabase
    .from('cmr_ap_imports')
    .select('id')
    .eq('is_current', true)
    .in('account_id', ids)
  if (impErr) throw new Error(impErr.message)
  const importIds = ((imps ?? []) as { id: string }[]).map((r) => r.id)
  if (!importIds.length) return []
  const out: CmrApLineRow[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('cmr_ap_lines').select(CMR_AP_LINE_COLS).in('import_id', importIds)
    if (opts.payableOnly !== false) q = q.eq('payable', true)
    if (opts.vendorName !== undefined) q = q.eq('vendor_name', opts.vendorName)
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as CmrApLineRow[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out.map(toCmrApLine)
}

/** One account's vendors and payable lines for the request picker. */
export async function buildApPicker(supabase: Supabase, account: CmrApAccountRef): Promise<CmrApPickerView> {
  const [imp] = await currentImports(supabase, account.id)
  if (!imp) return { account, import: null, vendors: [] }
  const lines = await currentApLines(supabase, [account.id])
  return {
    account,
    import: { id: imp.id, importedAt: imp.imported_at, sourceFilename: imp.source_filename },
    // A–Z by canonical name: the requester is looking a vendor up by name. Grouped by canonical
    // vendor (AP Phase 3a); each group keeps the raw QuickBooks spelling a request matches on.
    vendors: pickerVendorGroups(lines, account, await vendorRefs(supabase, lines.map((l) => l.vendorId))),
  }
}

// ── AP Phase 3a: canonical vendors ──────────────────────────────────────────

/** Ids per `in.()` filter — keeps each request URL well under PostgREST's limit (AP Phase 2 lesson). */
const IN_CHUNK = 150

/** The canonical names of the given vendor ids (nulls ignored), read in batches. */
export async function vendorRefs(supabase: Supabase, ids: (string | null)[]): Promise<CmrVendorRef[]> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))]
  const out: CmrVendorRef[] = []
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('cmr_vendors')
      .select('id, canonical_name')
      .in('id', unique.slice(i, i + IN_CHUNK))
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as { id: string; canonical_name: string }[]) out.push({ id: r.id, canonicalName: r.canonical_name })
  }
  return out
}

/**
 * The Vendors page (GET /api/cmr/vendors): every account, each account's current import, every
 * PAYABLE line of those imports with its vendor_id, and the canonical names those lines point
 * at. The rollup (vendor → accounts → invoices), the account filter and search are computed in
 * the browser from this one response (lib/cmr/vendors).
 */
export async function buildVendorsView(supabase: Supabase): Promise<CmrVendorsView> {
  const [accounts, importRows] = await Promise.all([apAccounts(supabase), currentImports(supabase)])
  const lines = await currentApLines(supabase, importRows.map((i) => i.account_id))
  const vendors = await vendorRefs(supabase, lines.map((l) => l.vendorId))
  return {
    accounts,
    imports: importRows.map((i) => ({ accountId: i.account_id, importedAt: i.imported_at, sourceFilename: i.source_filename })),
    vendors,
    lines,
  }
}

/**
 * Which of an import's spellings are already known canonical vendors (aliases), by normalized
 * key — read just before a commit so the audit entry can say which vendors the import
 * registered. Informational only: the database does the resolving.
 */
export async function knownVendorKeys(supabase: Supabase, rawNames: string[]): Promise<Set<string>> {
  const keys = [...new Set(rawNames.map(normalizeVendorName).filter(Boolean))]
  const known = new Set<string>()
  for (let i = 0; i < keys.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('cmr_vendor_aliases')
      .select('normalized_name')
      .in('normalized_name', keys.slice(i, i + IN_CHUNK))
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as { normalized_name: string }[]) known.add(r.normalized_name)
  }
  return known
}
