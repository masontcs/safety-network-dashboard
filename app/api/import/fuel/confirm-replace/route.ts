import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { parseFuelFile } from '@/lib/fuel/parser'
import { resolveCardAssignments, insertFuelData } from '@/lib/fuel/import-helpers'
import { apiError } from '@/lib/utils/errors'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const form = await request.formData()
    const file = form.get('file')
    const replaceImportId = form.get('replaceImportId')

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (typeof replaceImportId !== 'string' || !replaceImportId) {
      return NextResponse.json({ success: false, error: 'replaceImportId is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: existingCards } = await supabase
      .from('fuel_card_assignments')
      .select('card_name')
    const knownCardNames = new Set((existingCards ?? []).map((c) => c.card_name))

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseFuelFile(buffer, file.name, knownCardNames)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error, code: 'PARSE_ERROR' }, { status: 400 })
    }

    const { vendor, dateRangeStart, dateRangeEnd, transactions, newCardNames, warnings } = parsed.data

    // Delete the old import (CASCADE removes its fuel_transactions)
    const { error: deleteErr } = await supabase
      .from('fuel_imports')
      .delete()
      .eq('id', replaceImportId)
    if (deleteErr) throw new Error(`Failed to delete previous import: ${deleteErr.message}`)

    // Insert new import record
    const { data: importRecord, error: importErr } = await supabase
      .from('fuel_imports')
      .insert({
        vendor,
        date_range_start: dateRangeStart,
        date_range_end: dateRangeEnd,
        imported_by: ctx.access.userId,
        status: 'pending',
      })
      .select('id').single()
    if (importErr || !importRecord) throw new Error(`Failed to create fuel import: ${importErr?.message}`)

    const cardMap = await resolveCardAssignments(transactions, vendor, supabase)
    const { insertedCount } = await insertFuelData(importRecord.id, transactions, cardMap, vendor, supabase)

    return NextResponse.json({
      success: true,
      data: {
        importId: importRecord.id,
        vendor,
        dateRangeStart,
        dateRangeEnd,
        insertedCount,
        newCardCount: newCardNames.length,
        warnings,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
