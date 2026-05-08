import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { LaborType } from '@/lib/supabase/database.types'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as {
      mode: 'new_employee' | 'link_existing' | 'skip' | 'tag_business'
      branchId?: string
      laborType?: string
      existingEmployeeId?: string
      businessTag?: string
    }
    const { mode } = body

    if (mode !== 'new_employee' && mode !== 'link_existing' && mode !== 'skip' && mode !== 'tag_business') {
      return NextResponse.json(
        { success: false, error: 'mode must be new_employee, link_existing, skip, or tag_business', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    // Fetch the assignment to get entity_id
    const { data: assignment, error: assignErr } = await supabase
      .from('employee_entity_assignments')
      .select('id, employee_id, entity_id')
      .eq('id', params.id)
      .single()

    if (assignErr || !assignment) {
      return NextResponse.json({ success: false, error: 'Assignment not found' }, { status: 404 })
    }

    // ── Skip ─────────────────────────────────────────────────────────────────
    if (mode === 'skip') {
      const { error } = await supabase
        .from('employee_entity_assignments')
        .update({ is_confirmed: true })
        .eq('id', params.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true })
    }

    // ── Tag as business (WH / Signs) ─────────────────────────────────────────
    if (mode === 'tag_business') {
      const { businessTag } = body
      if (businessTag !== 'western_highways' && businessTag !== 'signs') {
        return NextResponse.json(
          { success: false, error: 'businessTag must be western_highways or signs', code: 'VALIDATION_ERROR' },
          { status: 400 },
        )
      }
      const { error } = await supabase
        .from('employee_entity_assignments')
        .update({ business_tag: businessTag, is_confirmed: true })
        .eq('id', params.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true })
    }

    // ── Shared helper: resolve payroll code by entity + branch + labor type ──
    async function resolveCode(entityId: string, branchId: string, laborType: string): Promise<string | null> {
      const { data } = await supabase
        .from('payroll_codes')
        .select('id')
        .eq('entity_id', entityId)
        .eq('branch_id', branchId)
        .eq('labor_type', laborType as LaborType)
        .eq('is_active', true)
        .limit(1)
      return data?.[0]?.id ?? null
    }

    async function buildNoCodeError(entityId: string, branchId: string, laborType: string): Promise<NextResponse> {
      const [{ data: entity }, { data: branch }] = await Promise.all([
        supabase.from('entities').select('code').eq('id', entityId).single(),
        supabase.from('branches').select('name').eq('id', branchId).single(),
      ])
      const entityCode = entity?.code ?? entityId
      const branchName = branch?.name ?? branchId
      const laborLabel = laborType.replace(/_/g, ' ')
      return NextResponse.json(
        {
          success: false,
          error: `No payroll code found for ${entityCode} + ${branchName} + ${laborLabel}. Please check payroll codes in settings.`,
          code: 'NO_PAYROLL_CODE',
        },
        { status: 422 },
      )
    }

    // ── New employee ──────────────────────────────────────────────────────────
    if (mode === 'new_employee') {
      const { branchId, laborType } = body
      if (!branchId || !laborType) {
        return NextResponse.json(
          { success: false, error: 'branchId and laborType are required for new_employee', code: 'VALIDATION_ERROR' },
          { status: 400 },
        )
      }

      const codeId = await resolveCode(assignment.entity_id, branchId, laborType)
      if (!codeId) return buildNoCodeError(assignment.entity_id, branchId, laborType)

      const { error } = await supabase
        .from('employee_entity_assignments')
        .update({ payroll_code_id: codeId, is_confirmed: true })
        .eq('id', params.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true })
    }

    // ── Link existing ─────────────────────────────────────────────────────────
    if (mode === 'link_existing') {
      const { existingEmployeeId, branchId, laborType } = body
      if (!existingEmployeeId) {
        return NextResponse.json(
          { success: false, error: 'existingEmployeeId is required for link_existing', code: 'VALIDATION_ERROR' },
          { status: 400 },
        )
      }

      // Check if the existing employee already has a confirmed assignment for this entity
      const { data: priorAssignment } = await supabase
        .from('employee_entity_assignments')
        .select('payroll_code_id')
        .eq('employee_id', existingEmployeeId)
        .eq('entity_id', assignment.entity_id)
        .eq('is_confirmed', true)
        .limit(1)
        .maybeSingle()

      let payrollCodeId: string | null = priorAssignment?.payroll_code_id ?? null

      if (!payrollCodeId) {
        // No prior assignment — need branch + labor type from the admin
        if (!branchId || !laborType) {
          return NextResponse.json(
            {
              success: false,
              error: 'branchId and laborType are required: selected employee has no existing assignment for this entity',
              code: 'VALIDATION_ERROR',
            },
            { status: 400 },
          )
        }
        const resolved = await resolveCode(assignment.entity_id, branchId, laborType)
        if (!resolved) return buildNoCodeError(assignment.entity_id, branchId, laborType)
        payrollCodeId = resolved
      }

      const { error } = await supabase
        .from('employee_entity_assignments')
        .update({ employee_id: existingEmployeeId, payroll_code_id: payrollCodeId, is_confirmed: true })
        .eq('id', params.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Unknown mode' }, { status: 400 })
  } catch (err) {
    return apiError(err)
  }
}
