import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { loadAccounts } from '@/lib/cmr/ledger-server'
import { CMR_REQUEST_COLS, CMR_REQUEST_NOTES_MAX, parseRequestNotes, toCmrRequest, type CmrRequestRow } from '@/lib/cmr/requests'
import {
  UUID_RE,
  auditor,
  bad,
  isInputViolation,
  readJson,
  requestById,
  serverError,
  snapshot,
} from '@/lib/cmr/requests-server'

/**
 * SN Cash Ledger — decline a queued vendor request. CONTROLLER ONLY.
 *
 *   POST { id, reason? }  → queued → declined. The row stays (the Requester can see what
 *                           happened); an optional reason is appended to its notes so the
 *                           answer travels with the request, and is also recorded in the audit
 *                           entry on its own.
 *
 * Declining never touches the placement columns — a declined request carries none (the DB
 * CHECK enforces that). Only a QUEUED request can be declined: a placed one is already a line
 * item somewhere, and re-declining an already-declined one is a no-op conflict.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!UUID_RE.test(id)) return bad('Choose a request.')
    const reason = parseRequestNotes(body.reason)
    if (!reason.ok) return bad(reason.error)

    const supabase = createServiceClient()
    const [accounts, before] = await Promise.all([loadAccounts(supabase), requestById(supabase, id)])
    if (!before) return bad('That request does not exist.', 'NOT_FOUND', 404)
    if (before.status !== 'queued') {
      return bad(
        before.status === 'declined' ? 'That request was already declined.' : 'That request has already been placed.',
        'NOT_QUEUED',
        409,
      )
    }

    // Keep the requester's own note; add the Controller's answer underneath it.
    const declineNote = reason.value ? `Declined: ${reason.value}` : null
    const merged = declineNote ? (before.notes ? `${before.notes}\n${declineNote}` : declineNote) : before.notes
    const notes = merged && merged.length > CMR_REQUEST_NOTES_MAX ? merged.slice(0, CMR_REQUEST_NOTES_MAX) : merged

    const changes = { status: 'declined' as const, notes }
    const { data, error } = await supabase
      .from('cmr_vendor_requests')
      .update(changes)
      .eq('id', id)
      .select(CMR_REQUEST_COLS)
      .single()
    if (isInputViolation(error)) return bad(`That request couldn't be declined: ${error?.message ?? 'invalid values'}.`)
    if (error) throw new Error(error.message)
    const after = (data as unknown as CmrRequestRow | null) ?? ({ ...before, ...changes } as CmrRequestRow)

    await auditor(ctx, request)('cmr.request.decline', id, before.vendor, {
      requestedBy: before.requested_by,
      reason: reason.value,
      before: snapshot({ status: before.status, notes: before.notes }),
      after: snapshot({ status: after.status, notes: after.notes }),
    })

    return NextResponse.json({ success: true, data: { request: toCmrRequest(after, accounts) } })
  } catch (err) {
    return serverError('/decline', err)
  }
}
