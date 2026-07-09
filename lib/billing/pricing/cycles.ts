/**
 * Ongoing-rental lifecycle.
 *
 * A rental ticket is NOT "invoiced once -> terminal". Equipment stays out for
 * weeks; the ticket carries a recurring tag and bills each cycle until full
 * return. This module answers: "as of today, what does this ticket still owe?"
 *
 * ── Why the naive model overbills ────────────────────────────────────────
 * Recomputing the window on each billing run charges a `monthly_billed_monthly`
 * ticket `ceil(7 days / 30) = 1 month` EVERY WEEK. Four months in a month.
 *
 * ── The model: cumulative qty-units, per PICKUP LOT ──────────────────────
 * A **lot** is one pickup (identified by its start date). Over time a lot's
 * quantity splits into sub-batches as units are returned or lost at different
 * dates — but the lot's identity never changes.
 *
 * We key the accrual ledger by lot, and accumulate **qty-units** (qty x periods):
 *
 *   for each sub-batch:  units = open   ? floor(days / periodDays)   // never bill a partial period
 *                                closed ? ceil(days / periodDays)    // final partial bills a full period
 *   cumulativeQtyUnits(lot) = SUM( subBatch.qty * units )
 *   qtyUnitsToBill          = cumulativeQtyUnits - qtyUnitsAlreadyBilled
 *   amount                  = qtyUnitsToBill * unitRate
 *
 * Keying by lot (not by batch) is load-bearing. A batch's identity contains its
 * end date, so it CHANGES the moment the batch closes — a batch-keyed ledger
 * would forget what it had billed and re-charge the whole rental. Lots are stable.
 *
 * Properties this buys us:
 *   - **Idempotent.** Re-running a billing run bills 0 more.
 *   - **No overbilling.** A monthly ticket accrues quietly across weekly runs,
 *     then bills one month when the month completes.
 *   - **No gaps, no double-bills.** Cumulative math cannot skip or repeat a day.
 *   - **Live re-rating for free.** Billed units are frozen on their invoices;
 *     whatever bills next is multiplied by the CURRENT rate. Exactly
 *     "current rate applies to everything not yet invoiced."
 *   - **Retroactive edits are detectable.** Backdate a return and the lot's
 *     cumulative total drops below what was billed -> negative `qtyUnitsToBill`
 *     -> that is the governed-adjustment cascade's "affected invoices" list.
 *
 * Per-batch invoice presentation ("25@6d + 25@4d") is preserved: separate
 * pickups are separate lots. Only partial returns *from the same pickup* share
 * a lot, and the spec already treats that grouping as presentation-only
 * (identical dollars either way).
 */
import { cmpDate } from './dates';
import { billableSpan, unitsForSpan, DEFAULT_RENTAL_OPTIONS, type Batch, type RentalDayOptions } from './rental';
import { BILLING_TYPES, type BillingType, type ISODate } from './types';

/** Display identity for one sub-batch. NOT used for the ledger — see LotKey. */
export type BatchKey = string;
export const batchKey = (b: Batch): BatchKey => `${b.start}|${b.end ?? 'open'}|${b.endReason ?? ''}`;

/** Ledger identity: the pickup lot. Stable across closes and splits. */
export type LotKey = ISODate;
export const lotKey = (b: Batch): LotKey => b.start;

/** Collapse sub-batches that share (start, end, reason) — one line, not two. */
export function mergeBatches(batches: Batch[]): Batch[] {
  const m = new Map<BatchKey, Batch>();
  for (const b of batches) {
    const k = batchKey(b);
    const cur = m.get(k);
    if (cur) cur.qty += b.qty;
    else m.set(k, { ...b });
  }
  return [...m.values()];
}

export const isRecurring = (batches: Batch[]): boolean => batches.some((b) => b.end === null);
export const isFullyReturned = (batches: Batch[]): boolean =>
  batches.length > 0 && batches.every((b) => b.end !== null);

/** Cumulative qty-units invoiced, per pickup lot. Persisted alongside the ticket. */
export type AccrualLedger = Record<LotKey, number>;

export interface SubBatchDetail {
  qty: number;
  days: number;
  units: number;
  closed: boolean;
  end: ISODate | null;
  endReason: Batch['endReason'];
}

export interface AccrualRow {
  lotKey: LotKey;
  start: ISODate;
  /** Sub-batches of this lot — the per-batch breakdown shown to the customer. */
  detail: SubBatchDetail[];
  cumulativeQtyUnits: number;
  qtyUnitsAlreadyBilled: number;
  /** Positive = bill now. Negative = previously overbilled (retroactive edit). */
  qtyUnitsToBill: number;
  /** Every sub-batch of this lot has ended. */
  fullyClosed: boolean;
  /** Quantity from this lot still on rent. */
  openQty: number;
}

export interface AccrualPlan {
  rows: AccrualRow[];
  chargeable: AccrualRow[];
  recurring: boolean;
  fullyReturned: boolean;
}

export function accrualPlan(params: {
  batches: Batch[];
  asOf: ISODate;
  billingType: BillingType;
  alreadyBilled?: AccrualLedger;
  options?: RentalDayOptions;
}): AccrualPlan {
  const { batches, asOf, billingType } = params;
  const alreadyBilled = params.alreadyBilled ?? {};
  const opts = params.options ?? DEFAULT_RENTAL_OPTIONS;
  const { rateUnit } = BILLING_TYPES[billingType];

  const merged = mergeBatches(batches);

  // Group sub-batches into pickup lots.
  const lots = new Map<LotKey, Batch[]>();
  for (const b of merged) {
    if (cmpDate(b.start, asOf) > 0) continue; // hasn't started yet — owes nothing
    const k = lotKey(b);
    const arr = lots.get(k);
    if (arr) arr.push(b);
    else lots.set(k, [b]);
  }

  const rows: AccrualRow[] = [];

  for (const [key, subs] of lots) {
    const detail: SubBatchDetail[] = subs.map((b) => {
      // Anchor the span at the batch's OWN pickup date, so calendar months
      // count from the pickup, not from the billing-run window.
      const span = billableSpan(b, { start: b.start, end: asOf }, opts);
      if (!span) return { qty: b.qty, days: 0, units: 0, closed: false, end: b.end, endReason: b.endReason };
      const units = unitsForSpan(span.start, span.end, rateUnit, span.closedInWindow);
      return { qty: b.qty, days: span.days, units, closed: span.closedInWindow, end: b.end, endReason: b.endReason };
    });

    const cumulativeQtyUnits = detail.reduce((s, d) => s + d.qty * d.units, 0);
    const qtyUnitsAlreadyBilled = alreadyBilled[key] ?? 0;

    rows.push({
      lotKey: key,
      start: key,
      detail,
      cumulativeQtyUnits,
      qtyUnitsAlreadyBilled,
      qtyUnitsToBill: cumulativeQtyUnits - qtyUnitsAlreadyBilled,
      fullyClosed: detail.every((d) => d.closed),
      openQty: detail.filter((d) => !d.closed).reduce((s, d) => s + d.qty, 0),
    });
  }

  rows.sort((a, b) => cmpDate(a.start, b.start));

  return {
    rows,
    chargeable: rows.filter((r) => r.qtyUnitsToBill > 0),
    recurring: isRecurring(merged),
    fullyReturned: isFullyReturned(merged),
  };
}

/** Fold a completed billing run back into the ledger. Call ONLY after the invoice is generated. */
export function commitAccruals(prev: AccrualLedger, plan: AccrualPlan): AccrualLedger {
  const next: AccrualLedger = { ...prev };
  for (const r of plan.chargeable) next[r.lotKey] = r.qtyUnitsAlreadyBilled + r.qtyUnitsToBill;
  return next;
}

export interface Reconciliation {
  /** Billed more than is now owed — a retroactive edit (e.g. backdated return). */
  overBilled: { lotKey: LotKey; qtyUnitsBilled: number; qtyUnitsNowOwed: number; qtyUnitsToCredit: number }[];
  /** Lots we billed against that no longer exist (a pickup was deleted or its date changed). */
  vanished: LotKey[];
  clean: boolean;
}

/**
 * Compare what was billed against what the CURRENT ledger says is owed.
 * Feeds the governed-adjustment cascade — the "these invoices are affected,
 * are you sure?" confirm — and the accounting QB-reconciliation queue.
 */
export function reconcileAccruals(prev: AccrualLedger, plan: AccrualPlan): Reconciliation {
  const seen = new Set(plan.rows.map((r) => r.lotKey));

  const overBilled = plan.rows
    .filter((r) => r.qtyUnitsToBill < 0)
    .map((r) => ({
      lotKey: r.lotKey,
      qtyUnitsBilled: r.qtyUnitsAlreadyBilled,
      qtyUnitsNowOwed: r.cumulativeQtyUnits,
      qtyUnitsToCredit: -r.qtyUnitsToBill,
    }));

  const vanished = Object.keys(prev).filter((k) => !seen.has(k) && (prev[k] ?? 0) > 0);

  return { overBilled, vanished, clean: overBilled.length === 0 && vanished.length === 0 };
}
