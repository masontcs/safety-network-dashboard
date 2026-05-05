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

    // Fetch all three queues in parallel
    const [empRes, itemRes, cardRes, groupRes, branchRes] = await Promise.all([
      supabase
        .from('employee_entity_assignments')
        .select('id, raw_name_in_report, ai_match_score, ai_match_candidate, entity_id')
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
      supabase.from('branches').select('id, name').eq('is_revenue_generating', true).order('name'),
    ])

    if (empRes.error) throw new Error(empRes.error.message)
    if (itemRes.error) throw new Error(itemRes.error.message)
    if (cardRes.error) throw new Error(cardRes.error.message)

    const empAssignments = empRes.data ?? []
    const payrollItems = itemRes.data ?? []
    const fuelCards = cardRes.data ?? []
    const groups = groupRes.data ?? []
    const branches = branchRes.data ?? []

    // Resolve entity codes for employee assignments
    const entityIds = [...new Set(empAssignments.map((e) => e.entity_id))]
    const { data: entities } = await supabase
      .from('entities')
      .select('id, code')
      .in('id', entityIds.length > 0 ? entityIds : ['__none__'])

    const entityMap = Object.fromEntries((entities ?? []).map((e) => [e.id, e.code]))

    // Resolve AI candidate employee names for assignments
    const candidateIds = empAssignments
      .map((e) => e.ai_match_candidate)
      .filter((id): id is string => id !== null)
    const { data: candidates } = await supabase
      .from('employees')
      .select('id, first_name, last_name')
      .in('id', candidateIds.length > 0 ? candidateIds : ['__none__'])

    const candidateMap = Object.fromEntries(
      (candidates ?? []).map((e) => [
        e.id,
        `${e.first_name} ${e.last_name}`.trim(),
      ]),
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

    return NextResponse.json({
      success: true,
      data: {
        employeeAssignments: empAssignments.map((e) => ({
          id: e.id,
          rawName: e.raw_name_in_report,
          entityCode: entityMap[e.entity_id] ?? e.entity_id,
          aiCandidateId: e.ai_match_candidate,
          aiCandidateName: e.ai_match_candidate ? candidateMap[e.ai_match_candidate] : null,
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
          currentEmployeeName: c.employee_id ? empNameMap[c.employee_id] : null,
          currentBranchId: c.branch_id,
          businessTag: c.business_tag,
        })),
        groups: groups.map((g) => ({ id: g.id, name: g.name })),
        branches: branches.map((b) => ({ id: b.id, name: b.name })),
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
