/**
 * QuickBooks Desktop .IIF invoice export.
 *
 * Mimics the client's prior billing-system export (InvoiceExport_4_10_2026.iif): a tab-
 * delimited, CRLF, double-entry file. One INVOICE transaction per invoice:
 *
 *   TRNS   → the A/R debit (customer owes), AMOUNT = +invoice total
 *   SPL(s) → revenue credits, one per (account × class), AMOUNT = -(that bucket)
 *   SPL    → Sales Tax Payable, AMOUNT = -(tax) (0.00 when non-taxable)
 *   ENDTRNS
 *
 * Every transaction nets to zero (debit = credits + tax), which is what QuickBooks requires
 * to import. TRNSID/SPLID are one continuous integer sequence across the whole file.
 *
 * This module is pure (no DB, no I/O) so it can be unit-tested against the sample file. The
 * API layer resolves config (accounts, items, per-branch class, customer QB name, due date)
 * and hands fully-formed invoices here.
 */

/** A revenue bucket on an invoice — the sum of all lines that map to one account. */
export interface QbSplit {
  account: string // e.g. "REVENUE - SERVICES:SERV-EQUIPMENT USED"
  klass: string // QuickBooks class, e.g. ":TCS-BK" ('' = none)
  item: string // INVITEM, e.g. "EQUIPMENT RENTAL"
  memo: string
  amountCents: number // POSITIVE; the generator writes it as a credit (negative)
}

export interface QbInvoice {
  docNum: string // invoice number
  date: string // ISO yyyy-mm-dd (invoice date)
  dueDate: string // ISO yyyy-mm-dd
  customerName: string // QuickBooks customer (the qb_name; may include ":job")
  memo: string // TRNS memo — the job/site
  poNum: string
  nameIsTaxable: boolean
  taxCents: number // 0 when non-taxable
  splits: QbSplit[] // revenue buckets, positive amounts
}

export interface QbConfig {
  arAccount: string // "ACCOUNTS RECEIVABLE"
  taxAccount: string // "Sales Tax Payable"
  taxZeroMemo: string // "NO TAX" (memo on a $0 tax line)
  taxExtra: string // "AUTOSTAX"
}

const HEADER = [
  '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tDUEDATE\tADDR1\tPONUM\tNAMEISTAXABLE',
  '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tEXTRA\tINVITEM\tTAXABLE',
  '!ENDTRNS',
]

/** Cents → QuickBooks money: grouped thousands, 2 decimals, leading '-' for negatives. */
export function qbMoney(cents: number): string {
  const dollars = cents / 100
  const norm = dollars === 0 ? 0 : dollars // avoid "-0.00" for a negated zero
  return norm.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** ISO yyyy-mm-dd → M/D/YYYY with no leading zeros (QuickBooks date format). */
export function qbDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}/${y}`
}

/**
 * Build the .iif text for a set of invoices. TRNS AMOUNT is DERIVED from the splits + tax so
 * the transaction always balances, regardless of any rounding in stored totals.
 */
export function buildInvoiceIif(invoices: QbInvoice[], cfg: QbConfig): string {
  const lines: string[] = [...HEADER]
  let id = 0
  const next = () => String(++id)

  for (const inv of invoices) {
    const revenueCents = inv.splits.reduce((s, sp) => s + sp.amountCents, 0)
    const totalCents = revenueCents + inv.taxCents

    // TRNS — the A/R debit (positive). CLASS is blank at the header level.
    lines.push([
      'TRNS', next(), 'INVOICE', qbDate(inv.date), cfg.arAccount, inv.customerName, '',
      qbMoney(totalCents), inv.docNum, inv.memo, qbDate(inv.dueDate), inv.customerName, inv.poNum,
      inv.nameIsTaxable ? 'Y' : 'N', '', // trailing empty field, matching the source export
    ].join('\t'))

    // SPL — one revenue credit per bucket (negative).
    for (const sp of inv.splits) {
      lines.push([
        'SPL', next(), 'INVOICE', qbDate(inv.date), sp.account, '', sp.klass,
        qbMoney(-sp.amountCents), inv.docNum, sp.memo, '', sp.item, 'N',
      ].join('\t'))
    }

    // SPL — the tax line (credit; 0.00 when non-taxable).
    lines.push([
      'SPL', next(), 'INVOICE', qbDate(inv.date), cfg.taxAccount, '', '',
      qbMoney(-inv.taxCents), inv.docNum, inv.taxCents === 0 ? cfg.taxZeroMemo : 'TAX', cfg.taxExtra, '', 'N',
    ].join('\t'))

    lines.push('ENDTRNS')
  }

  // QuickBooks IIF is CRLF-terminated, including a trailing newline.
  return lines.join('\r\n') + '\r\n'
}

/** Kind → revenue bucket mapping (from config), with an 'other' fallback. */
export type QbKindMap = Record<string, { account: string; item: string; memo: string }>

export interface InvoiceLineForQb {
  kind: string // rental | labor | sale | lost | lump_sum | misc | adjustment
  amountCents: number
}

/**
 * Collapse an invoice's lines into revenue buckets keyed by account. Lines whose kind isn't
 * explicitly mapped fall to the 'other' bucket. Buckets come out in a stable order (rental,
 * labor, then everything else) to match the sample's equipment-before-labor ordering.
 */
export function linesToSplits(lines: InvoiceLineForQb[], kindMap: QbKindMap, klass: string): QbSplit[] {
  const order = ['rental', 'labor', 'other']
  const buckets = new Map<string, QbSplit & { _rank: number }>()
  for (const ln of lines) {
    if (!ln.amountCents) continue
    const map = kindMap[ln.kind] ?? kindMap.other
    if (!map) continue // no mapping and no fallback — skip rather than emit a bad account
    const rank = order.indexOf(kindMap[ln.kind] ? ln.kind : 'other')
    const existing = buckets.get(map.account)
    if (existing) existing.amountCents += ln.amountCents
    else buckets.set(map.account, { account: map.account, klass, item: map.item, memo: map.memo, amountCents: ln.amountCents, _rank: rank < 0 ? 99 : rank })
  }
  return [...buckets.values()]
    .sort((a, b) => a._rank - b._rank || a.account.localeCompare(b.account))
    .map(({ _rank, ...sp }) => sp)
}
