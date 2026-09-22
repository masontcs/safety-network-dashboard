import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'
import { normalizeVendorName } from '@/lib/cmr/vendors'
import {
  ApReplaceRefused,
  bad,
  importAccount,
  knownVendorKeys,
  parseApUpload,
  previewSummary,
  readApUpload,
  replaceApImport,
  replacedSummary,
  serverError,
} from '@/lib/cmr/ap-server'

/**
 * SN Cash Ledger — AP import, step 2 of 2: COMMIT. CONTROLLER ONLY.
 *
 *   POST multipart { accountId, file, expectedLineCount?, expectedReportTotalCents? }
 *     → parses the file again (the server never trusts a preview it did not just compute),
 *       then REPLACES the account's AP snapshot in one database transaction
 *       (cmr_ap_replace_import): the previous current import and its lines are deleted and the
 *       new import + every line inserted, so exactly one snapshot per account remains.
 *       Audited as cmr.ap.import, with what it replaced.
 *       AP Phase 3a: the same transaction links every line to its canonical vendor (an identical
 *       normalized spelling reuses the existing vendor; an unseen one registers a new vendor).
 *       The audit entry lists the vendors this import registered.
 *
 * `expectedLineCount` / `expectedReportTotalCents` are the figures the Preview showed; if the
 * file sent now parses differently the commit is refused (409 PREVIEW_MISMATCH) and nothing
 * changes.
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
    const { accountId, fileName, bytes, expectedLineCount, expectedReportTotalCents } = upload.value

    const supabase = createServiceClient()
    const account = await importAccount(supabase, accountId)
    if (!account.ok) return account.response

    const parsed = parseApUpload(bytes)
    if (!parsed.ok) return parsed.response
    const p = parsed.value

    if (
      (expectedLineCount !== null && expectedLineCount !== p.lineCount) ||
      (expectedReportTotalCents !== null && expectedReportTotalCents !== p.reportTotalCents)
    ) {
      return bad('That file is not the one you previewed. Preview it again before importing.', 'PREVIEW_MISMATCH', 409)
    }

    const replaced = await replacedSummary(supabase, accountId)

    // Which spellings are already canonical vendors — only so the audit entry can name the ones
    // this import registers. Never blocks the import: on a read error the list is just omitted.
    const spellings = [...new Set(p.lines.map((l) => normalizeVendorName(l.vendorName)).filter(Boolean))]
    let known: Set<string> | null = null
    try {
      known = await knownVendorKeys(supabase, p.lines.map((l) => l.vendorName))
    } catch (e) {
      console.error('[api/cmr/ap/import/commit] vendor pre-read', e)
    }

    let importId: string
    try {
      importId = await replaceApImport(supabase, {
        accountId,
        actor: ctx.userId,
        fileName,
        reportTotalCents: p.reportTotalCents,
        lines: p.lines,
      })
    } catch (e) {
      if (e instanceof ApReplaceRefused) {
        return e.code === 'NOT_FOUND' ? bad(e.message, 'NOT_FOUND', 404) : bad(e.message, 'ACCOUNT_INACTIVE', 409)
      }
      throw e
    }

    const summary = previewSummary(p)
    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.ap.import',
      resourceType: 'cmr_ap_imports',
      resourceId: importId,
      resourceLabel: `${account.value.name} · ${fileName}`,
      metadata: {
        accountId,
        accountName: account.value.name,
        sourceFilename: fileName,
        lineCount: p.lineCount,
        payableLineCount: p.payableLineCount,
        vendorCount: p.vendorCount,
        payableVendorCount: p.payableVendorCount,
        docTypeCounts: p.docTypeCounts,
        reportTotalCents: p.reportTotalCents,
        importedTotalCents: p.importedTotalCents,
        payableTotalCents: p.payableTotalCents,
        reconciled: p.reconciled,
        replaced,
        vendors: vendorAudit(spellings, known),
      },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json(
      {
        success: true,
        data: { importId, account: { id: account.value.id, name: account.value.name }, fileName, summary, replaced },
      },
      { status: 201 },
    )
  } catch (err) {
    return serverError(err, 'api/cmr/ap/import/commit')
  }
}

/** The canonical-vendor part of the cmr.ap.import audit entry (at most 50 names listed). */
function vendorAudit(spellings: string[], known: Set<string> | null) {
  if (!known) return { distinctSpellings: spellings.length, registered: null }
  const registered = spellings.filter((k) => !known.has(k)).sort()
  return {
    distinctSpellings: spellings.length,
    registeredCount: registered.length,
    registered: registered.slice(0, 50),
  }
}
