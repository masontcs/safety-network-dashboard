import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { effectiveBillingRole } from '@/lib/utils/interfaces'

/**
 * Billing customers. A customer is entity-agnostic and branch-agnostic — it
 * simply aggregates its billing profiles (which ARE branch-owned).
 *
 * `code` is INTERNAL only. QuickBooks reads customers by NAME, as
 * "{customer.name} - {profile.name}" (see the billing_profile_qb_names view).
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_customers')
      .select('id, code, name, is_active, is_house_account, default_payment_term_id, ar_customer_id, billing_profiles(id)')
      .order('name')
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      isAdmin: ctx.access.role === 'admin',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: (data ?? []).map((c: any) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        isActive: c.is_active,
        isHouseAccount: c.is_house_account,
        defaultPaymentTermId: c.default_payment_term_id,
        arCustomerId: c.ar_customer_id,
        profileCount: (c.billing_profiles ?? []).length,
      })),
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard

    // Front Counter never creates top-level customers — walk-ins go in as profiles under the
    // House Account, which billing/admin has already set up.
    if (effectiveBillingRole(ctx.access.role, ctx.access.billingRole) === 'front_counter') {
      return bad('Front counter adds walk-ins as profiles under the House Account, not as new customers.', 'FORBIDDEN', 403)
    }

    const body = (await request.json()) as {
      code?: string
      name?: string
      defaultPaymentTermId?: string | null
    }
    const code = body.code?.trim().toUpperCase()
    const name = body.name?.trim()
    if (!code) return bad('Customer code is required')
    if (!name) return bad('Customer name is required')

    const supabase = createServiceClient()

    const { data: dup, error: dErr } = await supabase
      .from('billing_customers')
      .select('id')
      .eq('code', code)
      .maybeSingle()
    if (dErr) throw new Error(dErr.message)
    if (dup) return bad(`A customer with code "${code}" already exists`, 'CONFLICT', 409)

    const { data: created, error } = await supabase
      .from('billing_customers')
      .insert({ code, name, default_payment_term_id: body.defaultPaymentTermId ?? null })
      .select('id, code, name')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create customer')

    return NextResponse.json({ success: true, data: created })
  } catch (err) {
    return billingApiError(err)
  }
}
