import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Database } from '@/lib/supabase/database.types'

type AssignmentUpdate = Database['public']['Tables']['employee_entity_assignments']['Update']

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
      action: 'confirm' | 'skip'
      employeeId?: string
      payrollCodeId?: string
    }
    const { action, employeeId, payrollCodeId } = body

    if (action !== 'confirm' && action !== 'skip') {
      return NextResponse.json(
        { success: false, error: 'action must be confirm or skip', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    const update: AssignmentUpdate = { is_confirmed: true }
    if (action === 'confirm' && employeeId) update.employee_id = employeeId
    if (payrollCodeId) update.payroll_code_id = payrollCodeId

    const { error } = await supabase
      .from('employee_entity_assignments')
      .update(update)
      .eq('id', params.id)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
