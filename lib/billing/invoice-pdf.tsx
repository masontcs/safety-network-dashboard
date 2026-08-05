import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'

/**
 * Printable invoice PDF (server-rendered via @react-pdf/renderer, same approach as the
 * AR statement). Money-in-cents in, formatted dollars out.
 */

export interface InvoicePdfLine {
  id: string; kind: string; description: string; lotDate: string | null
  qty: number; units: number; unitRateCents: number; amountCents: number; taxable: boolean
}
export interface InvoicePdfData {
  invoiceNumber: string
  invoiceDate: string
  throughDate: string
  status: string
  customer: string | null
  profile: string | null
  jobNumber: string | null
  jobName: string | null
  entityCode: string | null
  taxRatePct: number
  totals: {
    rentalSubtotalCents: number; salesSubtotalCents: number; otherSubtotalCents: number
    rentalMinimumAdjustmentCents: number; subtotalCents: number; taxCents: number; totalCents: number
  }
  lines: InvoicePdfLine[]
  companyName: string
}

const fmt = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}, ${d.getFullYear()}`
}
const kindLabel = (k: string) => ({ rental: 'Rental', sale: 'Sale', lost: 'Lost/Stolen', labor: 'Labor', lump_sum: 'Lump Sum', misc: 'Misc', adjustment: 'Adjustment' }[k] ?? k)

const ORANGE = '#ff6b00', INK = '#1d1d1f', LABEL = '#6e6e73', RULE = '#d2d2d7', SURFACE = '#f5f5f7', WHITE = '#ffffff'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: INK, backgroundColor: WHITE, paddingTop: 28, paddingBottom: 48 },
  topStripe: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: ORANGE, height: 4 },
  header: { paddingHorizontal: 40, paddingTop: 24, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  companyName: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: INK, letterSpacing: -0.3 },
  companyTagline: { fontSize: 8, color: LABEL, marginTop: 3 },
  headerRight: { alignItems: 'flex-end' },
  docTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: ORANGE, textTransform: 'uppercase', letterSpacing: 1.5 },
  invNum: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 4 },
  metaSmall: { fontSize: 8, color: LABEL, marginTop: 3 },
  rule: { borderBottomColor: RULE, borderBottomWidth: 1, marginHorizontal: 40 },
  body: { paddingHorizontal: 40, paddingTop: 24 },

  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22 },
  billToLabel: { fontSize: 7, color: LABEL, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 },
  customerName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: INK },
  sub: { fontSize: 8, color: LABEL, marginTop: 3 },
  metaBox: { alignItems: 'flex-end' },
  metaLine: { flexDirection: 'row', gap: 10, marginBottom: 3 },
  metaLabel: { fontSize: 8, color: LABEL, width: 70, textAlign: 'right' },
  metaVal: { fontSize: 8, color: INK, width: 90, textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  tableHeaderRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, borderBottomColor: INK, borderBottomWidth: 1 },
  th: { fontSize: 7, color: LABEL, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 6, borderBottomColor: RULE, borderBottomWidth: 1 },
  rowShaded: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 6, backgroundColor: SURFACE, borderBottomColor: RULE, borderBottomWidth: 1 },
  cell: { fontSize: 8, color: INK },
  cellMuted: { fontSize: 8, color: LABEL },
  cellRight: { fontSize: 8, color: INK, textAlign: 'right' },
  cellRightB: { fontSize: 8, color: INK, textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  cKind: { width: '13%' }, cDesc: { width: '43%' }, cQty: { width: '12%' }, cRate: { width: '16%' }, cAmt: { width: '16%' },

  totalsBlock: { marginTop: 16, paddingHorizontal: 6, alignItems: 'flex-end' },
  totalLine: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, paddingVertical: 2 },
  totalLabel: { fontSize: 8, color: LABEL, width: 110, textAlign: 'right' },
  totalAmount: { fontSize: 8, color: INK, width: 80, textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  balanceBlock: { marginTop: 18, alignItems: 'flex-end' },
  balancePill: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: SURFACE, alignItems: 'flex-end' },
  balanceLabel: { fontSize: 8, color: LABEL, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  balanceAmount: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: ORANGE },

  pageFooter: { position: 'absolute', bottom: 18, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopColor: RULE, borderTopWidth: 1, paddingTop: 6 },
  footerText: { fontSize: 7, color: LABEL },
})

function TH({ style, children, right }: { style: Style; children: string; right?: boolean }) {
  return <Text style={[s.th, style, right ? { textAlign: 'right' } : {}]}>{children}</Text>
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const { totals: t } = data
  const totalRow = (label: string, cents: number, always = false) =>
    cents === 0 && !always ? null : (
      <View style={s.totalLine}><Text style={s.totalLabel}>{label}</Text><Text style={s.totalAmount}>{fmt(cents)}</Text></View>
    )

  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={data.companyName}>
      <Page size="LETTER" style={s.page}>
        <View style={s.topStripe} fixed />

        <View style={s.header}>
          <View>
            <Text style={s.companyName}>{data.companyName}</Text>
            <Text style={s.companyTagline}>Traffic Control Rental</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docTitle}>Invoice</Text>
            <Text style={s.invNum}>{data.invoiceNumber}</Text>
            {data.status !== 'issued' ? <Text style={s.metaSmall}>{data.status.toUpperCase()}</Text> : null}
          </View>
        </View>

        <View style={s.rule} />

        <View style={s.body}>
          <View style={s.billRow}>
            <View>
              <Text style={s.billToLabel}>Bill To</Text>
              <Text style={s.customerName}>{data.customer ?? '—'}</Text>
              {data.profile ? <Text style={s.sub}>{data.profile}{data.entityCode ? `  ·  ${data.entityCode}` : ''}</Text> : null}
              {data.jobNumber ? <Text style={s.sub}>Job {data.jobNumber}{data.jobName ? ` — ${data.jobName}` : ''}</Text> : null}
            </View>
            <View style={s.metaBox}>
              <View style={s.metaLine}><Text style={s.metaLabel}>Invoice date</Text><Text style={s.metaVal}>{fmtDate(data.invoiceDate)}</Text></View>
              <View style={s.metaLine}><Text style={s.metaLabel}>Billed through</Text><Text style={s.metaVal}>{fmtDate(data.throughDate)}</Text></View>
            </View>
          </View>

          <View style={s.tableHeaderRow} fixed>
            <TH style={s.cKind}>Type</TH>
            <TH style={s.cDesc}>Description</TH>
            <TH style={s.cQty} right>Qty</TH>
            <TH style={s.cRate} right>Rate</TH>
            <TH style={s.cAmt} right>Amount</TH>
          </View>

          {data.lines.map((l, idx) => (
            <View key={l.id} style={idx % 2 === 0 ? s.row : s.rowShaded} wrap={false}>
              <Text style={[s.cellMuted, s.cKind]}>{kindLabel(l.kind)}</Text>
              <Text style={[s.cell, s.cDesc]}>{l.description}{l.taxable ? '  (taxable)' : ''}</Text>
              <Text style={[s.cellMuted, s.cQty]}>{l.qty}{l.units > 1 ? ` × ${l.units}` : ''}</Text>
              <Text style={[s.cellRight, s.cRate]}>{fmt(l.unitRateCents)}</Text>
              <Text style={[s.cellRightB, s.cAmt]}>{fmt(l.amountCents)}</Text>
            </View>
          ))}

          <View style={s.totalsBlock}>
            {totalRow('Rental', t.rentalSubtotalCents)}
            {totalRow('Rental minimum', t.rentalMinimumAdjustmentCents)}
            {totalRow('Sales', t.salesSubtotalCents)}
            {totalRow('Other charges', t.otherSubtotalCents)}
            {totalRow('Subtotal', t.subtotalCents, true)}
            {totalRow(`Tax (${data.taxRatePct}%)`, t.taxCents)}
            {totalRow('Total', t.totalCents, true)}
          </View>

          <View style={s.balanceBlock}>
            <View style={s.balancePill}>
              <Text style={s.balanceLabel}>Total Due</Text>
              <Text style={s.balanceAmount}>{fmt(t.totalCents)}</Text>
            </View>
          </View>
        </View>

        <View style={s.pageFooter} fixed>
          <Text style={s.footerText}>{data.companyName}  ·  Invoice {data.invoiceNumber}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
