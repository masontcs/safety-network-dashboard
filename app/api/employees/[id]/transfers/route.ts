import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { isAdminOrExecutive } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import type { LaborType } from '@/lib/supabase/database.types'

function isSaturday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 6
}

// ── Explicit query result types ───────────────────────────────────────────────

type PayrollCodeRow = {
  id: string; code: string; branch_id: string | null; entity_id: string
  is_active: boolean; labor_type: LaborType
  branches: { id: string; name: string } | null
}

type ActiveAssignmentRow = {
  id: string; payroll_code_id: string | null; raw_name_in_report: string
  effective_from: string
  payroll_codes: { branch_id: string | null } | null
}

type AssignmentHistoryRow = {
  id: string; entity_id: string; payroll_code_id: string | null
  effective_from: string; effective_to: string | null
  entities: { code: string; name: string } | null
  payroll_codes: {
    code: string; labor_type: LaborType; branch_id: string | null
    branches: { name: string } | null
  } | null
}

type TransferRow = {
  id: string; effective_date: string; created_at: string; notes: string | null
  from_payroll_code_id: string; to_payroll_code_id: string
}

type AvailableCodeRow = {
  id: string; code: string; labor_type: LaborType; branch_id: string | null; entity_id: string
  branches: { name: string } | null; entities: { code: string } | null
}

type CodeDetailRow = {
  id: string; code: string; entity_id: string; branch_id: string | null
  branches: { name: string } | null; entities: { code: string } | null
}

// ── GET: transfer history + all assignment periods + available payroll codes ──

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (!isAdminOrExecutive(ctx.access)) {
      return NextResponse.json(
        { success: false, error: 'Access restricted to admin and executive.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    const supabase = createServiceClient()
    const employeeId = params.id

    const [transfersRes, assignmentsRes, codesRes] = await Promise.all([
      supabase
        .from('employee_branch_transfers')
        .select('id, effective_date, created_at, notes, from_payroll_code_id, to_payroll_code_id')
        .eq('employee_id', employeeId)
        .order('effective_date', { ascending: false }),
      supabase
        .from('employee_entity_assignments')
        .select('id, entity_id, payroll_code_id, effective_from, effective_to, entities(code, name), payroll_codes(code, labor_type, branch_id, branches(name))')
        .eq('employee_id', employeeId)
        .order('effective_from', { ascending: false }),
      supabase
        .from('payroll_codes')
        .select('id, code, labor_type, branch_id, entity_id, branches(name), entities(code)')
        .eq('is_active', true)
        .order('code'),
    ])

    if (transfersRes.error) throw new Error(transfersRes.error.message)
    if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)

    const transfers = (transfersRes.data ?? []) as TransferRow[]
    const assignments = (assignmentsRes.data ?? []) as AssignmentHistoryRow[]
    const available = (codesRes.data ?? []) as AvailableCodeRow[]

    // Resolve payroll code details for transfer log display
    const allCodeIds = [...new Set([
      ...transfers.map((t) => t.from_payroll_code_id),
      ...transfers.map((t) => t.to_payroll_code_id),
    ])]
    const { data: codeDetails } = await supabase
      .from('payroll_codes')
      .select('id, code, entity_id, branch_id, branches(name), entities(code)')
      .in('id', allCodeIds.length > 0 ? allCodeIds : ['__none__'])

    const codeMap = Object.fromEntries(
      ((codeDetails ?? []) as CodeDetailRow[]).map((c) => [c.id, c]),
    )

    return NextResponse.json({
      success: true,
      data: {
        transfers: transfers.map((t) => {
          const fromCode = codeMap[t.from_payroll_code_id]
          const toCode = codeMap[t.to_payroll_code_id]
          return {
            id: t.id,
            effectiveDate: t.effective_date,
            createdAt: t.created_at,
            notes: t.notes,
            fromPayrollCodeId: t.from_payroll_code_id,
            toPayrollCodeId: t.to_payroll_code_id,
            fromCode: fromCode?.code ?? '',
            toCode: toCode?.code ?? '',
            fromBranchName: fromCode?.branches?.name ?? null,
            toBranchName: toCode?.branches?.name ?? null,
            entityCode: fromCode?.entities?.code ?? '',
          }
        }),
        assignments: assignments.map((a) => ({
          id: a.id,
          entityCode: a.entities?.code ?? '',
          entityName: a.entities?.name ?? '',
          payrollCode: a.payroll_codes?.code ?? '',
          laborType: a.payroll_codes?.labor_type ?? ('direct' as LaborType),
          branchName: a.payroll_codes?.branches?.name ?? null,
          effectiveFrom: a.effective_from,
          effectiveTo: a.effective_to,
          payrollCodeId: a.payroll_code_id,
        })),
        payrollCodes: available.map((pc) => ({
          id: pc.id,
          code: pc.code,
          laborType: pc.labor_type,
          branchId: pc.branch_id,
          branchName: pc.branches?.name ?? 'Corp / HQ',
          entityCode: pc.entities?.code ?? '',
          entityId: pc.entity_id,
        })),
      },
    })
  } catch (err) {
    return apiError(err)
  }
}

// ── POST: create a branch transfer ───────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const employeeId = params.id
    const body = await request.json() as {
      toPayrollCodeId?: string
      effectiveDate?: string
      notes?: string
    }
    const { toPayrollCodeId, effectiveDate, notes } = body

    if (!toPayrollCodeId?.trim()) {
      return NextResponse.json(
        { success: false, error: 'toPayrollCodeId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    if (!effectiveDate || !isSaturday(effectiveDate)) {
      return NextResponse.json(
        { success: false, error: 'effectiveDate is required and must be a Saturday', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    // Load destination payroll code
    const { data: toCodeRaw, error: toCodeErr } = await supabase
      .from('payroll_codes')
      .select('id, code, branch_id, entity_id, is_active, branches(id, name)')
      .eq('id', toPayrollCodeId)
      .single()

    if (toCodeErr || !toCodeRaw) {
      return NextResponse.json(
        { success: false, error: 'Payroll code not found', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    const toCode = toCodeRaw as unknown as PayrollCodeRow

    if (!toCode.is_active) {
      return NextResponse.json(
        { success: false, error: 'Destination payroll code is not active', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    // Find all current active assignments for this employee + entity
    // NOTE: .single() is intentionally NOT used here — duplicate open-ended assignments
    // can exist due to a historical data integrity issue in the review queue. We pick
    // the most recent as the canonical source and close all of them on transfer.
    const { data: activeRows, error: assignErr } = await supabase
      .from('employee_entity_assignments')
      .select('id, payroll_code_id, raw_name_in_report, effective_from, payroll_codes(branch_id)')
      .eq('employee_id', employeeId)
      .eq('entity_id', toCode.entity_id)
      .is('effective_to', null)
      .order('effective_from', { ascending: false })

    if (assignErr || !activeRows || activeRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No active assignment found for this employee in the same entity', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const allActive = activeRows as unknown as ActiveAssignmentRow[]
    // Use the most recent assignment as the canonical source
    const current = allActive[0]
    // Any extras are duplicates — collect their IDs to close them too
    const duplicateIds = allActive.slice(1).map((r) => r.id)

    const fromBranchId = current.payroll_codes?.branch_id ?? null
    const toBranchId = toCode.branch_id

    if (fromBranchId === toBranchId) {
      return NextResponse.json(
        { success: false, error: 'Destination payroll code belongs to the same branch as the current assignment', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    if (current.payroll_code_id === toPayrollCodeId) {
      return NextResponse.json(
        { success: false, error: 'Employee is already assigned to this payroll code', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    if (effectiveDate <= current.effective_from) {
      return NextResponse.json(
        { success: false, error: 'Effective date must be after the current assignment start date', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const fromPayrollCodeId = current.payroll_code_id!

    // 1. Close current assignment (and any duplicates that share the same open-ended state)
    const idsToClose = [current.id, ...duplicateIds]
    const { error: closeErr } = await supabase
      .from('employee_entity_assignments')
      .update({ effective_to: effectiveDate })
      .in('id', idsToClose)

    if (closeErr) throw new Error(`Failed to close current assignment: ${closeErr.message}`)

    // 2. Create new active assignment
    const { error: insertErr } = await supabase
      .from('employee_entity_assignments')
      .insert({
        employee_id: employeeId,
        entity_id: toCode.entity_id,
        payroll_code_id: toPayrollCodeId,
        raw_name_in_report: current.raw_name_in_report,
        is_confirmed: true,
        effective_from: effectiveDate,
        effective_to: null,
      })

    if (insertErr) {
      await supabase
        .from('employee_entity_assignments')
        .update({ effective_to: null })
        .eq('id', current.id)
      throw new Error(`Failed to create new assignment: ${insertErr.message}`)
    }

    // 3. Record the transfer
    const { data: transferRow, error: transferErr } = await supabase
      .from('employee_branch_transfers')
      .insert({
        employee_id: employeeId,
        from_payroll_code_id: fromPayrollCodeId,
        to_payroll_code_id: toPayrollCodeId,
        effective_date: effectiveDate,
        created_by: ctx.access.userId,
        notes: notes?.trim() || null,
      })
      .select('id')
      .single()

    if (transferErr) throw new Error(`Failed to record transfer: ${transferErr.message}`)

    // 4. Retroactively reassign payroll transactions on/after effectiveDate
    const { error: ptErr } = await supabase
      .from('payroll_transactions')
      .update({ payroll_code_id: toPayrollCodeId })
      .eq('employee_id', employeeId)
      .eq('payroll_code_id', fromPayrollCodeId)
      .gte('period_date', effectiveDate)

    if (ptErr) throw new Error(`Failed to reassign payroll transactions: ${ptErr.message}`)

    // 5. Retroactively reassign fuel transactions on/after effectiveDate
    if (toBranchId) {
      const { error: ftErr } = await supabase
        .from('fuel_transactions')
        .update({ branch_id: toBranchId })
        .eq('employee_id', employeeId)
        .is('business_tag', null)
        .gte('transaction_date', effectiveDate)

      if (ftErr) throw new Error(`Failed to reassign fuel transactions: ${ftErr.message}`)
    }

    // 6. Update fuel card assignments for this employee
    if (toBranchId) {
      const { error: fcErr } = await supabase
        .from('fuel_card_assignments')
        .update({ branch_id: toBranchId })
        .eq('employee_id', employeeId)

      if (fcErr) throw new Error(`Failed to update fuel card assignments: ${fcErr.message}`)
    }

    const row = transferRow as unknown as { id: string }
    return NextResponse.json({ success: true, data: { transferId: row.id } }, { status: 201 })
  } catch (err) {
    return apiError(err)
  }
}
