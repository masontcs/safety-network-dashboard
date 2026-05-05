import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Database } from '@/lib/supabase/database.types'

type FuelCardUpdate = Database['public']['Tables']['fuel_card_assignments']['Update']

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as { branchId?: string; employeeId?: string }
    const { branchId, employeeId } = body

    if (!branchId && !employeeId) {
      return NextResponse.json(
        { success: false, error: 'branchId or employeeId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    const update: FuelCardUpdate = { is_confirmed: true }
    if (branchId) update.branch_id = branchId
    if (employeeId) update.employee_id = employeeId

    const { error } = await supabase
      .from('fuel_card_assignments')
      .update(update)
      .eq('id', params.id)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
