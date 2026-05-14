import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { parseArFile } from '@/lib/ar/parser'

const VALID_ENTITY_CODES = ['INC', 'TCS', 'STS'] as const
type EntityCode = (typeof VALID_ENTITY_CODES)[number]

function isEntityCode(code: string): code is EntityCode {
  return (VALID_ENTITY_CODES as readonly string[]).includes(code)
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const form = await request.formData()
    const file = form.get('file')
    const entityCode = form.get('entityCode')
    const reportDateOverride = form.get('reportDate')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }
    if (typeof entityCode !== 'string' || !isEntityCode(entityCode)) {
      return NextResponse.json({ error: 'entityCode must be INC, TCS, or STS' }, { status: 400 })
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseArFile(buffer, entityCode)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const { invoiceRows, totalAr } = parsed.data
    const reportDate =
      typeof reportDateOverride === 'string' && reportDateOverride
        ? reportDateOverride
        : parsed.data.reportDate

    const supabase = createServiceClient()

    // Load class code → branch_id map
    const { data: classCodes } = await supabase
      .from('ar_class_codes')
      .select('code, branch_id')
    const classCodeMap = new Map(
      (classCodes ?? []).map((c) => [c.code as string, c.branch_id as string | null])
    )

    // Collect unique QB customer names from this file
    const qbNames = [...new Set(invoiceRows.map((r) => r.qbName))]

    // Load existing entity refs for this entity (fast path — most imports are re-imports)
    const { data: existingRefs } = await supabase
      .from('ar_customer_entity_refs')
      .select('quickbooks_name, customer_id')
      .eq('entity_code', entityCode)
      .in('quickbooks_name', qbNames)

    const refMap = new Map(
      (existingRefs ?? []).map((r) => [r.quickbooks_name as string, r.customer_id as string])
    )

    // For new names, check if they already exist under another entity (cross-entity linking)
    const unknownNames = qbNames.filter((n) => !refMap.has(n))
    if (unknownNames.length > 0) {
      const { data: crossRefs } = await supabase
        .from('ar_customer_entity_refs')
        .select('quickbooks_name, customer_id')
        .in('quickbooks_name', unknownNames)

      for (const ref of crossRefs ?? []) {
        if (!refMap.has(ref.quickbooks_name)) {
          refMap.set(ref.quickbooks_name, ref.customer_id)
        }
      }
    }

    // Create brand-new customers for names with no match anywhere
    const brandNewNames = qbNames.filter((n) => !refMap.has(n))
    for (const name of brandNewNames) {
      const { data: newCustomer } = await supabase
        .from('ar_customers')
        .insert({ display_name: name })
        .select('id')
        .single()
      if (newCustomer) {
        refMap.set(name, newCustomer.id)
      }
    }

    // Upsert entity refs for all names we now have customer_ids for
    // (covers both cross-entity-linked names and brand-new ones)
    const refsToUpsert = unknownNames
      .filter((n) => refMap.has(n))
      .map((n) => ({
        customer_id: refMap.get(n)!,
        entity_code: entityCode,
        quickbooks_name: n,
      }))
    if (refsToUpsert.length > 0) {
      await supabase
        .from('ar_customer_entity_refs')
        .upsert(refsToUpsert, { onConflict: 'entity_code,quickbooks_name', ignoreDuplicates: true })
    }

    // Insert new import record
    const { data: importRecord, error: importErr } = await supabase
      .from('ar_imports')
      .insert({
        entity_code: entityCode,
        report_date: reportDate,
        imported_by: ctx.access.userId,
        total_ar: totalAr,
        invoice_count: invoiceRows.length,
      })
      .select('id')
      .single()

    if (importErr || !importRecord) {
      return NextResponse.json({ error: 'Failed to create import record' }, { status: 500 })
    }

    // Build invoice insert payload
    const invoicesToInsert = invoiceRows
      .filter((row) => refMap.has(row.qbName))
      .map((row) => ({
        import_id:      importRecord.id,
        customer_id:    refMap.get(row.qbName)!,
        entity_code:    entityCode,
        branch_id:      classCodeMap.get(row.rawClassCode) ?? null,
        raw_class_code: row.rawClassCode || null,
        invoice_number: row.invoiceNumber || null,
        po_number:      row.poNumber || null,
        job_name:       row.jobName || null,
        invoice_date:   row.invoiceDate || null,
        due_date:       row.dueDate || null,
        terms:          row.terms || null,
        open_balance:   row.openBalance,
        aging_bucket:   row.agingBucket,
        aging_days:     row.agingDays,
      }))

    // Batch insert in chunks of 500
    for (let i = 0; i < invoicesToInsert.length; i += 500) {
      const { error: insertErr } = await supabase
        .from('ar_invoices')
        .insert(invoicesToInsert.slice(i, i + 500))
      if (insertErr) {
        return NextResponse.json({ error: 'Failed to insert invoices', detail: insertErr.message }, { status: 500 })
      }
    }

    // Delete old invoices for this entity — any row not belonging to the new import.
    // New data is fully written before this runs, so AR is never empty.
    await supabase
      .from('ar_invoices')
      .delete()
      .eq('entity_code', entityCode)
      .neq('import_id', importRecord.id)

    return NextResponse.json({
      success: true,
      importId: importRecord.id,
      invoiceCount: invoicesToInsert.length,
      totalAr,
      reportDate,
      newCustomers: brandNewNames.length,
      crossLinked: unknownNames.length - brandNewNames.length,
    })
  } catch (err) {
    console.error('AR import error:', err)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
