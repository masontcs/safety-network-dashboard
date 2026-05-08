import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { LaborType } from '@/lib/supabase/database.types'

const VALID_LABOR_TYPES: LaborType[] = [
  'direct', 'admin_hourly', 'admin_salary',
  'corp_hourly', 'corp_salary', 'hq_hourly', 'hq_salary',
]

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const employeeId = params.id
    const body = await request.json()
    const { entityId, newLaborType, retroactiveFrom } = body as {
      entityId: string
      newLaborType: LaborType
      retroactiveFrom?: string
    }

    if (!entityId || !newLaborType) {
      return NextResponse.json(
        { success: false, error: 'entityId and newLaborType are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }
    if (!VALID_LABOR_TYPES.includes(newLaborType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid labor type', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Find the current active assignment for this employee + entity
    type AssignmentRow = {
      id: string
      payroll_code_id: string | null
      payroll_codes: { branch_id: string | null; entity_id: string; labor_type: LaborType } | null
    }
    const { data: rawAssign, error: assignErr } = await supabase
      .from('employee_entity_assignments')
      .select('id, payroll_code_id, payroll_codes(branch_id, entity_id, labor_type)')
      .eq('employee_id', employeeId)
      .eq('entity_id', entityId)
      .is('effective_to', null)
      .maybeSingle()

    if (assignErr) return NextResponse.json({ success: false, error: assignErr.message }, { status: 500 })
    const assignment = rawAssign as AssignmentRow | null
    if (!assignment) {
      return NextResponse.json(
        { success: false, error: 'No active assignment found for this employee and entity', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const pc = assignment.payroll_codes
    if (!pc?.branch_id) {
      return NextResponse.json(
        { success: false, error: 'Current assignment has no branch — cannot determine target code', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }
    if (pc.labor_type === newLaborType) {
      return NextResponse.json(
        { success: false, error: 'Assignment is already set to that labor type', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const oldCodeId = assignment.payroll_code_id

    // Find the new payroll code for same branch + entity + new labor type
    const { data: newCode, error: codeErr } = await supabase
      .from('payroll_codes')
      .select('id, code')
      .eq('branch_id', pc.branch_id)
      .eq('entity_id', entityId)
      .eq('labor_type', newLaborType)
      .eq('is_active', true)
      .maybeSingle()

    if (codeErr) return NextResponse.json({ success: false, error: codeErr.message }, { status: 500 })
    if (!newCode) {
      return NextResponse.json(
        {
          success: false,
          error: `No active payroll code found for labor type "${newLaborType}" at this branch. Contact an administrator to add one.`,
          code: 'NOT_FOUND',
        },
        { status: 404 }
      )
    }

    // Update the assignment's payroll_code_id
    const { error: updateErr } = await supabase
      .from('employee_entity_assignments')
      .update({ payroll_code_id: newCode.id })
      .eq('id', assignment.id)

    if (updateErr) return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 })

    // Retroactive: re-attribute historical transactions
    let updatedTransactions = 0
    if (retroactiveFrom && oldCodeId) {
      const { data: updated, error: txnErr } = await supabase
        .from('payroll_transactions')
        .update({ payroll_code_id: newCode.id })
        .eq('employee_id', employeeId)
        .eq('payroll_code_id', oldCodeId)
        .gte('period_date', retroactiveFrom)
        .select('id')

      if (txnErr) return NextResponse.json({ success: false, error: txnErr.message }, { status: 500 })
      updatedTransactions = updated?.length ?? 0
    }

    return NextResponse.json({
      success: true,
      data: { updatedTransactions, newCode: newCode.code },
    })
  } catch (err) {
    return apiError(err)
  }
}
