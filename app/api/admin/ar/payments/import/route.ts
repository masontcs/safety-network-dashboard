import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { parsePaymentFile } from '@/lib/ar/payment-parser'

const VALID_ENTITY_CODES = ['INC', 'TCS', 'STS'] as const
type EntityCode = typeof VALID_ENTITY_CODES[number]

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const form = await request.formData()
    const file = form.get('file')
    const entityCode = form.get('entityCode')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }
    if (typeof entityCode !== 'string' || !(VALID_ENTITY_CODES as readonly string[]).includes(entityCode)) {
      return NextResponse.json({ error: 'entityCode must be INC, TCS, or STS' }, { status: 400 })
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parsePaymentFile(buffer)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const { payments, dateFrom, dateTo } = parsed
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')) } catch { /* closed */ }
        }

        try {
          const supabase = createServiceClient()

          send({ type: 'step', label: 'Resolving customers…', progress: 15 })

          // Load all entity refs for this entity to build QB name → customer_id map
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: entityRefs } = await (supabase as any)
            .from('ar_customer_entity_refs')
            .select('quickbooks_name, customer_id')
            .eq('entity_code', entityCode)

          type EntityRef = { quickbooks_name: string; customer_id: string }
          const refMap = new Map<string, string>(
            ((entityRefs ?? []) as EntityRef[]).map((r) => [
              r.quickbooks_name.trim().toLowerCase(),
              r.customer_id,
            ])
          )

          send({ type: 'step', label: 'Creating import record…', progress: 30 })

          // Create the import record
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: importRecord, error: importErr } = await (supabase as any)
            .from('ar_payment_imports')
            .insert({
              entity_code:   entityCode as EntityCode,
              date_from:     dateFrom,
              date_to:       dateTo,
              imported_by:   ctx.access.userId,
              payment_count: payments.length,
              total_amount:  payments.reduce((s, p) => s + p.amount, 0),
            })
            .select('id')
            .single()

          if (importErr || !importRecord) {
            send({ type: 'error', error: 'Failed to create import record' })
            return
          }

          send({ type: 'step', label: `Importing ${payments.length} payments…`, progress: 50 })

          // Build insert rows — resolve customer_id by QB name, skip duplicates via ON CONFLICT DO NOTHING
          let matched = 0
          let skipped = 0
          const unmatchedNames = new Set<string>()

          const rows = payments.map((p) => {
            const customerId = refMap.get(p.qbCustomerName.toLowerCase()) ?? null
            if (customerId) matched++; else unmatchedNames.add(p.qbCustomerName)
            return {
              import_id:        (importRecord as { id: string }).id,
              customer_id:      customerId,
              entity_code:      entityCode as EntityCode,
              payment_date:     p.paymentDate,
              reference_number: p.referenceNumber,
              amount:           p.amount,
              memo:             p.memo,
              qb_customer_name: p.qbCustomerName,
              payment_type:     p.paymentType,
            }
          })

          // Batch insert with conflict skip (unique constraint handles deduplication)
          const BATCH = 200
          for (let i = 0; i < rows.length; i += BATCH) {
            const batch = rows.slice(i, i + BATCH)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: insertErr, count } = await (supabase as any)
              .from('ar_payments')
              .upsert(batch, {
                onConflict: 'entity_code,qb_customer_name,reference_number,payment_date',
                ignoreDuplicates: true,
              })
              .select('id', { count: 'exact', head: true })

            if (insertErr) {
              send({ type: 'error', error: `Failed to insert payments: ${insertErr.message}` })
              return
            }
            skipped += batch.length - (count ?? batch.length)
          }

          const unmatchedList = [...unmatchedNames].sort()
          send({
            type: 'done',
            data: {
              importId:       (importRecord as { id: string }).id,
              paymentCount:   payments.length,
              matched,
              unmatched:      unmatchedNames.size,
              unmatchedNames: unmatchedList,
              skipped,
              dateFrom,
              dateTo,
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
    console.error('Payment import error:', err)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
