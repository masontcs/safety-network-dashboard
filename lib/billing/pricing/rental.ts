/**
 * Per-batch rental math — the differentiator.
 *
 * Big systems segment the billing week by inventory-change events and aggregate
 * quantity (25@2 + 50@4). TCR bills PER BATCH from each pickup's own start date
 * (25@6 + 25@4). With uniform live rates the dollars match, but per-batch is what
 * the customer can actually read: "what's been out, since when."
 *
 * DECIDED (2026-07-09, Mason):
 *   - Pickup day AND return day are BOTH billed.
 *   - Lost/stolen units leave the on-rent pool and stop accruing rent as of the
 *     lost date; the lost day itself is billed (treated like a return day).
 *     Lost units are charged separately at item COST (see invoice.ts), untaxed.
 *
 * Returns/losses consume the OLDEST open batch first (FIFO) — you return the
 * cones you picked up first.
 */
import { addDays, calendarMonths, cmpDate, daysInclusive, maxDate, minDate } from './dates';
import { BILLING_TYPES, type BillingType, type ISODate, type RateUnit } from './types';

export type LedgerEventType = 'pickup' | 'return' | 'lost';

export interface LedgerEvent {
  date: ISODate;
  type: LedgerEventType;
  qty: number; // always positive; `type` carries the sign
}

export interface Batch {
  qty: number;
  start: ISODate;
  /** null === still on rent */
  end: ISODate | null;
  endReason: 'return' | 'lost' | null;
}

export interface BillingWindow {
  start: ISODate;
  end: ISODate;
}

export interface RentalDayOptions {
  billReturnDay: boolean;
  billLostDay: boolean;
  /** How a partial week/month counts. 'ceil' = any part of a period bills the full period. */
  partialPeriod: 'ceil';
}

export const DEFAULT_RENTAL_OPTIONS: RentalDayOptions = {
  billReturnDay: true, // decided
  billLostDay: true, // decided (consistent with return day)
  partialPeriod: 'ceil',
};

/**
 * Fold a quantity ledger into batches. Pickups open batches; returns/losses
 * close them FIFO, splitting a batch when a return is partial.
 */
export function buildBatches(events: LedgerEvent[]): Batch[] {
  const sorted = [...events].sort((a, b) => cmpDate(a.date, b.date) || rank(a.type) - rank(b.type));
  const open: Batch[] = [];
  const closed: Batch[] = [];

  for (const ev of sorted) {
    if (ev.qty <= 0) throw new Error(`Ledger event qty must be positive: ${JSON.stringify(ev)}`);

    if (ev.type === 'pickup') {
      open.push({ qty: ev.qty, start: ev.date, end: null, endReason: null });
      continue;
    }

    let remaining = ev.qty;
    const reason = ev.type === 'return' ? 'return' : 'lost';

    while (remaining > 0) {
      const b = open[0];
      if (!b) throw new Error(`Ledger ${ev.type} of ${ev.qty} on ${ev.date} exceeds on-rent quantity`);

      const take = Math.min(remaining, b.qty);
      closed.push({ qty: take, start: b.start, end: ev.date, endReason: reason });
      b.qty -= take;
      remaining -= take;
      if (b.qty === 0) open.shift();
    }
  }

  return [...closed, ...open];
}

// pickups settle before returns on the same date, so a same-day pickup+return is 1 billed day
const rank = (t: LedgerEventType) => (t === 'pickup' ? 0 : 1);

/** The actual billable span of a batch inside a window, after end-day rules. */
export interface BillableSpan {
  start: ISODate;
  /** Inclusive, already adjusted for billReturnDay / billLostDay. */
  end: ISODate;
  days: number;
  /** The batch ENDED inside this window (so a partial period bills in full). */
  closedInWindow: boolean;
}

export function billableSpan(
  batch: Batch,
  win: BillingWindow,
  opts: RentalDayOptions = DEFAULT_RENTAL_OPTIONS
): BillableSpan | null {
  const start = maxDate(batch.start, win.start);
  const rawEnd = batch.end ?? win.end;
  let end = minDate(rawEnd, win.end);

  if (cmpDate(end, start) < 0) return null;

  // Only drop the end day when the batch actually ENDED inside the window.
  const closedInWindow = batch.end != null && cmpDate(batch.end, win.end) <= 0;
  if (closedInWindow) {
    const drop =
      (batch.endReason === 'return' && !opts.billReturnDay) || (batch.endReason === 'lost' && !opts.billLostDay);
    if (drop) end = addDays(end, -1);
  }

  if (cmpDate(end, start) < 0) return null;
  return { start, end, days: daysInclusive(start, end), closedInWindow };
}

/** Billable days for one batch clipped to the billing window. */
export function billableDays(
  batch: Batch,
  win: BillingWindow,
  opts: RentalDayOptions = DEFAULT_RENTAL_OPTIONS
): number {
  return billableSpan(batch, win, opts)?.days ?? 0;
}

/**
 * Periods billed for a span, in the unit the entered rate is expressed in.
 * This is period COUNTING, not rate proration — we never divide a rate.
 *
 *  - `closed === false` (still on rent): only COMPLETED periods bill.
 *  - `closed === true`  (returned/lost): a trailing partial period bills in full.
 *
 * Months are CALENDAR months anchored on the span's start date, so
 * Jan 1 .. Jan 31 is exactly one month even though it is 31 days.
 */
export function unitsForSpan(start: ISODate, endInclusive: ISODate, rateUnit: RateUnit, closed: boolean): number {
  if (cmpDate(endInclusive, start) < 0) return 0;

  if (rateUnit === 'day') return daysInclusive(start, endInclusive);

  if (rateUnit === 'week') {
    const d = daysInclusive(start, endInclusive);
    return closed ? Math.ceil(d / 7) : Math.floor(d / 7);
  }

  const { full, partial } = calendarMonths(start, endInclusive);
  return closed ? full + (partial ? 1 : 0) : full;
}

export interface BatchCharge {
  batch: Batch;
  days: number;
  units: number;
  qty: number;
}

/**
 * Per-batch charge rows for a single window — the presentation the customer sees.
 * For multi-cycle (ongoing) rentals use `accrualPlan` in cycles.ts, which is the
 * authoritative, idempotent path; this helper is for one-shot windows.
 */
export function batchCharges(
  batches: Batch[],
  win: BillingWindow,
  billingType: BillingType,
  opts: RentalDayOptions = DEFAULT_RENTAL_OPTIONS
): BatchCharge[] {
  const { rateUnit } = BILLING_TYPES[billingType];
  return batches
    .map((batch) => {
      const span = billableSpan(batch, win, opts);
      if (!span) return null;
      return {
        batch,
        days: span.days,
        units: unitsForSpan(span.start, span.end, rateUnit, span.closedInWindow),
        qty: batch.qty,
      };
    })
    .filter((c): c is BatchCharge => c !== null && c.days > 0);
}

/** Quantity still on rent as of a date (lost units have already left the pool). */
export function onRentQty(batches: Batch[], asOf: ISODate): number {
  return batches
    .filter((b) => cmpDate(b.start, asOf) <= 0 && (b.end == null || cmpDate(b.end, asOf) > 0))
    .reduce((s, b) => s + b.qty, 0);
}
