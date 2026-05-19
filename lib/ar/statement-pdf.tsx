import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type StatementLineItem = {
  id: string
  rowType: 'invoice' | 'credit_memo'
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  poNumber: string | null
  jobName: string | null
  openBalance: number
  agingBucket: string | null
  agingDays: number | null
  entityCode: string
  branchName: string | null
}

export type StatementData = {
  customer: {
    displayName: string
    entityRefs: Array<{ entityCode: string; quickbooksName: string }>
  }
  lineItems: StatementLineItem[]
  reportDate: string
  asOfDate: string
  companyName: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}, ${d.getFullYear()}`
}

function agingLabel(bucket: string | null): string {
  if (!bucket) return '—'
  const map: Record<string, string> = {
    'Current': 'Current',
    '1-30':    '1–30 days',
    '31-60':   '31–60 days',
    '61-90':   '61–90 days',
    '>90':     '90+ days',
  }
  return map[bucket] ?? bucket
}

// Strip letters and leading zeros — e.g. "INV-001234" → "1234"
function cleanInvoiceNum(n: string | null): string {
  if (!n) return '—'
  const digits = n.replace(/[^0-9]/g, '')
  if (!digits) return n.trim()
  return String(parseInt(digits, 10))
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const ORANGE  = '#ff6b00'
const INK     = '#1d1d1f'
const LABEL   = '#6e6e73'
const RULE    = '#d2d2d7'
const SURFACE = '#f5f5f7'
const WHITE   = '#ffffff'

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: INK,
    backgroundColor: WHITE,
    paddingBottom: 48,
  },

  // Orange stripe at very top
  topStripe: {
    backgroundColor: ORANGE,
    height: 4,
  },

  // Header
  header: {
    paddingHorizontal: 40,
    paddingTop: 24,
    paddingBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  companyName: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    letterSpacing: -0.3,
  },
  companyTagline: {
    fontSize: 8,
    color: LABEL,
    marginTop: 3,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  statementTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: ORANGE,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  asOfDate: {
    fontSize: 8,
    color: LABEL,
    marginTop: 4,
  },

  rule: {
    borderBottomColor: RULE,
    borderBottomWidth: 1,
    marginHorizontal: 40,
  },

  body: {
    paddingHorizontal: 40,
    paddingTop: 24,
  },

  // Bill-to
  billToLabel: {
    fontSize: 7,
    color: LABEL,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 5,
  },
  customerName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: INK,
  },
  entityList: {
    fontSize: 8,
    color: LABEL,
    marginTop: 4,
  },

  sectionGap: {
    marginTop: 28,
  },

  // Aging summary — light cards, no dark backgrounds
  agingGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
    marginBottom: 24,
  },
  agingCard: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  agingCardTotal: {
    flex: 1,
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  agingCardLabel: {
    fontSize: 7,
    color: LABEL,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  agingCardLabelTotal: {
    fontSize: 7,
    color: '#ffffff99',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  agingCardAmount: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: INK,
  },
  agingCardAmountTotal: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: WHITE,
  },

  // Section label
  sectionLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: LABEL,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  // Table — clean, no dark header block
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomColor: INK,
    borderBottomWidth: 1,
  },
  th: {
    fontSize: 7,
    color: LABEL,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Helvetica-Bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomColor: RULE,
    borderBottomWidth: 1,
  },
  tableRowShaded: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 6,
    backgroundColor: SURFACE,
    borderBottomColor: RULE,
    borderBottomWidth: 1,
  },
  tableRowCredit: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomColor: '#ffd0b0',
    borderBottomWidth: 1,
  },

  cell:        { fontSize: 8, color: INK },
  cellMuted:   { fontSize: 8, color: LABEL },
  cellCredit:  { fontSize: 8, color: ORANGE, fontFamily: 'Helvetica-Bold' },
  cellRight:   { fontSize: 8, color: INK, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  cellRightCredit: { fontSize: 8, color: ORANGE, textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  // Columns — 9 columns, adjusted widths
  colDate:    { width: '10%' },
  colNum:     { width: '9%' },
  colPo:      { width: '9%' },
  colJob:     { width: '24%' },
  colEntity:  { width: '7%' },
  colBucket:  { width: '10%' },
  colDays:    { width: '7%' },
  colBalance: { width: '12%' },
  colType:    { width: '7%' },

  // Totals
  totalsBlock: {
    marginTop: 16,
    paddingHorizontal: 6,
    alignItems: 'flex-end',
    gap: 6,
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 3,
  },
  totalLineBold: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 3,
    borderTopColor: RULE,
    borderTopWidth: 1,
    marginTop: 4,
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 8,
    color: LABEL,
    width: 90,
    textAlign: 'right',
  },
  totalAmount: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    width: 70,
    textAlign: 'right',
  },

  // Balance due — minimal, right-aligned
  balanceDueBlock: {
    marginTop: 20,
    paddingHorizontal: 6,
    alignItems: 'flex-end',
  },
  balanceDuePill: {
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: SURFACE,
    alignItems: 'flex-end',
  },
  balanceDueLabel: {
    fontSize: 8,
    color: LABEL,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  balanceDueAmount: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: ORANGE,
  },

  // Footer
  pageFooter: {
    position: 'absolute',
    bottom: 18,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopColor: RULE,
    borderTopWidth: 1,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: LABEL,
  },
})

// ── Column header helper ───────────────────────────────────────────────────────

function TH({ style, children }: { style: Style; children: string }) {
  return <Text style={[s.th, style]}>{children}</Text>
}

// ── Main component ────────────────────────────────────────────────────────────

export function StatementDocument({ data }: { data: StatementData }) {
  const { customer, lineItems, asOfDate, companyName } = data

  const invoices = lineItems.filter((i) => i.rowType === 'invoice')
  const credits  = lineItems.filter((i) => i.rowType === 'credit_memo')

  const totalInvoices = invoices.reduce((s, i) => s + i.openBalance, 0)
  const totalCredits  = credits.reduce((s, i) => s + i.openBalance, 0)
  const netBalance    = totalInvoices + totalCredits

  const BUCKETS = ['Current', '1-30', '31-60', '61-90', '>90'] as const
  const aging: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]))
  for (const inv of invoices) {
    const b = inv.agingBucket ?? 'Current'
    if (b in aging) aging[b] += inv.openBalance
  }

  const sorted = [...lineItems].sort((a, b) => {
    const da = a.invoiceDate ?? ''
    const db = b.invoiceDate ?? ''
    return db.localeCompare(da)
  })

  const entityList = customer.entityRefs.map((r) => r.entityCode).join('  ·  ')

  return (
    <Document title={`Statement — ${customer.displayName}`} author={companyName}>
      <Page size="LETTER" style={s.page}>

        {/* ── Orange top stripe ─────────────────────────────────────────────── */}
        <View style={s.topStripe} />

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View>
            <Text style={s.companyName}>{companyName}</Text>
            <Text style={s.companyTagline}>Accounts Receivable Statement</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.statementTitle}>Statement</Text>
            <Text style={s.asOfDate}>As of {fmtDate(asOfDate)}</Text>
          </View>
        </View>

        <View style={s.rule} />

        <View style={s.body}>

          {/* ── Bill To ───────────────────────────────────────────────────── */}
          <Text style={s.billToLabel}>Bill To</Text>
          <Text style={s.customerName}>{customer.displayName}</Text>
          {entityList ? <Text style={s.entityList}>{entityList}</Text> : null}

          {/* ── Aging grid ────────────────────────────────────────────────── */}
          <View style={s.agingGrid}>
            {BUCKETS.map((b) => (
              <View key={b} style={s.agingCard}>
                <Text style={s.agingCardLabel}>{agingLabel(b)}</Text>
                <Text style={s.agingCardAmount}>{fmt(aging[b])}</Text>
              </View>
            ))}
            <View style={s.agingCardTotal}>
              <Text style={s.agingCardLabelTotal}>Total Due</Text>
              <Text style={s.agingCardAmountTotal}>{fmt(netBalance)}</Text>
            </View>
          </View>

          {/* ── Transaction table ─────────────────────────────────────────── */}
          <Text style={s.sectionLabel}>Transaction Detail</Text>

          <View style={s.tableHeaderRow}>
            <TH style={s.colDate}>Date</TH>
            <TH style={s.colType}>Type</TH>
            <TH style={s.colNum}>Invoice #</TH>
            <TH style={s.colPo}>PO #</TH>
            <TH style={s.colJob}>Job / Description</TH>
            <TH style={s.colEntity}>Entity</TH>
            <TH style={s.colBucket}>Aging</TH>
            <TH style={{ ...s.colDays, textAlign: 'right' }}>Days</TH>
            <TH style={{ ...s.colBalance, textAlign: 'right' }}>Balance</TH>
          </View>

          {sorted.map((item, idx) => {
            const isCredit = item.rowType === 'credit_memo'
            const RowStyle = isCredit
              ? s.tableRowCredit
              : idx % 2 === 0 ? s.tableRow : s.tableRowShaded

            const agingDaysStr = isCredit
              ? '—'
              : item.agingDays != null ? String(item.agingDays) : '—'

            return (
              <View key={item.id} style={RowStyle}>
                <Text style={[s.cellMuted, s.colDate]}>{fmtDate(item.invoiceDate)}</Text>
                <Text style={[isCredit ? s.cellCredit : s.cellMuted, s.colType]}>
                  {isCredit ? 'Credit' : 'Invoice'}
                </Text>
                <Text style={[s.cell, s.colNum]}>{cleanInvoiceNum(item.invoiceNumber)}</Text>
                <Text style={[s.cellMuted, s.colPo]}>{item.poNumber ?? '—'}</Text>
                <Text style={[s.cellMuted, s.colJob]}>{item.jobName ?? '—'}</Text>
                <Text style={[s.cellMuted, s.colEntity]}>{item.entityCode}</Text>
                <Text style={[s.cellMuted, s.colBucket]}>
                  {isCredit ? '—' : agingLabel(item.agingBucket)}
                </Text>
                <Text style={[s.cellMuted, { ...s.colDays, textAlign: 'right' }]}>
                  {agingDaysStr}
                </Text>
                <Text style={[isCredit ? s.cellRightCredit : s.cellRight, s.colBalance]}>
                  {isCredit
                    ? `(${fmt(Math.abs(item.openBalance))})`
                    : fmt(item.openBalance)}
                </Text>
              </View>
            )
          })}

          {/* ── Totals ────────────────────────────────────────────────────── */}
          <View style={s.totalsBlock}>
            <View style={s.totalLine}>
              <Text style={s.totalLabel}>Total Invoices</Text>
              <Text style={s.totalAmount}>{fmt(totalInvoices)}</Text>
            </View>
            {credits.length > 0 && (
              <View style={s.totalLine}>
                <Text style={s.totalLabel}>Total Credits</Text>
                <Text style={[s.totalAmount, { color: ORANGE }]}>
                  ({fmt(Math.abs(totalCredits))})
                </Text>
              </View>
            )}
          </View>

          {/* ── Balance Due ───────────────────────────────────────────────── */}
          <View style={s.balanceDueBlock}>
            <View style={s.balanceDuePill}>
              <Text style={s.balanceDueLabel}>Balance Due</Text>
              <Text style={s.balanceDueAmount}>{fmt(netBalance)}</Text>
            </View>
          </View>

        </View>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <View style={s.pageFooter} fixed>
          <Text style={s.footerText}>{companyName}  ·  Confidential</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>

      </Page>
    </Document>
  )
}
