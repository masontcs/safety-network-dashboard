import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    // Fetch all queues + reference data in parallel
    const [empRes, itemRes, cardRes, groupRes, branchRes, codeRes, bizRes, allEmpRes] = await Promise.all([
      supabase
        .from('employee_entity_assignments')
        .select('id, raw_name_in_report, ai_match_score, ai_match_candidate, entity_id, payroll_code_id')
        .eq('is_confirmed', false),
      supabase
        .from('payroll_items')
        .select('id, name, ai_suggested_group, ai_confidence, group_id')
        .eq('is_confirmed', false),
      supabase
        .from('fuel_card_assignments')
        .select('id, card_name, vendor, employee_id, branch_id, business_tag')
        .eq('is_confirmed', false),
      supabase.from('payroll_item_groups').select('id, name'),
      supabase
        .from('branches')
        .select('id, name, is_corporate, is_revenue_generating, business_id')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('payroll_codes')
        .select('id, code, labor_type, branch_id, entity_id')
        .eq('is_active', true)
        .order('code'),
      supabase.from('businesses').select('id, code'),
      supabase.from('employees').select('id, first_name, last_name').eq('is_active', true).order('last_name'),
    ])

    if (empRes.error) throw new Error(empRes.error.message)
    if (itemRes.error) throw new Error(itemRes.error.message)
    if (cardRes.error) throw new Error(cardRes.error.message)

    const empAssignments = empRes.data ?? []
    const payrollItems = itemRes.data ?? []
    const fuelCards = cardRes.data ?? []
    const groups = groupRes.data ?? []
    const rawBranches = branchRes.data ?? []
    const rawCodes = codeRes.data ?? []
    const businesses = bizRes.data ?? []
    const allEmployees = (allEmpRes.data ?? []) as { id: string; first_name: string; last_name: string }[]

    const bizCodeMap = Object.fromEntries(
      (businesses as { id: string; code: string }[]).map((b) => [b.id, b.code]),
    )

    // Resolve entity codes
    const entityIds = [...new Set([
      ...empAssignments.map((e) => e.entity_id),
      ...rawCodes.map((c) => c.entity_id),
    ])]
    const { data: entities } = await supabase
      .from('entities')
      .select('id, code')
      .in('id', entityIds.length > 0 ? entityIds : ['__none__'])

    const entityMap = Object.fromEntries((entities ?? []).map((e) => [e.id, e.code]))

    // Resolve branch names for payroll codes
    const branchNameMap = Object.fromEntries(
      (rawBranches as { id: string; name: string }[]).map((b) => [b.id, b.name]),
    )

    // Resolve AI candidate names
    const candidateIds = empAssignments
      .map((e) => e.ai_match_candidate)
      .filter((id): id is string => id !== null)
    const { data: candidates } = await supabase
      .from('employees')
      .select('id, first_name, last_name')
      .in('id', candidateIds.length > 0 ? candidateIds : ['__none__'])

    const candidateMap = Object.fromEntries(
      (candidates ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]),
    )

    // Resolve employee names for fuel card assignments
    const empIds = fuelCards
      .map((c) => c.employee_id)
      .filter((id): id is string => id !== null)
    const { data: empNames } = await supabase
      .from('employees')
      .select('id, first_name, last_name')
      .in('id', empIds.length > 0 ? empIds : ['__none__'])

    const empNameMap = Object.fromEntries(
      (empNames ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]),
    )

    // Build employee entity assignment pills for the searchable dropdown
    const allEmpIds = allEmployees.map((e) => e.id)
    const { data: confirmedAssignments } = await supabase
      .from('employee_entity_assignments')
      .select('employee_id, entity_id, payroll_code_id')
      .eq('is_confirmed', true)
      .in('employee_id', allEmpIds.length > 0 ? allEmpIds : ['__none__'])

    const codeDetailMap = Object.fromEntries(
      rawCodes.map((pc) => [pc.id, { laborType: pc.labor_type, branchId: pc.branch_id }]),
    )

    const empEntityMap: Record<string, Array<{ entityCode: string; branchName: string; laborType: string }>> = {}
    for (const ea of confirmedAssignments ?? []) {
      if (!empEntityMap[ea.employee_id]) empEntityMap[ea.employee_id] = []
      const codeDetail = ea.payroll_code_id ? codeDetailMap[ea.payroll_code_id] : null
      const entityCode = entityMap[ea.entity_id] ?? ea.entity_id
      const branchName = codeDetail?.branchId ? (branchNameMap[codeDetail.branchId] ?? 'Unknown') : 'Corp/HQ'
      const laborType = codeDetail?.laborType ?? 'unknown'
      if (!empEntityMap[ea.employee_id].some((x) => x.entityCode === entityCode)) {
        empEntityMap[ea.employee_id].push({ entityCode, branchName, laborType })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        employeeAssignments: empAssignments.map((e) => ({
          id: e.id,
          rawName: e.raw_name_in_report,
          entityCode: entityMap[e.entity_id] ?? e.entity_id,
          currentPayrollCodeId: e.payroll_code_id,
          aiCandidateId: e.ai_match_candidate,
          aiCandidateName: e.ai_match_candidate ? (candidateMap[e.ai_match_candidate] ?? null) : null,
          aiScore: e.ai_match_score,
        })),
        payrollItems: payrollItems.map((i) => ({
          id: i.id,
          name: i.name,
          suggestedGroup: i.ai_suggested_group,
          confidence: i.ai_confidence,
          currentGroupId: i.group_id,
        })),
        fuelCards: fuelCards.map((c) => ({
          id: c.id,
          cardName: c.card_name,
          vendor: c.vendor,
          currentEmployeeId: c.employee_id,
          currentEmployeeName: c.employee_id ? (empNameMap[c.employee_id] ?? null) : null,
          currentBranchId: c.branch_id,
          businessTag: c.business_tag,
        })),
        groups: groups.map((g) => ({ id: g.id, name: g.name })),
        branches: (rawBranches as {
          id: string; name: string; is_corporate: boolean
          is_revenue_generating: boolean; business_id: string
        }[]).map((b) => ({
          id: b.id,
          name: b.name,
          isCorporate: b.is_corporate,
          isRevenueGenerating: b.is_revenue_generating,
          businessCode: bizCodeMap[b.business_id] ?? 'SN',
        })),
        payrollCodes: rawCodes.map((pc) => ({
          id: pc.id,
          code: pc.code,
          laborType: pc.labor_type,
          branchId: pc.branch_id,
          branchName: pc.branch_id ? (branchNameMap[pc.branch_id] ?? 'Unknown') : 'Corp / HQ',
          entityCode: entityMap[pc.entity_id] ?? pc.entity_id,
        })),
        employees: allEmployees.map((e) => ({
          id: e.id,
          displayName: `${e.first_name} ${e.last_name}`.trim(),
          entityAssignments: empEntityMap[e.id] ?? [],
        })),
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
