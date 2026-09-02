import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Admin provisioning of customer-portal logins. GET lists a customer's accounts; POST
 * adds one (first contact per customer becomes the 'owner'). The person then signs in
 * at /portal/login via magic link — we don't create the auth user here; it's linked on
 * their first login by matching email.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard

    const customerId = new URL(request.url).searchParams.get('customerId')
    if (!customerId) return bad('customerId is required')

    const svc = createServiceClient()
    const { data, error } = await svc
      .from('billing_portal_accounts')
      .select('id, email, name, role, is_active, auth_user_id, last_login_at, created_at')
      .eq('customer_id', customerId)
      .order('created_at')
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      data: (data ?? []).map((a) => ({
        id: a.id, email: a.email, name: a.name, role: a.role, isActive: a.is_active,
        activated: a.auth_user_id !== null, lastLoginAt: a.last_login_at,
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

    const body = (await request.json()) as { customerId?: string; email?: string; name?: string }
    const customerId = body.customerId
    const email = (body.email ?? '').trim().toLowerCase()
    const name = (body.name ?? '').trim() || null
    if (!customerId) return bad('customerId is required')
    if (!email || !email.includes('@')) return bad('A valid email is required')

    const svc = createServiceClient()

    const { data: cust } = await svc.from('billing_customers').select('id').eq('id', customerId).maybeSingle()
    if (!cust) return bad('Customer not found', 'NOT_FOUND', 404)

    // Duplicate guard (case-insensitive) — the DB has a unique index but give a clean error.
    const { data: dupe } = await svc
      .from('billing_portal_accounts')
      .select('id')
      .eq('customer_id', customerId)
      .ilike('email', email)
      .maybeSingle()
    if (dupe) return bad('That email already has portal access for this customer', 'CONFLICT', 409)

    // First contact for a customer is the owner; the rest are members.
    const { count } = await svc
      .from('billing_portal_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
    const role: 'owner' | 'member' = (count ?? 0) === 0 ? 'owner' : 'member'

    const { data: created, error } = await svc
      .from('billing_portal_accounts')
      .insert({ customer_id: customerId, email, name, role, invited_by: ctx.access.userId })
      .select('id, email, name, role, is_active')
      .single()
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      data: { id: created.id, email: created.email, name: created.name, role: created.role, isActive: created.is_active, activated: false, lastLoginAt: null },
    })
  } catch (err) {
    return billingApiError(err)
  }
}
