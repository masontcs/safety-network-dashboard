import { NextResponse } from 'next/server'
import { createRouteClient, createServiceClient } from '@/lib/supabase/server'
import { isFieldRole } from '@/lib/utils/interfaces'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Auth + authorisation for the TECH app (`/api/tech/*`).
 *
 * Deliberately separate from getAccessContext (the dashboard/billing one). The two role
 * sets are disjoint: a dashboard role can never pass through here, and a `tech` is
 * rejected by getAccessContext. Neither can drift into the other's surface.
 *
 * Every route here obeys three rules:
 *  1. **role === 'tech'** — no dashboard role gets in, even an admin.
 *  2. **The ticket must be ASSIGNED to the caller.** A *positive* check ("is this mine?"),
 *     never a filter someone can forget. Unassigned = 404, not 403, because a 403
 *     confirms the ticket exists.
 *  3. **Writes require status === 'active'.** That single condition is also what makes a
 *     ticket visible, so visibility and editability can never disagree.
 *
 * And the rule that outranks all of them: **responses are money-blind.** No rate, price,
 * cost or total may appear in any payload here. A price that never leaves the server
 * can't leak through a screenshot, a shared phone, or a decompiled bundle.
 */

export interface TechIdentity {
  userId: string
  technicianId: string
  name: string
}

export type TechResult =
  | { ok: true; tech: TechIdentity }
  | { ok: false; response: NextResponse }

const fail = (error: string, code: string, status: number) => ({
  ok: false as const,
  response: NextResponse.json({ success: false, error, code }, { status }),
})

/** Resolve the caller to an active technician, or refuse. */
export async function getTechContext(): Promise<TechResult> {
  const routeClient = createRouteClient()
  const { data: claimsData, error: authError } = await routeClient.auth.getClaims()
  const userId = claimsData?.claims?.sub as string | undefined
  if (authError || !userId) return fail('Unauthorized.', 'UNAUTHORIZED', 401)

  const supabase = createServiceClient()
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, role')
    .eq('id', userId)
    .single()
  if (!profile) return fail('User profile not found.', 'NOT_FOUND', 404)

  // Positive check: ONLY a field role may use this API. An admin is not a tech.
  if (!isFieldRole(profile.role as Role)) {
    return fail('This API is for the tech app.', 'FORBIDDEN', 403)
  }

  const { data: tech } = await supabase
    .from('billing_technicians')
    .select('id, name, is_active')
    .eq('user_id', userId)
    .maybeSingle()
  if (!tech) return fail('No technician record is linked to this account.', 'FORBIDDEN', 403)
  if (!tech.is_active) return fail('This technician is not active.', 'FORBIDDEN', 403)

  return { ok: true, tech: { userId, technicianId: tech.id, name: tech.name } }
}

export interface AssignedTicket {
  id: string
  ticket_number: string
  ticket_date: string
  status: string
  job_id: string
  feature_add: boolean
  feature_return: boolean
  feature_dtc: boolean
  /** True when the caller is the lead on THIS ticket. Only the lead may submit. */
  isLead: boolean
}

type SB = ReturnType<typeof createServiceClient>

/**
 * Load a ticket ONLY if it's assigned to this technician. Returns null when it isn't —
 * callers must 404 rather than 403 so an unassigned ticket's existence isn't confirmed.
 */
export async function loadAssignedTicket(
  supabase: SB,
  ticketId: string,
  technicianId: string
): Promise<AssignedTicket | null> {
  const { data: assignment, error: aErr } = await supabase
    .from('billing_ticket_assignments')
    .select('is_lead')
    .eq('ticket_id', ticketId)
    .eq('technician_id', technicianId)
    .maybeSingle()
  if (aErr) throw new Error(aErr.message)
  if (!assignment) return null // not mine — as far as this API is concerned it doesn't exist

  const { data: ticket, error: tErr } = await supabase
    .from('billing_tickets')
    .select('id, ticket_number, ticket_date, status, job_id, feature_add, feature_return, feature_dtc')
    .eq('id', ticketId)
    .maybeSingle()
  if (tErr) throw new Error(tErr.message)
  if (!ticket) return null

  return { ...(ticket as Omit<AssignedTicket, 'isLead'>), isLead: assignment.is_lead }
}

export const techBad = (error: string, code = 'VALIDATION_ERROR', status = 400) =>
  NextResponse.json({ success: false, error, code }, { status })

/** Writes are only allowed while the ticket is active — the same rule that makes it visible. */
export const isEditable = (status: string) => status === 'active'

const LEDGER_EVENTS = ['pickup', 'return', 'lost'] as const
export type LedgerEvent = (typeof LEDGER_EVENTS)[number]
const isLedgerEvent = (v: string): v is LedgerEvent => (LEDGER_EVENTS as readonly string[]).includes(v)

export type EventDerivation = { ok: true; eventType: LedgerEvent } | { ok: false; error: string }

/**
 * Which ledger event a tech's equipment entry becomes, given the ticket's features.
 * See v2-tech-app-plan §9.3: rows are stored as pickups and the FEATURE decides what
 * they mean, so a DTC→Add flip converts them with no rewriting.
 *
 * Only ask the tech when it's genuinely ambiguous (Add + Return on one ticket).
 */
export function deriveEventType(
  features: { add: boolean; return: boolean; dtc: boolean },
  requested?: string
): EventDerivation {
  const ok = (eventType: LedgerEvent): EventDerivation => ({ ok: true, eventType })
  const no = (error: string): EventDerivation => ({ ok: false, error })

  if (requested !== undefined && !isLedgerEvent(requested)) return no('Event must be pickup, return, or lost')

  // DTC equipment is a day charge — it never goes on rent, so there's nothing to hand
  // back. Always a pickup row; the DTC feature is what stops it accruing.
  if (features.dtc) {
    if (requested && requested !== 'pickup') return no('A DTC ticket bills equipment for the day — there is nothing to return.')
    return ok('pickup')
  }
  if (requested === 'lost') return ok('lost') // a loss can be discovered on any ticket
  if (features.add && !features.return) return ok('pickup')
  if (features.return && !features.add) return ok(requested ?? 'return')
  if (features.add && features.return) {
    if (!requested) return no('This ticket both adds and returns — say which this is.')
    return ok(requested)
  }
  return no('This ticket has no features set — the office needs to set one first.')
}
