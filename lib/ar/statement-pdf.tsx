import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'

Font.register({
  family: 'Helvetica',
  fonts: [],
})

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
    '1-30':    '1–30 Days',
    '31-60':   '31–60 Days',
    '61-90':   '61–90 Days',
    '>90':     'Over 90 Days',
  }
  return map[bucket] ?? bucket
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ORANGE = '#ff6b00'
const DARK   = '#111111'
const GRAY   = '#f4f4f4'
const MID    = '#888888'
const BLACK  = '#111111'
const WHITE  = '#ffffff'

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: BLACK,
    backgroundColor: WHITE,
    paddingTop: 0,
    paddingBottom: 36,
    paddingHorizontal: 0,
  },

  // Header bar
  header: {
    backgroundColor: DARK,
    paddingHorizontal: 36,
    paddingTop: 28,
    paddingBottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  companyName: {
    color: WHITE,
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
  },
  companyTagline: {
    color: '#888888',
    fontSize: 8,
    marginTop: 3,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  statementTitle: {
    color: ORANGE,
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  asOfDate: {
    color: '#aaaaaa',
    fontSize: 8,
    marginTop: 4,
  },

  // Orange accent bar
  accentBar: {
    backgroundColor: ORANGE,
    height: 3,
  },

  body: {
    paddingHorizontal: 36,
    paddingTop: 24,
  },

  // Bill-to block
  billToLabel: {
    fontSize: 7,
    color: MID,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  customerName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: BLACK,
  },
  entityBadge: {
    fontSize: 7,
    color: ORANGE,
    marginTop: 3,
  },

  divider: {
    borderBottomColor: '#e0e0e0',
    borderBottomWidth: 1,
    marginVertical: 16,
  },

  // Aging summary grid
  agingSummaryRow: {
    flexDirection: 'row',
    backgroundColor: GRAY,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 20,
  },
  agingCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRightColor: '#e0e0e0',
    borderRightWidth: 1,
  },
  agingCellLast: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    backgroundColor: DARK,
    borderRadius: 0,
  },
  agingLabel: {
    fontSize: 7,
    color: MID,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  agingLabelDark: {
    fontSize: 7,
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  agingAmount: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: BLACK,
  },
  agingAmountHighlight: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: ORANGE,
  },

  // Section title
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: MID,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },

  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: DARK,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 7,
    color: '#aaaaaa',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'Helvetica-Bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomColor: '#eeeeee',
    borderBottomWidth: 1,
  },
  tableRowShaded: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: GRAY,
    borderBottomColor: '#e8e8e8',
    borderBottomWidth: 1,
  },
  tableRowCredit: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#fff8f5',
    borderBottomColor: '#f5e8e0',
    borderBottomWidth: 1,
  },
  cell: {
    fontSize: 8,
    color: BLACK,
  },
  cellMuted: {
    fontSize: 8,
    color: MID,
  },
  cellCredit: {
    fontSize: 8,
    color: ORANGE,
    fontFamily: 'Helvetica-Bold',
  },
  cellRight: {
    fontSize: 8,
    color: BLACK,
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
  },
  cellRightCredit: {
    fontSize: 8,
    color: ORANGE,
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
  },

  // Column widths
  colDate:    { width: '11%' },
  colType:    { width: '11%' },
  colNum:     { width: '13%' },
  colPo:      { width: '12%' },
  colJob:     { width: '27%' },
  colEntity:  { width: '10%' },
  colBalance: { width: '16%' },

  // Totals footer
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    paddingHorizontal: 8,
    gap: 32,
  },
  totalItem: {
    alignItems: 'flex-end',
  },
  totalLabel: {
    fontSize: 7,
    color: MID,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  totalAmount: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: BLACK,
  },

  // Balance due box
  balanceDueBox: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  balanceDueInner: {
    backgroundColor: DARK,
    borderRadius: 4,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'flex-end',
  },
  balanceDueLabel: {
    fontSize: 8,
    color: '#aaaaaa',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  balanceDueAmount: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: ORANGE,
  },

  // Footer
  pageFooter: {
    position: 'absolute',
    bottom: 16,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7,
    color: '#cccccc',
  },
})

// ── Column header / cell helpers ──────────────────────────────────────────────

function TH({ style, children }: { style: Style; children: string }) {
  return <Text style={[s.tableHeaderCell, style]}>{children}</Text>
}

// ── Main component ────────────────────────────────────────────────────────────

export function StatementDocument({ data }: { data: StatementData }) {
  const { customer, lineItems, asOfDate, companyName } = data

  // Separate invoices and credits
  const invoices = lineItems.filter((i) => i.rowType === 'invoice')
  const credits  = lineItems.filter((i) => i.rowType === 'credit_memo')

  const totalInvoices = invoices.reduce((s, i) => s + i.openBalance, 0)
  const totalCredits  = credits.reduce((s, i) => s + i.openBalance, 0)   // negative
  const netBalance    = totalInvoices + totalCredits

  // Aging totals (invoices only)
  const BUCKETS = ['Current', '1-30', '31-60', '61-90', '>90'] as const
  const aging: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]))
  for (const inv of invoices) {
    const b = inv.agingBucket ?? 'Current'
    if (b in aging) aging[b] += inv.openBalance
  }

  // Sort all line items by date desc
  const sorted = [...lineItems].sort((a, b) => {
    const da = a.invoiceDate ?? ''
    const db = b.invoiceDate ?? ''
    return db.localeCompare(da)
  })

  const entityList = customer.entityRefs.map((r) => r.entityCode).join(' · ')

  return (
    <Document
      title={`Statement — ${customer.displayName}`}
      author={companyName}
    >
      <Page size="LETTER" style={s.page}>

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View>
            <Text style={s.companyName}>{companyName}</Text>
            <Text style={s.companyTagline}>Account Statement</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.statementTitle}>Statement</Text>
            <Text style={s.asOfDate}>As of {fmtDate(asOfDate)}</Text>
          </View>
        </View>
        <View style={s.accentBar} />

        <View style={s.body}>

          {/* ── Bill To ───────────────────────────────────────────────────── */}
          <Text style={s.billToLabel}>Bill To</Text>
          <Text style={s.customerName}>{customer.displayName}</Text>
          {entityList ? <Text style={s.entityBadge}>{entityList}</Text> : null}

          <View style={s.divider} />

          {/* ── Aging summary ─────────────────────────────────────────────── */}
          <View style={s.agingSummaryRow}>
            {BUCKETS.map((b) => (
              <View key={b} style={s.agingCell}>
                <Text style={s.agingLabel}>{agingLabel(b)}</Text>
                <Text style={s.agingAmount}>{fmt(aging[b])}</Text>
              </View>
            ))}
            <View style={s.agingCellLast}>
              <Text style={s.agingLabelDark}>Total Due</Text>
              <Text style={s.agingAmountHighlight}>{fmt(netBalance)}</Text>
            </View>
          </View>

          {/* ── Line items table ──────────────────────────────────────────── */}
          <Text style={s.sectionTitle}>Transaction Detail</Text>

          <View style={s.tableHeader}>
            <TH style={s.colDate}>Date</TH>
            <TH style={s.colType}>Type</TH>
            <TH style={s.colNum}>Number</TH>
            <TH style={s.colPo}>PO #</TH>
            <TH style={s.colJob}>Job / Description</TH>
            <TH style={s.colEntity}>Entity</TH>
            <TH style={{ ...s.colBalance, textAlign: 'right' }}>Balance</TH>
          </View>

          {sorted.map((item, idx) => {
            const isCredit = item.rowType === 'credit_memo'
            const RowStyle = isCredit
              ? s.tableRowCredit
              : idx % 2 === 0 ? s.tableRow : s.tableRowShaded

            return (
              <View key={item.id} style={RowStyle}>
                <Text style={[s.cellMuted, s.colDate]}>{fmtDate(item.invoiceDate)}</Text>
                <Text style={[isCredit ? s.cellCredit : s.cell, s.colType]}>
                  {isCredit ? 'Credit' : 'Invoice'}
                </Text>
                <Text style={[s.cell, s.colNum]}>{item.invoiceNumber ?? '—'}</Text>
                <Text style={[s.cellMuted, s.colPo]}>{item.poNumber ?? '—'}</Text>
                <Text style={[s.cellMuted, s.colJob]}>
                  {item.jobName ?? '—'}
                </Text>
                <Text style={[s.cellMuted, s.colEntity]}>{item.entityCode}</Text>
                <Text style={isCredit ? s.cellRightCredit : s.cellRight}>
                  {isCredit
                    ? `(${fmt(Math.abs(item.openBalance))})`
                    : fmt(item.openBalance)}
                </Text>
              </View>
            )
          })}

          {/* ── Totals ────────────────────────────────────────────────────── */}
          <View style={s.totalsRow}>
            <View style={s.totalItem}>
              <Text style={s.totalLabel}>Total Invoices</Text>
              <Text style={s.totalAmount}>{fmt(totalInvoices)}</Text>
            </View>
            {credits.length > 0 && (
              <View style={s.totalItem}>
                <Text style={s.totalLabel}>Total Credits</Text>
                <Text style={[s.totalAmount, { color: ORANGE }]}>
                  ({fmt(Math.abs(totalCredits))})
                </Text>
              </View>
            )}
          </View>

          {/* ── Balance Due ───────────────────────────────────────────────── */}
          <View style={s.balanceDueBox}>
            <View style={s.balanceDueInner}>
              <Text style={s.balanceDueLabel}>Balance Due</Text>
              <Text style={s.balanceDueAmount}>{fmt(netBalance)}</Text>
            </View>
          </View>

        </View>

        {/* ── Page footer ───────────────────────────────────────────────────── */}
        <View style={s.pageFooter} fixed>
          <Text style={s.footerText}>{companyName} · Confidential</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          } />
        </View>

      </Page>
    </Document>
  )
}
