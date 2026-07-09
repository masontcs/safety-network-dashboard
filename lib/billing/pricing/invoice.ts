/**
 * Invoice assembly.
 *
 * DECIDED (2026-07-09, Mason):
 *   - Tax applies ONLY to sales items. Not rentals, not labor, not lost/stolen.
 *   - Lost/stolen bills at the item's COST (never sale price) and is NOT taxed.
 *   - Rental minimum ($25 default) applies PER INVOICE, on by default per
 *     billing profile, toggleable off.
 *
 * Tax is computed at apply-time from the BRANCH's jurisdiction rate (dynamic,
 * never stored on the item) — pass it in. Pricing is live: the caller resolves
 * current rates; once an invoice is generated its numbers freeze upstream.
 */
import type { Cents } from './types';

export type LineKind = 'rental' | 'sale' | 'lost' | 'labor' | 'lump_sum' | 'misc' | 'adjustment';

export interface InvoiceLine {
  kind: LineKind;
  description: string;
  itemCode?: string;
  variation?: string | null;
  qty: number;
  /** For rentals: units of the rate's period (days/weeks/months). Otherwise 1. */
  units: number;
  unitRateCents: Cents;
  amountCents: Cents;
}

export interface InvoiceOptions {
  /** Branch jurisdiction rate at apply-time, e.g. 7.25 for 7.25%. */
  taxRatePct: number;
  rentalMinimumCents: Cents;
  applyRentalMinimum: boolean;
}

export const DEFAULT_INVOICE_OPTIONS: Omit<InvoiceOptions, 'taxRatePct'> = {
  rentalMinimumCents: 2500, // $25
  applyRentalMinimum: true,
};

export interface InvoiceTotals {
  rentalSubtotalCents: Cents;
  salesSubtotalCents: Cents;
  otherSubtotalCents: Cents;
  rentalMinimumAdjustmentCents: Cents;
  subtotalCents: Cents;
  /** Only sales lines are taxed. */
  taxableBaseCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export interface BuiltInvoice {
  lines: InvoiceLine[];
  totals: InvoiceTotals;
}

/** qty x units x unitRate, rounded once. */
export function lineAmount(qty: number, units: number, unitRateCents: Cents): Cents {
  return Math.round(qty * units * unitRateCents);
}

export function rentalLine(p: {
  description: string;
  itemCode: string;
  variation?: string | null;
  qty: number;
  units: number;
  unitRateCents: Cents;
}): InvoiceLine {
  return { kind: 'rental', ...p, amountCents: lineAmount(p.qty, p.units, p.unitRateCents) };
}

export function saleLine(p: {
  description: string;
  itemCode: string;
  variation?: string | null;
  qty: number;
  salePriceCents: Cents;
}): InvoiceLine {
  return {
    kind: 'sale',
    description: p.description,
    itemCode: p.itemCode,
    variation: p.variation ?? null,
    qty: p.qty,
    units: 1,
    unitRateCents: p.salePriceCents,
    amountCents: lineAmount(p.qty, 1, p.salePriceCents),
  };
}

/** Lost/stolen: charged at COST, untaxed. */
export function lostLine(p: {
  description: string;
  itemCode: string;
  variation?: string | null;
  qty: number;
  costCents: Cents;
}): InvoiceLine {
  return {
    kind: 'lost',
    description: p.description,
    itemCode: p.itemCode,
    variation: p.variation ?? null,
    qty: p.qty,
    units: 1,
    unitRateCents: p.costCents,
    amountCents: lineAmount(p.qty, 1, p.costCents),
  };
}

const sumBy = (lines: InvoiceLine[], pred: (l: InvoiceLine) => boolean): Cents =>
  lines.filter(pred).reduce((s, l) => s + l.amountCents, 0);

export function buildInvoice(inputLines: InvoiceLine[], opts: InvoiceOptions): BuiltInvoice {
  const lines = [...inputLines];

  const rentalSubtotalCents = sumBy(lines, (l) => l.kind === 'rental');

  // Rental minimum tops up the rental subtotal — but only when there ARE rentals.
  // An invoice of pure labor/sales should never sprout a $25 rental charge.
  let rentalMinimumAdjustmentCents = 0;
  if (opts.applyRentalMinimum && rentalSubtotalCents > 0 && rentalSubtotalCents < opts.rentalMinimumCents) {
    rentalMinimumAdjustmentCents = opts.rentalMinimumCents - rentalSubtotalCents;
    lines.push({
      kind: 'adjustment',
      description: `Rental minimum ($${(opts.rentalMinimumCents / 100).toFixed(2)})`,
      qty: 1,
      units: 1,
      unitRateCents: rentalMinimumAdjustmentCents,
      amountCents: rentalMinimumAdjustmentCents,
    });
  }

  const salesSubtotalCents = sumBy(lines, (l) => l.kind === 'sale');
  const otherSubtotalCents = sumBy(
    lines,
    (l) => l.kind === 'lost' || l.kind === 'labor' || l.kind === 'lump_sum' || l.kind === 'misc'
  );

  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);

  // Tax base is sales ONLY.
  const taxableBaseCents = salesSubtotalCents;
  const taxCents = Math.round(taxableBaseCents * (opts.taxRatePct / 100));
  const totalCents = subtotalCents + taxCents;

  return {
    lines,
    totals: {
      rentalSubtotalCents,
      salesSubtotalCents,
      otherSubtotalCents,
      rentalMinimumAdjustmentCents,
      subtotalCents,
      taxableBaseCents,
      taxCents,
      totalCents,
    },
  };
}
