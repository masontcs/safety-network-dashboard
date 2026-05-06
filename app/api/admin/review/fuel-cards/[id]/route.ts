import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { Database, BusinessTag } from '@/lib/supabase/database.types'

type FuelCardUpdate = Database['public']['Tables']['fuel_card_assignments']['Update']
type FuelTxnUpdate = Database['public']['Tables']['fuel_transactions']['Update']

const VALID_TAGS = ['western_highways', 'signs'] as const
type ValidTag = (typeof VALID_TAGS)[number]

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as { branchId?: string; businessTag?: string; employeeId?: string }
    const { branchId, businessTag, employeeId } = body

    if (!branchId && !businessTag && !employeeId) {
      return NextResponse.json(
        { success: false, error: 'branchId, businessTag, or employeeId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    if (businessTag && !VALID_TAGS.includes(businessTag as ValidTag)) {
      return NextResponse.json(
        { success: false, error: `businessTag must be one of: ${VALID_TAGS.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    const update: FuelCardUpdate = { is_confirmed: true }

    if (businessTag) {
      // Tag as WH or Signs — clear branch assignment
      update.business_tag = businessTag as ValidTag
      update.branch_id = null
    } else if (branchId) {
      // Assign to branch — clear any business tag
      update.branch_id = branchId
      update.business_tag = null
    }

    if (employeeId) update.employee_id = employeeId

    const { error } = await supabase
      .from('fuel_card_assignments')
      .update(update)
      .eq('id', params.id)

    if (error) throw new Error(error.message)

    // Retroactively backfill all historical transactions for this card
    const txnUpdate: FuelTxnUpdate = {}
    if (businessTag) {
      txnUpdate.business_tag = businessTag as BusinessTag
      txnUpdate.branch_id = null
      txnUpdate.employee_id = null
    } else if (branchId) {
      txnUpdate.branch_id = branchId
      txnUpdate.business_tag = null
    }
    if (employeeId) txnUpdate.employee_id = employeeId

    const { error: txnError } = await supabase
      .from('fuel_transactions')
      .update(txnUpdate)
      .eq('fuel_card_assignment_id', params.id)

    if (txnError) throw new Error(txnError.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
