import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const supabase = createServiceClient()

    const url = new URL(request.url)
    const search = url.searchParams.get('search') ?? ''
    const branchIdFilter = url.searchParams.get('branchId') ?? ''
    const entityCodeFilter = url.searchParams.get('entityCode') ?? ''
    const laborTypeFilter = url.searchParams.get('laborType') ?? ''
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
    const pageSize = Math.max(1, Math.min(200, parseInt(url.searchParams.get('pageSize') ?? '50', 10)))
    const sortBy = url.searchParams.get('sortBy') ?? 'displayName'
    const sortDir = (url.searchParams.get('sortDir') ?? 'asc') === 'desc' ? 'desc' : 'asc'

    // ── Manager / District scope ─────────────────────────────────────────────
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

      const PAGE_SIZE = 1000
      const allTxns: Array<{ employee_id: string }> = []
      {
        let from = 0
        while (true) {
          const { data, error } = await supabase
            .from('payroll_transactions')
            .select('employee_id')
            .in('payroll_code_id', codeIds)
            .range(from, from + PAGE_SIZE - 1)
          if (error) throw new Error(`Failed to load employee IDs: ${error.message}`)
          if (!data || data.length === 0) break
          allTxns.push(...data)
          if (data.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
      }

      const employeeIds = [...new Set(allTxns.map((t) => t.employee_id))]

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

    // ── Admin / Executive: enriched with filters, sorting, pagination ────────

    // Fetch all employees (active and inactive)
    const { data: employees, error: empErr } = await supabase
      .from('employees')
      .select('id, first_name, last_name, is_active')
      .order('last_name')

    if (empErr) throw new Error(`Failed to load employees: ${empErr.message}`)

    const allEmployees = employees ?? []

    // Fetch confirmed current assignments (effective_to = null, is_confirmed = true)
    const { data: rawAssignments, error: assignErr } = await supabase
      .from('employee_entity_assignments')
      .select('employee_id, entity_id, payroll_code_id, raw_name_in_report, entities(code), payroll_codes(code, labor_type, branch_id, branches(id, name))')
      .is('effective_to', null)
      .eq('is_confirmed', true)

    if (assignErr) throw new Error(`Failed to load assignments: ${assignErr.message}`)

    type RawAssignment = {
      employee_id: string
      entity_id: string
      payroll_code_id: string | null
      raw_name_in_report: string
      entities: { code: string } | null
      payroll_codes: {
        code: string
        labor_type: string
        branch_id: string | null
        branches: { id: string; name: string } | null
      } | null
    }

    const assignmentRows = (rawAssignments ?? []) as RawAssignment[]

    // Build map: employee_id → assignments[]
    const assignmentsByEmployee: Record<string, RawAssignment[]> = {}
    for (const a of assignmentRows) {
      if (!assignmentsByEmployee[a.employee_id]) assignmentsByEmployee[a.employee_id] = []
      assignmentsByEmployee[a.employee_id].push(a)
    }

    // Fetch latest payroll date per employee — scoped to the employees in this result
    // set to avoid a full-table scan. The ideal fix is MAX(period_date) GROUP BY employee_id
    // pushed to Postgres via an RPC, but scoping by ID is a significant improvement already.
    const allEmployeeIds = allEmployees.map((e) => e.id)
    const PAGE_SIZE = 1000
    const payrollTxns: Array<{ employee_id: string; period_date: string }> = []
    if (allEmployeeIds.length > 0) {
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('payroll_transactions')
          .select('employee_id, period_date')
          .in('employee_id', allEmployeeIds)
          .order('period_date', { ascending: false })
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(`Failed to load payroll transactions: ${error.message}`)
        if (!data || data.length === 0) break
        payrollTxns.push(...data)
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    }

    // Build map: employee_id → max period_date
    const lastPayrollByEmployee: Record<string, string> = {}
    for (const t of payrollTxns) {
      if (!lastPayrollByEmployee[t.employee_id] || t.period_date > lastPayrollByEmployee[t.employee_id]) {
        lastPayrollByEmployee[t.employee_id] = t.period_date
      }
    }

    // Build enriched employee list
    const enriched = allEmployees.map((e) => {
      const assignments = assignmentsByEmployee[e.id] ?? []
      const entities = [...new Set(assignments.map((a) => a.entities?.code).filter(Boolean) as string[])]

      // Use the first assignment's labor_type and branch (prefer branch with a name)
      const primaryAssignment = assignments.find((a) => a.payroll_codes?.branch_id != null) ?? assignments[0] ?? null
      const laborType = (primaryAssignment?.payroll_codes?.labor_type as string | null) ?? null
      const branchId = primaryAssignment?.payroll_codes?.branch_id ?? null
      const branchName = primaryAssignment?.payroll_codes?.branches?.name ?? null

      const rawNames = assignments.map((a) => a.raw_name_in_report)

      return {
        id: e.id,
        firstName: e.first_name,
        lastName: e.last_name,
        displayName: `${e.first_name} ${e.last_name}`.trim(),
        isActive: e.is_active,
        branchId,
        branchName,
        entities,
        laborType,
        lastPayrollDate: lastPayrollByEmployee[e.id] ?? null,
        rawNames,
        allAssignments: assignments,
      }
    })

    // ── Apply filters ────────────────────────────────────────────────────────

    let filtered = enriched

    // Search: matches displayName, firstName, lastName, or any raw_name_in_report
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      filtered = filtered.filter((e) => {
        if (e.displayName.toLowerCase().includes(q)) return true
        if (e.firstName.toLowerCase().includes(q)) return true
        if (e.lastName.toLowerCase().includes(q)) return true
        if (e.rawNames.some((rn) => rn.toLowerCase().includes(q))) return true
        return false
      })
    }

    // Branch filter: employee has an assignment with this branchId
    if (branchIdFilter) {
      filtered = filtered.filter((e) =>
        e.allAssignments.some((a) => a.payroll_codes?.branch_id === branchIdFilter)
      )
    }

    // Entity filter: employee has an assignment with this entity code
    if (entityCodeFilter) {
      filtered = filtered.filter((e) =>
        e.entities.includes(entityCodeFilter)
      )
    }

    // Labor type filter
    if (laborTypeFilter) {
      filtered = filtered.filter((e) => {
        if (!e.laborType) return false
        if (laborTypeFilter === 'corp') return e.laborType === 'corp_hourly' || e.laborType === 'corp_salary'
        if (laborTypeFilter === 'hq') return e.laborType === 'hq_hourly' || e.laborType === 'hq_salary'
        return e.laborType === laborTypeFilter
      })
    }

    // ── Sort ─────────────────────────────────────────────────────────────────

    filtered.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'branch') {
        cmp = (a.branchName ?? '').localeCompare(b.branchName ?? '')
      } else if (sortBy === 'lastPayrollDate') {
        cmp = (a.lastPayrollDate ?? '').localeCompare(b.lastPayrollDate ?? '')
      } else {
        // displayName default
        cmp = a.displayName.localeCompare(b.displayName)
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    const total = filtered.length
    const start = (page - 1) * pageSize
    const paged = filtered.slice(start, start + pageSize)

    return NextResponse.json({
      success: true,
      data: paged.map((e) => ({
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        displayName: e.displayName,
        isActive: e.isActive,
        branchId: e.branchId,
        branchName: e.branchName,
        entities: e.entities,
        laborType: e.laborType,
        lastPayrollDate: e.lastPayrollDate,
      })),
      total,
    })
  } catch (err) {
    return apiError(err)
  }
}
