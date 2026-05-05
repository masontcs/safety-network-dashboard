import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch, canSeeAdminPayrollDetail } from '@/lib/utils/access'
import type { LaborType } from '@/lib/supabase/database.types'
import { apiError } from '@/lib/utils/errors'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const supabase = createServiceClient()

    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id, first_name, last_name, is_active')
      .eq('id', params.id)
      .single()

    if (empErr || !employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found.', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Determine labor type and branch from entity assignments
    const { data: rawAssignments, error: assignErr } = await supabase
      .from('employee_entity_assignments')
      .select('payroll_code_id, payroll_codes(labor_type, branch_id)')
      .eq('employee_id', params.id)

    if (assignErr) throw new Error(`Failed to load assignments: ${assignErr.message}`)

    type AssignmentRow = {
      payroll_code_id: string | null
      payroll_codes: { labor_type: LaborType; branch_id: string | null } | null
    }

    let hasNonDirectCoding = false
    let employeeBranchId: string | null = null

    for (const a of (rawAssignments ?? []) as AssignmentRow[]) {
      if (!a.payroll_codes) continue
      if (a.payroll_codes.labor_type !== 'direct') hasNonDirectCoding = true
      if (a.payroll_codes.branch_id && !employeeBranchId) employeeBranchId = a.payroll_codes.branch_id
    }

    // Admin-coded employees: only admin/executive can access
    if (hasNonDirectCoding && !canSeeAdminPayrollDetail(access)) {
      return NextResponse.json(
        { success: false, error: 'Access to this employee is not permitted.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    // Branch access check for manager roles
    if (employeeBranchId && !canAccessBranch(access, employeeBranchId)) {
      return NextResponse.json(
        { success: false, error: 'Access to this branch is not permitted.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        id: employee.id,
        firstName: employee.first_name,
        lastName: employee.last_name,
        displayName: `${employee.first_name} ${employee.last_name}`.trim(),
        isActive: employee.is_active,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
