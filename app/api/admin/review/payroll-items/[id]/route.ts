import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as { groupId: string }
    const { groupId } = body

    if (!groupId) {
      return NextResponse.json(
        { success: false, error: 'groupId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    // Confirm the item and assign its group
    const { error: updateErr } = await supabase
      .from('payroll_items')
      .update({ group_id: groupId, is_confirmed: true })
      .eq('id', params.id)
    if (updateErr) throw new Error(updateErr.message)

    // Deploy any transactions that were staged waiting for this item
    const { data: staged, error: stagedErr } = await supabase
      .from('payroll_item_staged_transactions')
      .select('*')
      .eq('payroll_item_id', params.id)
    if (stagedErr) throw new Error(`Failed to fetch staged transactions: ${stagedErr.message}`)

    let deployedCount = 0
    for (const row of staged ?? []) {
      const { error } = await supabase.from('payroll_transactions').insert({
        import_id: row.import_id,
        employee_id: row.employee_id,
        entity_id: row.entity_id,
        payroll_code_id: row.payroll_code_id,
        period_date: row.period_date,
        payroll_item_id: params.id,
        hours: row.hours,
        rate: row.rate,
        amount: row.amount,
      })
      if (error) throw new Error(`Failed to deploy staged transaction: ${error.message}`)
      deployedCount++
    }

    if (deployedCount > 0) {
      const { error: delErr } = await supabase
        .from('payroll_item_staged_transactions')
        .delete()
        .eq('payroll_item_id', params.id)
      if (delErr) throw new Error(`Failed to clear staged transactions: ${delErr.message}`)
    }

    return NextResponse.json({ success: true, deployedCount })
  } catch (err) {
    return apiError(err)
  }
}
