import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Billing profiles — the spine of the system.
 *
 * A profile is BRANCH-OWNED. Jobs attach to a profile, not to a customer
 * (the customer is derived). The profile carries the payment term, the rental
 * minimum, the per-profile field rules, and — via billing_profile_entities —
 * the per-entity price list.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    let query = supabase
      .from('billing_profiles')
      .select(`
        id, code, name, branch_id, is_active, rental_minimum_enabled, rental_minimum_cents,
        billing_customers(id, code, name),
        branches(id, name),
        billing_payment_terms(id, name),
        billing_profile_entities(entity_id, enabled, price_list_id)
      `)
      .order('name')

    // Optional scope: a customer's own profiles (avoids fetching every profile just to
    // filter client-side on the customer detail page).
    const customerId = new URL(request.url).searchParams.get('customerId')
    if (customerId) query = query.eq('customer_id', customerId)

    if (ctx.access.branchIds !== null) {
      if (ctx.access.branchIds.length === 0) return NextResponse.json({ success: true, data: [] })
      query = query.in('branch_id', ctx.access.branchIds)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: (data ?? []).map((p: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enabled = (p.billing_profile_entities ?? []).filter((e: any) => e.enabled)
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          isActive: p.is_active,
          branch: { id: p.branch_id, name: p.branches?.name ?? '' },
          customer: p.billing_customers
            ? { id: p.billing_customers.id, code: p.billing_customers.code, name: p.billing_customers.name }
            : null,
          paymentTerm: p.billing_payment_terms?.name ?? null,
          // QuickBooks reads by name: "{customer} - {profile}"
          qbName: p.billing_customers ? `${p.billing_customers.name} - ${p.name}` : p.name,
          enabledEntityCount: enabled.length,
          // an enabled entity with no price list is a misconfiguration worth surfacing
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          unconfiguredEntityCount: enabled.filter((e: any) => !e.price_list_id).length,
          // entities this profile can actually bill under (enabled AND priced) —
          // the New Job form offers only these.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          billableEntityIds: enabled.filter((e: any) => e.price_list_id).map((e: any) => e.entity_id),
        }
      }),
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // Billing roles are not defined yet — writes are admin-only until they are.
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard

    const body = (await request.json()) as {
      customerId?: string
      branchId?: string
      code?: string
      name?: string
      paymentTermId?: string | null
      rentalMinimumEnabled?: boolean
      rentalMinimumCents?: number
    }

    const customerId = body.customerId
    const branchId = body.branchId
    const code = body.code?.trim().toUpperCase()
    const name = body.name?.trim()

    if (!customerId) return bad('Customer is required')
    if (!branchId) return bad('Branch is required')
    if (!code) return bad('Profile code is required')
    if (!name) return bad('Profile name is required')

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(branchId)) {
      return bad('You do not have access to that branch.', 'FORBIDDEN', 403)
    }

    const rentalMinimumCents = body.rentalMinimumCents ?? 2500
    if (!Number.isInteger(rentalMinimumCents) || rentalMinimumCents < 0) {
      return bad('Rental minimum must be a whole number of cents, zero or greater')
    }

    const supabase = createServiceClient()

    // The branch must actually be billing-enabled — otherwise it has no
    // 2-letter code and invoice numbers cannot be generated for it.
    const { data: branchSetting, error: bsErr } = await supabase
      .from('billing_branch_settings')
      .select('branch_id')
      .eq('branch_id', branchId)
      .eq('billing_enabled', true)
      .maybeSingle()
    if (bsErr) throw new Error(bsErr.message)
    if (!branchSetting) return bad('That branch is not enabled for billing.', 'CONFLICT', 409)

    const { data: dup, error: dErr } = await supabase
      .from('billing_profiles')
      .select('id')
      .eq('customer_id', customerId)
      .eq('code', code)
      .maybeSingle()
    if (dErr) throw new Error(dErr.message)
    if (dup) return bad(`This customer already has a profile with code "${code}"`, 'CONFLICT', 409)

    const { data: created, error } = await supabase
      .from('billing_profiles')
      .insert({
        customer_id: customerId,
        branch_id: branchId,
        code,
        name,
        payment_term_id: body.paymentTermId ?? null,
        rental_minimum_enabled: body.rentalMinimumEnabled ?? true,
        rental_minimum_cents: rentalMinimumCents,
      })
      .select('id, code, name')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create billing profile')

    return NextResponse.json({ success: true, data: created })
  } catch (err) {
    return billingApiError(err)
  }
}
