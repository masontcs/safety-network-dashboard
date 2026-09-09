import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Customer-level settings. Currently just the House Account designation used by Front Counter
 * (walk-in profiles live under it; front counter can invoice its jobs freely). Admin-only —
 * there can be at most one House Account (enforced by a partial unique index).
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const adminGuard = guardAdminOnly(ctx.access.role)
    if (adminGuard) return adminGuard

    const body = (await request.json()) as { isHouseAccount?: boolean }
    if (typeof body.isHouseAccount !== 'boolean') return bad('isHouseAccount (boolean) is required')

    const supabase = createServiceClient()
    const { data: existing } = await supabase.from('billing_customers').select('id').eq('id', params.id).maybeSingle()
    if (!existing) return bad('Customer not found', 'NOT_FOUND', 404)

    if (body.isHouseAccount) {
      // Only one House Account allowed — clear any other before setting this one.
      await supabase.from('billing_customers').update({ is_house_account: false }).eq('is_house_account', true).neq('id', params.id)
    }
    const { error } = await supabase.from('billing_customers').update({ is_house_account: body.isHouseAccount }).eq('id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
