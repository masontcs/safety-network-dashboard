import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { parsePayrollFile } from '@/lib/payroll/parser'
import {
  resolvePayrollItems,
  resolveEmployees,
  insertPayrollData,
  triggerAiForPayroll,
} from '@/lib/payroll/import-helpers'
import { DuplicateImportError } from '@/lib/utils/errors'
import { apiError } from '@/lib/utils/errors'
import { logAudit, getClientIp } from '@/lib/audit/log'

const VALID_ENTITY_CODES = ['INC', 'TCS', 'STS'] as const
type EntityCode = (typeof VALID_ENTITY_CODES)[number]

function isEntityCode(code: string): code is EntityCode {
  return (VALID_ENTITY_CODES as readonly string[]).includes(code)
}

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Auth — must happen before stream so we can return 401/403 normally
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    // 2. Parse form
    const form = await request.formData()
    const file = form.get('file')
    const entityCode = form.get('entityCode')

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (typeof entityCode !== 'string' || !isEntityCode(entityCode)) {
      return NextResponse.json({ success: false, error: 'entityCode must be INC, TCS, or STS', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File too large (max 10MB)', code: 'FILE_TOO_LARGE' }, { status: 413 })
    }

    // 3. Parse file (CPU-bound, fast)
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parsePayrollFile(buffer, entityCode)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error, code: 'PARSE_ERROR' }, { status: 400 })
    }

    const { periodDate, employees, payrollItems, warnings } = parsed.data
    const supabase = createServiceClient()

    // 4. Entity lookup
    const { data: entity, error: entityErr } = await supabase
      .from('entities').select('id').eq('code', entityCode).single()
    if (entityErr || !entity) {
      return NextResponse.json({ success: false, error: `Entity not found: ${entityCode}` }, { status: 400 })
    }

    // 5. Duplicate check — return 409 before starting stream so client handles it normally
    const { data: existing } = await supabase
      .from('payroll_imports')
      .select('id')
      .eq('entity_id', entity.id)
      .eq('period_date', periodDate)
      .maybeSingle()
    if (existing) {
      throw new DuplicateImportError({ entityCode, periodDate, importId: existing.id })
    }

    // 6. Stream the slow part: employee resolution + DB inserts
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
          send({ type: 'step', label: `Resolving ${payrollItems.length} pay items…`, progress: 20 })
          const itemNameToId = await resolvePayrollItems(payrollItems, supabase)

          send({ type: 'step', label: `Matching ${employees.length} employees…`, progress: 38 })
          const resolved = await resolveEmployees(employees, entity.id, supabase)

          const newCount = resolved.filter((r) => r.isNew).length
          const pendingCount = resolved.filter((r) => r.payrollCodeId === null && !r.businessTag).length

          if (newCount > 0) {
            send({ type: 'step', label: `${newCount} new employee${newCount > 1 ? 's' : ''} added to review queue…`, progress: 50 })
          } else {
            send({ type: 'step', label: 'All employees matched…', progress: 50 })
          }

          // Count confirmed transactions upfront so we can show X/Total
          const rMap = new Map(resolved.map((r) => [r.rawName, r]))
          const confirmedTxnTotal = employees.reduce((sum, emp) => {
            const r = rMap.get(emp.rawName)
            if (!r || r.businessTag || r.payrollCodeId === null) return sum
            return sum + emp.lineItems.length
          }, 0)

          // Create import record
          const { data: importRecord, error: importErr } = await supabase
            .from('payroll_imports')
            .insert({ entity_id: entity.id, period_date: periodDate, imported_by: ctx.access.userId, status: 'pending' })
            .select('id').single()
          if (importErr || !importRecord) throw new Error(`Failed to create payroll import: ${importErr?.message}`)

          const stagedCount = pendingCount > 0 ? ` · ${pendingCount} staged` : ''
          send({
            type: 'step',
            label: `Writing ${confirmedTxnTotal} transaction${confirmedTxnTotal !== 1 ? 's' : ''}${stagedCount}…`,
            progress: 58,
            current: 0,
            total: confirmedTxnTotal,
          })

          // insertPayrollData writes multiple tables in a loop with no DB transaction.
          // If it throws mid-way, we clean up all partial data before re-throwing
          // so the import record isn't left in a corrupt half-written state.
          let counts: Awaited<ReturnType<typeof insertPayrollData>>
          try {
            counts = await insertPayrollData(
              importRecord.id, entity.id, periodDate, resolved, employees, itemNameToId, supabase,
              (done, total) => {
                const pct = 58 + Math.round((done / total) * 33)
                send({
                  type: 'step',
                  label: `Writing transactions (${done}/${total})…`,
                  progress: pct,
                  current: done,
                  total,
                })
              }
            )
          } catch (insertErr) {
            // Clean up any partial writes before surfacing the error
            await supabase.from('payroll_transactions').delete().eq('import_id', importRecord.id)
            await supabase.from('payroll_taxes').delete().eq('import_id', importRecord.id)
            await supabase.from('payroll_staged_transactions').delete().eq('import_id', importRecord.id)
            await supabase.from('payroll_staged_taxes').delete().eq('import_id', importRecord.id)
            await supabase.from('payroll_item_staged_transactions').delete().eq('import_id', importRecord.id)
            await supabase.from('payroll_imports').delete().eq('id', importRecord.id)
            throw insertErr
          }

          // Non-blocking AI — fire and forget, don't delay the response
          const newEmployees = resolved.filter((r) => r.isNew)
          triggerAiForPayroll(newEmployees, entity.id, counts.newItemNames, supabase)

          await logAudit({
            userId:          ctx.access.userId,
            userDisplayName: ctx.access.displayName,
            userRole:        ctx.access.role,
            action:          'import.payroll',
            resourceType:    'payroll_import',
            resourceId:      importRecord.id,
            resourceLabel:   `${entityCode} — ${periodDate}`,
            metadata:        { entityCode, periodDate, transactionCount: counts.txnCount },
            ipAddress:       getClientIp(request),
          })

          send({
            type: 'done',
            data: {
              importId: importRecord.id,
              periodDate,
              entityCode,
              transactionCount: counts.txnCount,
              taxCount: counts.taxCount,
              pendingEmployeeCount: counts.pendingCount,
              stagedItemTxnCount: counts.stagedItemTxnCount,
              newItemCount: counts.newItemNames.length,
              warnings,
            },
          })
        } catch (err) {
          send({ type: 'error', error: err instanceof Error ? err.message : 'An unexpected error occurred.' })
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
    return apiError(err)
  }
}
