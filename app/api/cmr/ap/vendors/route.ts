import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { apAccounts, bad, buildApPicker, serverError } from '@/lib/cmr/ap-server'

/**
 * SN Cash Ledger — the vendor-request picker's read (AP Phase 2).
 *
 *   GET ?accountId=<uuid> → that account's CURRENT A/P for building a request: the account, its
 *       current import (null when it has none — the form then says "import this account's A/P
 *       first"), and its vendors A–Z, each with its PAYABLE lines only (Bill positive, Credit
 *       negative — both tickable), number, type, bill date, due date, aging and signed balance.
 *       ANY CMR role reads it (a Viewer never sees the form, but reading A/P is not a write).
 *
 * The amount a request stores is never taken from this response: /api/cmr/requests re-reads
 * the lines server-side when the request is submitted.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/ap-server.
 */

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const accountId = (new URL(request.url).searchParams.get('accountId') ?? '').trim()
    if (!UUID.test(accountId)) return bad('Choose an account.')

    const supabase = createServiceClient()
    const account = (await apAccounts(supabase)).find((a) => a.id === accountId)
    if (!account) return bad('That account does not exist.', 'NOT_FOUND', 404)

    const view = await buildApPicker(supabase, account)
    return NextResponse.json({ success: true, data: view })
  } catch (err) {
    return serverError(err, 'api/cmr/ap/vendors')
  }
}
