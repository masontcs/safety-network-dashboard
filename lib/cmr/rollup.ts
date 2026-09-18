import type { CmrRecurringFrequency, CmrRecurringSection } from '@/lib/supabase/database.types'
import { CMR_RECURRING_FREQUENCIES, CMR_RECURRING_SECTION_LABEL } from '@/lib/cmr/recurring'
import type { CmrDueState } from '@/lib/cmr/recurring-due'
import type { CmrLedgerPeriod } from '@/lib/cmr/ledger'

/**
 * SN Cash Ledger (CMR) weekly rollup — shared shapes and the totals math for /api/cmr/rollup
 * and the Weekly rollup screen. No server-only imports, so the client computes the account
 * filter itself: the API sends every vendor's state for the week once and filtering is instant,
 * with the same function deciding the numbers on both sides.
 *
 * The week runs Sunday → Saturday, like every other CMR week (lib/cmr/week).
 */

export type { CmrRecurringFrequency, CmrDueState }

/** One saved AM or PM snapshot of a day. */
export interface CmrRollupSnapshot {
  period: CmrLedgerPeriod
  beginningCashCents: number
  adjustmentsTotalCents: number
  /** Σ pending items that still count (a pushed item counts on the day it moved to). */
  pendingRollupCents: number
  currentBalanceCents: number
}

export interface CmrRollupDay {
  date: string
  am: CmrRollupSnapshot | null
  pm: CmrRollupSnapshot | null
}

/**
 * The week's cash picture. "Beginning" is the beginning cash of the FIRST snapshot saved in the
 * week and "end" the current balance of the LAST — both are labelled with their day and
 * AM/PM on the screen, because a week with only a Wednesday PM snapshot must not read as if it
 * were Sunday to Saturday.
 */
export interface CmrRollupCash {
  snapshotCount: number
  openingDate: string | null
  openingPeriod: CmrLedgerPeriod | null
  openingCents: number
  closingDate: string | null
  closingPeriod: CmrLedgerPeriod | null
  closingCents: number
}

export interface CmrRollupPendingTotals {
  /** Σ every pending item on the week's snapshots that still counts. */
  totalCents: number
  paidCents: number
  openCents: number
  count: number
  openCount: number
}

export interface CmrRollupPriorityTotals {
  neededCents: number
  paidResolvedCents: number
  totalCents: number
  count: number
  openCount: number
  openTopPriorityCount: number
}

export interface CmrRollupAccountRef {
  id: string
  name: string
  active: boolean
  sortOrder: number
}

/** One recurring vendor's standing for the week being viewed. */
export interface CmrRollupVendorState {
  vendorId: string
  vendorName: string
  accountId: string
  accountName: string
  accountActive: boolean
  section: CmrRecurringSection
  /** The schedule in words, e.g. "Every Thursday". */
  scheduleText: string
  /** The vendor's standing amount. */
  amountCents: number
  lastAmountSentCents: number | null
  /** What accepting would actually enter: last amount sent when known, else the standing amount. */
  suggestedCents: number
  notes: string | null
  active: boolean
  onHold: boolean
  scheduleComplete: boolean
  state: CmrDueState
  occurrenceDate: string | null
  handledBy: 'pending' | 'priority' | null
}

export interface CmrRecurringFrequencyTotal {
  frequency: CmrRecurringFrequency
  label: string
  /** Vendors of this frequency in scope: active, not on hold, with a schedule. */
  vendorCount: number
  /** Σ their standing amounts — what one full cycle of this frequency costs. */
  totalCents: number
  dueCount: number
  dueCents: number
  handledCount: number
  handledCents: number
}

export interface CmrRollupView {
  weekStart: string
  weekEnd: string
  today: string
  thisWeekStart: string
  days: CmrRollupDay[]
  cash: CmrRollupCash
  pending: CmrRollupPendingTotals
  priorities: CmrRollupPriorityTotals
  accounts: CmrRollupAccountRef[]
  /** Every recurring vendor's standing for this week — the client filters by account. */
  recurring: CmrRollupVendorState[]
  canEdit: boolean
}

// ── the math ────────────────────────────────────────────────────────────────

/** A vendor is part of the recurring picture when it could actually be paid this cycle. */
export const inRecurringScope = (v: CmrRollupVendorState): boolean =>
  v.active && !v.onHold && v.section !== 'urgent' && v.scheduleComplete

/** `null` means every account. An unknown id simply matches nothing. */
export const matchesAccount = (v: CmrRollupVendorState, accountId: string | null): boolean =>
  accountId === null || v.accountId === accountId

/**
 * Totals per frequency for the chosen account (or all of them). Every frequency is listed even
 * when it has no vendors, so the row of figures doesn't jump around as the filter changes.
 *
 * totalCents is what a full cycle of that frequency costs — every in-scope vendor's standing
 * amount, whether or not this week is one it falls in. due/handled count only the vendors whose
 * occurrence belongs to the week being viewed, and use the SUGGESTED amount (what would
 * actually be entered), which is what the Controller is deciding about.
 */
export function rollupRecurringTotals(
  vendors: CmrRollupVendorState[],
  accountId: string | null = null,
): CmrRecurringFrequencyTotal[] {
  const byFrequency = new Map<CmrRecurringFrequency, CmrRecurringFrequencyTotal>(
    CMR_RECURRING_FREQUENCIES.map((frequency) => [
      frequency,
      {
        frequency,
        label: CMR_RECURRING_SECTION_LABEL[frequency],
        vendorCount: 0,
        totalCents: 0,
        dueCount: 0,
        dueCents: 0,
        handledCount: 0,
        handledCents: 0,
      },
    ]),
  )

  for (const v of vendors) {
    if (!inRecurringScope(v) || !matchesAccount(v, accountId)) continue
    const t = byFrequency.get(v.section as CmrRecurringFrequency)
    if (!t) continue
    t.vendorCount += 1
    t.totalCents += v.amountCents
    if (v.state === 'due') {
      t.dueCount += 1
      t.dueCents += v.suggestedCents
    } else if (v.state === 'handled') {
      t.handledCount += 1
      t.handledCents += v.suggestedCents
    }
  }
  return [...byFrequency.values()]
}

/** Everything due this week for the chosen account, soonest first then by name. */
export function dueThisWeek(vendors: CmrRollupVendorState[], accountId: string | null = null): CmrRollupVendorState[] {
  return vendors
    .filter((v) => v.state === 'due' && matchesAccount(v, accountId))
    .sort(
      (a, b) =>
        (a.occurrenceDate ?? '').localeCompare(b.occurrenceDate ?? '') ||
        a.vendorName.localeCompare(b.vendorName, undefined, { sensitivity: 'base' }) ||
        a.vendorId.localeCompare(b.vendorId),
    )
}

/** Σ what is due this week, across every frequency, for the chosen account. */
export const dueTotalCents = (vendors: CmrRollupVendorState[], accountId: string | null = null): number =>
  dueThisWeek(vendors, accountId).reduce((sum, v) => sum + v.suggestedCents, 0)

/** The accounts that actually appear in the recurring picture, for the filter. */
export function accountsInUse(vendors: CmrRollupVendorState[], accounts: CmrRollupAccountRef[]): CmrRollupAccountRef[] {
  const used = new Set(vendors.filter(inRecurringScope).map((v) => v.accountId))
  return accounts.filter((a) => used.has(a.id))
}

/** The opening / closing figures from the week's saved snapshots, in day then AM-before-PM order. */
export function rollupCash(days: CmrRollupDay[]): CmrRollupCash {
  const saved: { date: string; period: CmrLedgerPeriod; snapshot: CmrRollupSnapshot }[] = []
  for (const d of days) {
    if (d.am) saved.push({ date: d.date, period: 'am', snapshot: d.am })
    if (d.pm) saved.push({ date: d.date, period: 'pm', snapshot: d.pm })
  }
  const first = saved[0]
  const last = saved[saved.length - 1]
  return {
    snapshotCount: saved.length,
    openingDate: first?.date ?? null,
    openingPeriod: first?.period ?? null,
    openingCents: first ? first.snapshot.beginningCashCents : 0,
    closingDate: last?.date ?? null,
    closingPeriod: last?.period ?? null,
    closingCents: last ? last.snapshot.currentBalanceCents : 0,
  }
}
