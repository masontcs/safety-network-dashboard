import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as {
      revenueTarget?: number | null
      profitPctTarget?: number | null
    }

    const { revenueTarget, profitPctTarget } = body

    if (revenueTarget != null && (typeof revenueTarget !== 'number' || revenueTarget < 0)) {
      return NextResponse.json({ success: false, error: 'revenueTarget must be a non-negative number', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (profitPctTarget != null && (typeof profitPctTarget !== 'number' || profitPctTarget < 0 || profitPctTarget > 100)) {
      return NextResponse.json({ success: false, error: 'profitPctTarget must be between 0 and 100', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const updates = {
      updated_at: new Date().toISOString(),
      ...('revenueTarget' in body ? { revenue_target: revenueTarget ?? null } : {}),
      ...('profitPctTarget' in body ? { profit_pct_target: profitPctTarget ?? null } : {}),
    }

    const { data, error } = await supabase
      .from('branch_targets')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single()

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Target not found.', code: 'NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data })
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const { error } = await supabase
      .from('branch_targets')
      .delete()
      .eq('id', params.id)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
