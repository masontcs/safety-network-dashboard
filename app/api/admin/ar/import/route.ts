import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
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
    const guard = guardArAdminOnly(ctx.access.role)
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

    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
          } catch {
            // controller already closed
          }
        }

        try {
          const supabase = createServiceClient()

          send({ type: 'step', label: 'Loading branch mappings…', progress: 10 })

          // Load class code → branch_id map
          const { data: classCodes } = await supabase
            .from('ar_class_codes')
            .select('code, branch_id')
          const classCodeMap = new Map(
            (classCodes ?? []).map((c) => [c.code as string, c.branch_id as string | null])
          )

          // Collect unique QB customer names from this file
          const qbNames = [...new Set(invoiceRows.map((r) => r.qbName))]

          send({ type: 'step', label: `Resolving ${qbNames.length} customers…`, progress: 25 })

          // Load existing entity refs for this entity
          const { data: existingRefs } = await supabase
            .from('ar_customer_entity_refs')
            .select('quickbooks_name, customer_id')
            .eq('entity_code', entityCode)
            .in('quickbooks_name', qbNames)

          const refMap = new Map(
            (existingRefs ?? []).map((r) => [r.quickbooks_name as string, r.customer_id as string])
          )

          // For new names, check cross-entity links
          const unknownNames = qbNames.filter((n) => !refMap.has(n))
          if (unknownNames.length > 0) {
            send({ type: 'step', label: `Checking ${unknownNames.length} new customers across entities…`, progress: 40 })

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
          if (brandNewNames.length > 0) {
            send({ type: 'step', label: `Creating ${brandNewNames.length} new customer${brandNewNames.length !== 1 ? 's' : ''}…`, progress: 55 })

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
          }

          // Upsert entity refs for all names we now have customer_ids for
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

          send({ type: 'step', label: 'Creating import record…', progress: 65 })

          // Insert new import record
          const { data: importRecord, error: importErr } = await supabase
            .from('ar_imports')
            .insert({
              entity_code: entityCode,
              report_date: reportDate,
              imported_by: ctx.access.userId,
              total_ar: totalAr,
              invoice_count: invoiceRows.filter((r) => r.rowType === 'invoice').length,
            })
            .select('id')
            .single()

          if (importErr || !importRecord) {
            send({ type: 'error', error: 'Failed to create import record' })
            return
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
              row_type:       row.rowType,
            }))

          const BATCH = 500
          const batches = Math.ceil(invoicesToInsert.length / BATCH)
          for (let i = 0; i < invoicesToInsert.length; i += BATCH) {
            const batchNum = Math.floor(i / BATCH) + 1
            const pct = 70 + Math.round((batchNum / batches) * 20)
            send({
              type: 'step',
              label: `Writing invoices (${Math.min(i + BATCH, invoicesToInsert.length)}/${invoicesToInsert.length})…`,
              progress: pct,
            })
            const { error: insertErr } = await supabase
              .from('ar_invoices')
              .insert(invoicesToInsert.slice(i, i + BATCH))
            if (insertErr) {
              send({ type: 'error', error: `Failed to insert invoices: ${insertErr.message}` })
              return
            }
          }

          // Re-apply any saved invoice date overrides to the newly inserted rows
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: dateOverrides } = await (supabase as any)
            .from('ar_invoice_date_overrides')
            .select('invoice_number, override_date')
            .eq('entity_code', entityCode)

          type DateOverride = { invoice_number: string; override_date: string }
          if (dateOverrides && (dateOverrides as DateOverride[]).length > 0) {
            for (const ov of dateOverrides as DateOverride[]) {
              await supabase
                .from('ar_invoices')
                .update({ invoice_date: ov.override_date })
                .eq('import_id', (importRecord as { id: string }).id)
                .eq('entity_code', entityCode)
                .eq('invoice_number', ov.invoice_number)
            }
          }

          send({ type: 'step', label: 'Replacing previous import…', progress: 95 })

          // Delete old invoices for this entity — new data fully written first
          await supabase
            .from('ar_invoices')
            .delete()
            .eq('entity_code', entityCode)
            .neq('import_id', (importRecord as { id: string }).id)

          send({
            type: 'done',
            data: {
              importId:      importRecord.id,
              invoiceCount:  invoicesToInsert.filter((r) => r.row_type === 'invoice').length,
              totalAr,
              reportDate,
              newCustomers:  brandNewNames.length,
              crossLinked:   unknownNames.length - brandNewNames.length,
            },
          })
        } catch (err) {
          send({ type: 'error', error: err instanceof Error ? err.message : 'Import failed' })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('AR import error:', err)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
