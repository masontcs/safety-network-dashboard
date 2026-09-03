import React from 'react'
import { Document, Page, Text, View, StyleSheet, Svg, Path } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'

/**
 * Invoice PDF — curved charcoal header band with a serif INVOICE wordmark, a right-aligned
 * "Invoice To" block, a charcoal table header with striped rows (item + variation sub-line),
 * and a highlighted gold Grand Total. Curved charcoal footer with a thank-you line.
 * Server-rendered via @react-pdf/renderer. Money-in-cents in, formatted dollars out.
 */

export interface InvoicePdfLine {
  id: string; kind: string; description: string; lotDate: string | null
  variation: string | null
  qty: number; units: number; unitRateCents: number; amountCents: number; taxable: boolean
  rentalItemQty?: number | null; rentalDays?: number | null; periodEnd?: string | null
}

const pdfShortDate = (d: string | null | undefined) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' }) : ''
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

const CHAR = '#2b2926'
const GOLD = '#c79a3a'
const INK = '#1f1f1f'
const MUT = '#8b8b86'
const LAB = '#a6a6a0'
const STRIPE = '#f3f2ef'
const WHITE = '#ffffff'

// Header band geometry (points). Tightened so more line items fit below.
const HDR_H = 168

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: INK, backgroundColor: WHITE, paddingBottom: 78 },

  // header band (reserves flow space; the curved shape + text are layered inside)
  header: { height: HDR_H },
  hdrText: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 46 },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 34 },
  brand: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: WHITE, letterSpacing: 0.3 },
  metaBox: { width: 220 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
  metaL: { fontSize: 8, color: LAB },
  metaV: { fontSize: 8, color: WHITE },
  invWord: { fontFamily: 'Times-Bold', fontSize: 42, color: WHITE, letterSpacing: 1, marginTop: 12 },
  invNo: { fontSize: 8, color: GOLD, letterSpacing: 1.5, marginTop: 2 },

  body: { paddingHorizontal: 46, paddingTop: 16 },

  billTo: { alignItems: 'flex-end', marginBottom: 20 },
  billLabel: { fontSize: 7.5, color: GOLD, letterSpacing: 1.5, marginBottom: 5 },
  billName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: INK },
  billSub: { fontSize: 8.5, color: MUT, marginTop: 2 },

  thRow: { flexDirection: 'row', backgroundColor: CHAR, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 3 },
  th: { fontSize: 7.5, color: WHITE, letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  cDesc: { flex: 1 }, cQty: { width: 34, textAlign: 'center' }, cPeriod: { width: 96, textAlign: 'left' }, cDays: { width: 36, textAlign: 'center' }, cPrice: { width: 72, textAlign: 'right' }, cTot: { width: 78, textAlign: 'right' },
  itemName: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: INK },
  itemSub: { fontSize: 8, color: MUT, marginTop: 2 },
  cell: { fontSize: 9, color: INK },

  lower: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  totals: { width: 250 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 4 },
  tLab: { fontSize: 9, color: MUT }, tVal: { fontSize: 9, color: INK },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: CHAR, borderRadius: 4, paddingVertical: 11, paddingHorizontal: 14, marginTop: 8 },
  grandLab: { fontSize: 9, color: WHITE, letterSpacing: 1, textTransform: 'uppercase' },
  grandVal: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: GOLD },

  block: { marginBottom: 14, maxWidth: 250 },
  blockH: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: INK, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 },
  blockT: { fontSize: 8.5, color: MUT, lineHeight: 1.5 },

  ftText: { position: 'absolute', bottom: 30, left: 46, right: 46, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  thank: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: WHITE, letterSpacing: 0.5 },
  ftMeta: { fontSize: 7.5, color: LAB },

  // PROOF watermark — a fixed, page-covering layer of large, faint, rotated text.
  wmLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center' },
  wmText: { fontSize: 82, fontFamily: 'Helvetica-Bold', color: '#d9403a', opacity: 0.1, letterSpacing: 8, transform: 'rotate(-32deg)' },
})

function TH({ style, children, right, center }: { style: Style; children: string; right?: boolean; center?: boolean }) {
  return <Text style={[s.th, style, right ? { textAlign: 'right' } : {}, center ? { textAlign: 'center' } : {}]}>{children}</Text>
}

function ProofWatermark() {
  return (
    <View style={s.wmLayer} fixed>
      {[0, 1, 2, 3, 4].map((i) => <Text key={i} style={s.wmText}>PROOF</Text>)}
    </View>
  )
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const { totals: t } = data
  const showStatus = data.status !== 'issued' && !data.proof

  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={data.companyName}>
      <Page size="LETTER" style={s.page}>

        {data.proof ? <ProofWatermark /> : null}

        {/* Curved charcoal header band (page 1) */}
        <View style={s.header}>
          <Svg width="612" height={HDR_H} style={{ position: 'absolute', top: 0, left: 0 }}>
            <Path d={`M0,0 L612,0 L612,${HDR_H - 40} C 470,${HDR_H + 4} 250,${HDR_H - 12} 0,${HDR_H - 30} Z`} fill={CHAR} />
          </Svg>
          <View style={s.hdrText}>
            <View style={s.brandRow}>
              <Text style={s.brand}>{data.companyName}</Text>
              <View style={s.metaBox}>
                <View style={s.metaRow}><Text style={s.metaL}>Invoice Date</Text><Text style={s.metaV}>{fmtDate(data.invoiceDate)}</Text></View>
                <View style={s.metaRow}><Text style={s.metaL}>Billed Through</Text><Text style={s.metaV}>{fmtDate(data.throughDate)}</Text></View>
                <View style={s.metaRow}><Text style={s.metaL}>Account</Text><Text style={s.metaV}>{data.entityCode ?? '—'}</Text></View>
              </View>
            </View>
            <Text style={s.invWord}>INVOICE</Text>
            <Text style={s.invNo}>INVOICE NO : {data.invoiceNumber}{showStatus ? `   ·   ${data.status.toUpperCase()}` : ''}</Text>
          </View>
        </View>

        <View style={s.body}>
          {/* Invoice To */}
          <View style={s.billTo}>
            <Text style={s.billLabel}>INVOICE TO</Text>
            <Text style={s.billName}>{data.customer ?? '—'}</Text>
            <Text style={s.billSub}>{[data.profile, data.jobNumber ? `Job ${data.jobNumber}` : null].filter(Boolean).join('  ·  ')}</Text>
            {data.jobName ? <Text style={s.billSub}>{data.jobName}</Text> : null}
          </View>

          {/* Line items */}
          <View style={s.thRow} fixed>
            <TH style={s.cDesc}>Item Description</TH>
            <TH style={s.cQty} center>Qty</TH>
            <TH style={s.cPeriod}>Rental Period</TH>
            <TH style={s.cDays} center>Days</TH>
            <TH style={s.cPrice} right>Rate</TH>
            <TH style={s.cTot} right>Total</TH>
          </View>
          {data.lines.map((l, i) => {
            const rental = l.kind === 'rental' && l.rentalDays != null
            return (
              <View key={l.id} style={[s.row, { backgroundColor: i % 2 ? WHITE : STRIPE }]} wrap={false}>
                <View style={s.cDesc}>
                  <Text style={s.itemName}>{l.description}</Text>
                  {l.variation ? <Text style={s.itemSub}>{l.variation}</Text> : null}
                </View>
                <Text style={[s.cell, s.cQty]}>{rental ? l.rentalItemQty : `${l.qty}${l.units > 1 ? ` × ${l.units}` : ''}`}</Text>
                <Text style={[s.cell, s.cPeriod, { color: MUT }]}>{rental ? `${pdfShortDate(l.lotDate)} – ${pdfShortDate(l.periodEnd)}` : ''}</Text>
                <Text style={[s.cell, s.cDays]}>{rental ? l.rentalDays : ''}</Text>
                <Text style={[s.cell, s.cPrice, { color: MUT }]}>{fmt(l.unitRateCents)}</Text>
                <Text style={[s.cell, s.cTot, { fontFamily: 'Helvetica-Bold' }]}>{fmt(l.amountCents)}</Text>
              </View>
            )
          })}

          {/* Payment info / terms + totals */}
          <View style={s.lower}>
            <View>
              <View style={s.block}><Text style={s.blockH}>Payment Info</Text><Text style={s.blockT}>Remit to {data.companyName}. Terms per your account agreement.</Text></View>
              <View style={s.block}><Text style={s.blockH}>Terms & Conditions</Text><Text style={s.blockT}>Payment due upon receipt unless otherwise agreed. Rentals bill from pickup through the billed-through date.</Text></View>
            </View>
            <View style={s.totals}>
              {t.rentalMinimumAdjustmentCents !== 0 ? (
                <View style={s.tRow}><Text style={s.tLab}>Rental minimum</Text><Text style={s.tVal}>{fmt(t.rentalMinimumAdjustmentCents)}</Text></View>
              ) : null}
              <View style={s.tRow}><Text style={s.tLab}>Subtotal</Text><Text style={s.tVal}>{fmt(t.subtotalCents)}</Text></View>
              <View style={s.tRow}><Text style={s.tLab}>Tax ({data.taxRatePct}%)</Text><Text style={s.tVal}>{fmt(t.taxCents)}</Text></View>
              <View style={s.grand}><Text style={s.grandLab}>Grand Total</Text><Text style={s.grandVal}>{fmt(t.totalCents)}</Text></View>
            </View>
          </View>
        </View>

        {/* Curved charcoal footer (repeats on every page) */}
        <View fixed style={{ position: 'absolute', bottom: 0, left: 0 }}>
          <Svg width="612" height="72"><Path d="M0,72 L612,72 L612,22 C 400,-8 200,2 0,28 Z" fill={CHAR} /></Svg>
        </View>
        <View style={s.ftText} fixed>
          <Text style={s.thank}>THANK YOU FOR YOUR BUSINESS</Text>
          <Text style={s.ftMeta} render={({ pageNumber, totalPages }) => `${data.companyName}  ·  ${data.invoiceNumber}  ·  Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
