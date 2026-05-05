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

const VALID_ENTITY_CODES = ['INC', 'TCS', 'STS'] as const
type EntityCode = (typeof VALID_ENTITY_CODES)[number]

function isEntityCode(code: string): code is EntityCode {
  return (VALID_ENTITY_CODES as readonly string[]).includes(code)
}

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
    const entityCode = form.get('entityCode')

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (typeof entityCode !== 'string' || !isEntityCode(entityCode)) {
      return NextResponse.json({ success: false, error: 'entityCode must be INC, TCS, or STS', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    // 4. Parse file
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parsePayrollFile(buffer, entityCode)
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error, code: 'PARSE_ERROR' }, { status: 400 })
    }

    const { periodDate, employees, payrollItems, warnings } = parsed.data
    const supabase = createServiceClient()

    // 5. Lookup entity_id
    const { data: entity, error: entityErr } = await supabase
      .from('entities').select('id').eq('code', entityCode).single()
    if (entityErr || !entity) throw new Error(`Entity not found: ${entityCode}`)

    // 6. Duplicate check
    const { data: existing } = await supabase
      .from('payroll_imports')
      .select('id')
      .eq('entity_id', entity.id)
      .eq('period_date', periodDate)
      .maybeSingle()
    if (existing) throw new DuplicateImportError({ entityCode, periodDate, importId: existing.id })

    // 7. Resolve items + employees
    const itemNameToId = await resolvePayrollItems(payrollItems, supabase)
    const resolved = await resolveEmployees(employees, entity.id, supabase)

    // 8. Insert import record
    const { data: importRecord, error: importErr } = await supabase
      .from('payroll_imports')
      .insert({ entity_id: entity.id, period_date: periodDate, imported_by: ctx.access.userId, status: 'pending' })
      .select('id').single()
    if (importErr || !importRecord) throw new Error(`Failed to create payroll import: ${importErr?.message}`)

    // 9. Insert transactions
    const counts = await insertPayrollData(
      importRecord.id, entity.id, periodDate, resolved, employees, itemNameToId, supabase
    )

    // 10. Non-blocking AI
    const newEmployees = resolved.filter((r) => r.isNew)
    triggerAiForPayroll(newEmployees, entity.id, counts.unknownItemNames, supabase)

    return NextResponse.json({
      success: true,
      data: {
        importId: importRecord.id,
        periodDate,
        entityCode,
        transactionCount: counts.txnCount,
        taxCount: counts.taxCount,
        pendingEmployeeCount: counts.pendingCount,
        unknownItemCount: counts.unknownItemNames.length,
        warnings,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
