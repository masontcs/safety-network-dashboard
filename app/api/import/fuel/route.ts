import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { parseFuelFile } from '@/lib/fuel/parser'
import { resolveCardAssignments, insertFuelData } from '@/lib/fuel/import-helpers'
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

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File too large (max 10MB)', code: 'FILE_TOO_LARGE' }, { status: 413 })
    }

    // 4. Load existing card names for vendor detection context
    const buffer = Buffer.from(await file.arrayBuffer())

    // Load all known card names (parser needs them to populate newCardNames)
    const { data: existingCards } = await supabase
      .from('fuel_card_assignments')
      .select('card_name')

    const knownCardNames = new Set((existingCards ?? []).map((c) => c.card_name))

    // 5. Parse file (uses file.name for vendor detection)
    const parsed = parseFuelFile(buffer, file.name, knownCardNames)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error, code: 'PARSE_ERROR' }, { status: 400 })
    }

    const { vendor, dateRangeStart, dateRangeEnd, transactions, newCardNames, warnings } = parsed.data

    // 6. Duplicate check — reject if same vendor already has an overlapping date range
    const { data: existing } = await supabase
      .from('fuel_imports')
      .select('id, date_range_start, date_range_end')
      .eq('vendor', vendor)
      .lte('date_range_start', dateRangeEnd)
      .gte('date_range_end', dateRangeStart)
      .limit(1)
      .single()

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: `${vendor} fuel already imported for ${existing.date_range_start} – ${existing.date_range_end}`,
          code: 'DUPLICATE',
          conflict: {
            importId: existing.id,
            vendor,
            dateRangeStart: existing.date_range_start,
            dateRangeEnd: existing.date_range_end,
          },
        },
        { status: 409 },
      )
    }

    // 7. Insert import record
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

    // 8. Resolve card assignments
    const cardMap = await resolveCardAssignments(transactions, vendor, supabase)

    // 9. Insert transactions
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
