import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

// ── Explicit query result types ───────────────────────────────────────────────

type TransferRecord = {
  id: string; employee_id: string
  from_payroll_code_id: string; to_payroll_code_id: string; effective_date: string
}

type AssignmentWithCode = {
  id: string
  payroll_codes: { branch_id: string | null } | null
}

// DELETE: revert a branch transfer
// Restores the previous assignment, re-attributes transactions back to the old branch.
// Only works if the employee has not been transferred again since this transfer.

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; transferId: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const { id: employeeId, transferId } = params
    const supabase = createServiceClient()

    // Load the transfer record
    const { data: transferRaw, error: transferErr } = await supabase
      .from('employee_branch_transfers')
      .select('id, employee_id, from_payroll_code_id, to_payroll_code_id, effective_date')
      .eq('id', transferId)
      .eq('employee_id', employeeId)
      .single()

    if (transferErr || !transferRaw) {
      return NextResponse.json(
        { success: false, error: 'Transfer record not found', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    const transfer = transferRaw as unknown as TransferRecord
    const { from_payroll_code_id, to_payroll_code_id, effective_date } = transfer

    // Find the new assignment created by this transfer
    const { data: newAssignRaw, error: newAssignErr } = await supabase
      .from('employee_entity_assignments')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('payroll_code_id', to_payroll_code_id)
      .eq('effective_from', effective_date)
      .is('effective_to', null)
      .single()

    if (newAssignErr || !newAssignRaw) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot revert: active post-transfer assignment not found. The employee may have been transferred again since this transfer.',
          code: 'CONFLICT',
        },
        { status: 409 },
      )
    }
    const newAssignment = newAssignRaw as unknown as { id: string }

    // Find the old assignment that was closed by this transfer
    const { data: oldAssignRaw, error: oldAssignErr } = await supabase
      .from('employee_entity_assignments')
      .select('id, payroll_codes(branch_id)')
      .eq('employee_id', employeeId)
      .eq('payroll_code_id', from_payroll_code_id)
      .eq('effective_to', effective_date)
      .single()

    if (oldAssignErr || !oldAssignRaw) {
      return NextResponse.json(
        { success: false, error: 'Cannot revert: original pre-transfer assignment not found', code: 'CONFLICT' },
        { status: 409 },
      )
    }
    const oldAssignment = oldAssignRaw as unknown as AssignmentWithCode
    const oldBranchId = oldAssignment.payroll_codes?.branch_id ?? null

    // 1. Delete the new assignment
    const { error: deleteAssignErr } = await supabase
      .from('employee_entity_assignments')
      .delete()
      .eq('id', newAssignment.id)

    if (deleteAssignErr) throw new Error(`Failed to delete post-transfer assignment: ${deleteAssignErr.message}`)

    // 2. Restore effective_to = NULL on the old assignment
    const { error: restoreErr } = await supabase
      .from('employee_entity_assignments')
      .update({ effective_to: null })
      .eq('id', oldAssignment.id)

    if (restoreErr) throw new Error(`Failed to restore old assignment: ${restoreErr.message}`)

    // 3. Revert payroll transactions: new code → old code on/after effectiveDate
    const { error: ptErr } = await supabase
      .from('payroll_transactions')
      .update({ payroll_code_id: from_payroll_code_id })
      .eq('employee_id', employeeId)
      .eq('payroll_code_id', to_payroll_code_id)
      .gte('period_date', effective_date)

    if (ptErr) throw new Error(`Failed to revert payroll transactions: ${ptErr.message}`)

    // 4. Revert fuel transactions back to old branch
    if (oldBranchId) {
      const { error: ftErr } = await supabase
        .from('fuel_transactions')
        .update({ branch_id: oldBranchId })
        .eq('employee_id', employeeId)
        .is('business_tag', null)
        .gte('transaction_date', effective_date)

      if (ftErr) throw new Error(`Failed to revert fuel transactions: ${ftErr.message}`)
    }

    // 5. Revert fuel card assignments back to old branch
    if (oldBranchId) {
      const { error: fcErr } = await supabase
        .from('fuel_card_assignments')
        .update({ branch_id: oldBranchId })
        .eq('employee_id', employeeId)

      if (fcErr) throw new Error(`Failed to revert fuel card assignments: ${fcErr.message}`)
    }

    // 6. Delete the transfer record
    const { error: deleteTransferErr } = await supabase
      .from('employee_branch_transfers')
      .delete()
      .eq('id', transferId)

    if (deleteTransferErr) throw new Error(`Failed to delete transfer record: ${deleteTransferErr.message}`)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
