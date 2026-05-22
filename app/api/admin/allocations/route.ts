import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOrExecutive } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOrExecutive(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const [pendingAllocsRes, pendingOverridesRes, activeAllocsRes] = await Promise.all([
      supabase
        .from('employee_allocations')
        .select(`
          id, employee_id, branch_id, percentage, effective_from, effective_to, status, notes, created_at,
          employees(first_name, last_name),
          branches(name)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase
        .from('employee_allocation_overrides')
        .select(`
          id, employee_id, period_date, branch_id, percentage, status, notes, created_at,
          employees(first_name, last_name),
          branches(name)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase
        .from('employee_allocations')
        .select(`
          id, employee_id, branch_id, percentage, effective_from, effective_to, status, notes, created_at,
          employees(first_name, last_name),
          branches(name)
        `)
        .eq('status', 'approved')
        .is('effective_to', null)
        .order('effective_from', { ascending: false }),
    ])

    if (pendingAllocsRes.error) throw new Error(pendingAllocsRes.error.message)
    if (pendingOverridesRes.error) throw new Error(pendingOverridesRes.error.message)
    if (activeAllocsRes.error) throw new Error(activeAllocsRes.error.message)

    const formatAlloc = (row: Record<string, unknown>) => {
      const emp = row.employees as { first_name: string; last_name: string } | null
      const branch = row.branches as { name: string } | null
      return {
        ...row,
        displayName: emp ? `${emp.first_name} ${emp.last_name}`.trim() : '',
        branchName: branch?.name ?? '',
        employees: undefined,
        branches: undefined,
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        pendingAllocations: (pendingAllocsRes.data ?? []).map(formatAlloc),
        pendingOverrides: (pendingOverridesRes.data ?? []).map(formatAlloc),
        activeAllocations: (activeAllocsRes.data ?? []).map(formatAlloc),
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
