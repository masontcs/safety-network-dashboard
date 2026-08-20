import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'

/**
 * Invoice PDF — "header band" design: a graphite masthead with a warm-gold INVOICE mark,
 * tinted bill-to / date panels, hairline line rows, and a bold graphite Total Due block.
 * Server-rendered via @react-pdf/renderer. Money-in-cents in, formatted dollars out.
 */

export interface InvoicePdfLine {
  id: string; kind: string; description: string; lotDate: string | null
  variation: string | null
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
  /** When true, stamp a repeated PROOF watermark across every page. */
  proof?: boolean
}

const fmt = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}, ${d.getFullYear()}`
}

const GRAPHITE = '#1e1e22'
const GOLD = '#e0a83e'
const INK = '#1a1a1a'
const MUTED = '#8a8a8f'
const LABEL = '#9a9a9f'
const PANEL = '#f6f6f4'
const HEADROW = '#f0f0ee'
const HAIR = '#ececea'
const WHITE = '#ffffff'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: INK, backgroundColor: WHITE, paddingBottom: 54 },

  // masthead band (page 1)
  band: { backgroundColor: GRAPHITE, paddingHorizontal: 40, paddingVertical: 26, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  company: { fontSize: 19, fontFamily: 'Helvetica-Bold', color: WHITE, letterSpacing: -0.3 },
  tagline: { fontSize: 8, color: '#a7a7b0', marginTop: 4 },
  invWord: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: GOLD, letterSpacing: 3, textAlign: 'right' },
  invMeta: { fontSize: 9, color: '#c9c9d0', marginTop: 5, textAlign: 'right' },

  body: { paddingHorizontal: 40, paddingTop: 26 },

  // bill-to + dates panels
  panelsRow: { flexDirection: 'row', gap: 14, marginBottom: 26 },
  panel: { flex: 1, backgroundColor: PANEL, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16 },
  datePanel: { width: 165, backgroundColor: PANEL, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16 },
  panelLabel: { fontSize: 7, letterSpacing: 1.1, color: LABEL, textTransform: 'uppercase', marginBottom: 6 },
  custName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: INK },
  panelSub: { fontSize: 9, color: MUTED, marginTop: 3 },
  dLabel: { fontSize: 8, color: LABEL },
  dVal: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: INK, marginTop: 1 },

  // line table
  headerRow: { flexDirection: 'row', backgroundColor: HEADROW, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12 },
  th: { fontSize: 7, letterSpacing: 0.6, color: MUTED, textTransform: 'uppercase' },
  row: { flexDirection: 'row', paddingVertical: 11, paddingHorizontal: 12, borderBottomColor: HAIR, borderBottomWidth: 1 },
  desc: { fontSize: 9, color: INK },
  descSub: { fontSize: 8.5, color: '#a8a8ad' },
  cellQty: { fontSize: 9, color: MUTED, textAlign: 'right' },
  cellRate: { fontSize: 9, color: MUTED, textAlign: 'right' },
  cellAmt: { fontSize: 9, color: INK, textAlign: 'right', fontFamily: 'Helvetica-Bold' },

  colDesc: { flex: 1 }, colQty: { width: 60 }, colRate: { width: 78 }, colAmt: { width: 80 },

  // totals
  totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 22 },
  totals: { width: 250 },
  tLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 2 },
  tLabel: { fontSize: 8.5, color: MUTED },
  tVal: { fontSize: 8.5, color: INK },
  totalBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: GRAPHITE, borderRadius: 8, paddingVertical: 13, paddingHorizontal: 16, marginTop: 10 },
  totalBoxLabel: { fontSize: 8, letterSpacing: 1.2, color: '#c9c9d0', textTransform: 'uppercase' },
  totalBoxAmt: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: GOLD },

  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopColor: HAIR, borderTopWidth: 1, paddingTop: 7 },
  footerText: { fontSize: 7, color: LABEL },

  // PROOF watermark — a fixed, page-covering layer of large, faint, rotated text.
  wmLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center' },
  wmText: { fontSize: 82, fontFamily: 'Helvetica-Bold', color: '#d9403a', opacity: 0.1, letterSpacing: 8, transform: 'rotate(-32deg)' },
})

function ProofWatermark() {
  // Rendered `fixed` so it repeats on every page, behind the content.
  return (
    <View style={s.wmLayer} fixed>
      {[0, 1, 2, 3, 4].map((i) => <Text key={i} style={s.wmText}>PROOF</Text>)}
    </View>
  )
}

function TH({ style, children, right }: { style: Style; children: string; right?: boolean }) {
  return <Text style={[s.th, style, right ? { textAlign: 'right' } : {}]}>{children}</Text>
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const { totals: t } = data
  const totalRow = (label: string, cents: number, always = false) =>
    cents === 0 && !always ? null : (
      <View style={s.tLine}><Text style={s.tLabel}>{label}</Text><Text style={s.tVal}>{fmt(cents)}</Text></View>
    )

  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={data.companyName}>
      <Page size="LETTER" style={s.page}>

        {data.proof ? <ProofWatermark /> : null}

        {/* Masthead */}
        <View style={s.band}>
          <View>
            <Text style={s.company}>{data.companyName}</Text>
          </View>
          <View>
            <Text style={s.invWord}>INVOICE</Text>
            <Text style={s.invMeta}>{data.invoiceNumber}  ·  {fmtDate(data.invoiceDate)}</Text>
            {data.status !== 'issued' ? <Text style={[s.invMeta, { color: GOLD }]}>{data.status.toUpperCase()}</Text> : null}
          </View>
        </View>

        <View style={s.body}>
          {/* Bill-to + dates */}
          <View style={s.panelsRow}>
            <View style={s.panel}>
              <Text style={s.panelLabel}>Billed to</Text>
              <Text style={s.custName}>{data.customer ?? '—'}</Text>
              <Text style={s.panelSub}>
                {[data.profile, data.entityCode].filter(Boolean).join('  ·  ')}
                {data.jobNumber ? `${data.profile || data.entityCode ? '  ·  ' : ''}Job ${data.jobNumber}` : ''}
              </Text>
              {data.jobName ? <Text style={s.panelSub}>{data.jobName}</Text> : null}
            </View>
            <View style={s.datePanel}>
              <Text style={s.dLabel}>Invoice date</Text>
              <Text style={[s.dVal, { marginBottom: 9 }]}>{fmtDate(data.invoiceDate)}</Text>
              <Text style={s.dLabel}>Billed through</Text>
              <Text style={s.dVal}>{fmtDate(data.throughDate)}</Text>
            </View>
          </View>

          {/* Line items */}
          <View style={s.headerRow} fixed>
            <TH style={s.colDesc}>Description</TH>
            <TH style={s.colQty} right>Qty</TH>
            <TH style={s.colRate} right>Rate</TH>
            <TH style={s.colAmt} right>Amount</TH>
          </View>

          {data.lines.map((l) => (
            <View key={l.id} style={s.row} wrap={false}>
              <View style={s.colDesc}>
                <Text style={s.desc}>{l.description}</Text>
                {/* Sub-label = the variation (blank when none); taxable stays as a trailing note. */}
                {(l.variation || l.taxable) ? (
                  <Text style={s.descSub}>{[l.variation, l.taxable ? 'taxable' : null].filter(Boolean).join('  ·  ')}</Text>
                ) : null}
              </View>
              <Text style={[s.cellQty, s.colQty]}>{l.qty}{l.units > 1 ? ` × ${l.units}` : ''}</Text>
              <Text style={[s.cellRate, s.colRate]}>{fmt(l.unitRateCents)}</Text>
              <Text style={[s.cellAmt, s.colAmt]}>{fmt(l.amountCents)}</Text>
            </View>
          ))}

          {/* Totals */}
          <View style={s.totalsWrap}>
            <View style={s.totals}>
              {totalRow('Rental', t.rentalSubtotalCents)}
              {totalRow('Rental minimum', t.rentalMinimumAdjustmentCents)}
              {totalRow('Sales', t.salesSubtotalCents)}
              {totalRow('Other charges', t.otherSubtotalCents)}
              {totalRow('Subtotal', t.subtotalCents, true)}
              {totalRow(`Tax (${data.taxRatePct}%)`, t.taxCents)}
              <View style={s.totalBox}>
                <Text style={s.totalBoxLabel}>Total due</Text>
                <Text style={s.totalBoxAmt}>{fmt(t.totalCents)}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{data.companyName}  ·  Invoice {data.invoiceNumber}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
