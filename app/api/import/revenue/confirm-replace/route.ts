import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { parseRevenueFile } from '@/lib/revenue/parser'
import {
  resolveBranchIds,
  resolveEntityIds,
  buildRevenueCodeMap,
  insertRevenueData,
} from '@/lib/revenue/import-helpers'
import { apiError } from '@/lib/utils/errors'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 1. Auth
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // 2. Admin only
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    // 3. Parse form
    const form = await request.formData()
    const file = form.get('file')
    const replaceImportId = form.get('replaceImportId')

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (typeof replaceImportId !== 'string' || !replaceImportId) {
      return NextResponse.json({ success: false, error: 'replaceImportId is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    // 4. Parse file
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseRevenueFile(buffer)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error, code: 'PARSE_ERROR' }, { status: 400 })
    }

    const { periodDate, records, warnings } = parsed.data
    const supabase = createServiceClient()

    // 5. Verify the import to replace exists
    const { data: oldImport, error: oldErr } = await supabase
      .from('revenue_imports').select('id').eq('id', replaceImportId).maybeSingle()
    if (oldErr) throw new Error(`Failed to verify import: ${oldErr.message}`)
    if (!oldImport) {
      return NextResponse.json({ success: false, error: 'Import not found.', code: 'NOT_FOUND' }, { status: 404 })
    }

    // 6. Delete old import (CASCADE removes all revenue_transactions)
    const { error: delErr } = await supabase.from('revenue_imports').delete().eq('id', replaceImportId)
    if (delErr) throw new Error(`Failed to delete old import: ${delErr.message}`)

    // 7. Resolve lookups
    const branchNames = [...new Set(records.map((r) => r.branchName))]
    const entityCodes = [...new Set(records.map((r) => r.entityCode))]

    const { branchMap, warnings: branchWarnings } = await resolveBranchIds(branchNames, supabase)
    const entityMap = await resolveEntityIds(entityCodes, supabase)
    const revenueCodeMap = await buildRevenueCodeMap(supabase)

    const allWarnings = [...warnings, ...branchWarnings]

    // 8. Insert new import record
    const { data: importRecord, error: importErr } = await supabase
      .from('revenue_imports')
      .insert({ period_date: periodDate, imported_by: ctx.access.userId, status: 'pending' })
      .select('id').single()
    if (importErr || !importRecord) throw new Error(`Failed to create revenue import: ${importErr?.message}`)

    // 9. Insert transactions
    const { insertedCount, skippedCount, warnings: insertWarnings } = await insertRevenueData(
      importRecord.id, periodDate, records, branchMap, entityMap, revenueCodeMap, supabase
    )

    return NextResponse.json({
      success: true,
      data: {
        importId: importRecord.id,
        periodDate,
        insertedCount,
        skippedCount,
        warnings: [...allWarnings, ...insertWarnings],
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
