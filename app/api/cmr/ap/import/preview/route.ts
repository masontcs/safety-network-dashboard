import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import {
  importAccount,
  parseApUpload,
  previewSummary,
  readApUpload,
  replacedSummary,
  serverError,
} from '@/lib/cmr/ap-server'

/**
 * SN Cash Ledger — AP import, step 1 of 2: PREVIEW. CONTROLLER ONLY.
 *
 *   POST multipart { accountId, file: <A/P Aging Detail .xlsx> }
 *     → the parsed file's summary — line counts by doc type, vendor counts, the payable total,
 *       the report's TOTAL and whether the lines reconcile to it, the largest vendors — plus
 *       the snapshot a commit would replace. WRITES NOTHING.
 *
 * Refused: no session 401; no grant / not a Controller 403; unknown account 404; inactive
 * account 409; a file that is not an .xlsx A/P Aging Detail report 400.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/ap-server.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const upload = await readApUpload(request)
    if (!upload.ok) return upload.response

    const supabase = createServiceClient()
    const account = await importAccount(supabase, upload.value.accountId)
    if (!account.ok) return account.response

    const parsed = parseApUpload(upload.value.bytes)
    if (!parsed.ok) return parsed.response

    return NextResponse.json({
      success: true,
      data: {
        account: { id: account.value.id, name: account.value.name },
        fileName: upload.value.fileName,
        summary: previewSummary(parsed.value),
        replaces: await replacedSummary(supabase, account.value.id),
      },
    })
  } catch (err) {
    return serverError(err, 'api/cmr/ap/import/preview')
  }
}
