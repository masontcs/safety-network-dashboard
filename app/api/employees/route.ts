import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(_request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const supabase = createServiceClient()

    // For manager roles: scope to employees with payroll codes in their branches
    if (access.branchIds !== null) {
      const { data: codes, error: codesErr } = await supabase
        .from('payroll_codes')
        .select('id')
        .in('branch_id', access.branchIds)

      if (codesErr) throw new Error(`Failed to load payroll codes: ${codesErr.message}`)

      const codeIds = (codes ?? []).map((c) => c.id)

      if (codeIds.length === 0) {
        return NextResponse.json({ success: true, data: [] })
      }

      const { data: txns, error: txnErr } = await supabase
        .from('payroll_transactions')
        .select('employee_id')
        .in('payroll_code_id', codeIds)

      if (txnErr) throw new Error(`Failed to load employee IDs: ${txnErr.message}`)

      const employeeIds = [...new Set((txns ?? []).map((t) => t.employee_id))]

      if (employeeIds.length === 0) {
        return NextResponse.json({ success: true, data: [] })
      }

      const { data: employees, error: empErr } = await supabase
        .from('employees')
        .select('id, first_name, last_name, is_active')
        .in('id', employeeIds)
        .eq('is_active', true)
        .order('last_name')

      if (empErr) throw new Error(`Failed to load employees: ${empErr.message}`)

      return NextResponse.json({
        success: true,
        data: (employees ?? []).map((e) => ({
          id: e.id,
          firstName: e.first_name,
          lastName: e.last_name,
          displayName: `${e.first_name} ${e.last_name}`.trim(),
          isActive: e.is_active,
        })),
      })
    }

    // admin/executive: all active employees
    const { data: employees, error: empErr } = await supabase
      .from('employees')
      .select('id, first_name, last_name, is_active')
      .eq('is_active', true)
      .order('last_name')

    if (empErr) throw new Error(`Failed to load employees: ${empErr.message}`)

    return NextResponse.json({
      success: true,
      data: (employees ?? []).map((e) => ({
        id: e.id,
        firstName: e.first_name,
        lastName: e.last_name,
        displayName: `${e.first_name} ${e.last_name}`.trim(),
        isActive: e.is_active,
      })),
    })
  } catch (err) {
    return apiError(err)
  }
}
