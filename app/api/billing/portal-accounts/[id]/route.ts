import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { portalSetPasswordRedirect } from '@/lib/utils/domains'

/**
 * Resend a portal account's set-password email. Works whether or not the auth user exists
 * yet: invite creates it; if it's already there (or already active) a reset link is sent —
 * both land on the set-password page.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard

    const svc = createServiceClient()
    const { data: acct } = await svc
      .from('billing_portal_accounts')
      .select('email, is_active')
      .eq('id', params.id)
      .maybeSingle()
    if (!acct) return NextResponse.json({ success: false, error: 'Account not found', code: 'NOT_FOUND' }, { status: 404 })
    if (!acct.is_active) return NextResponse.json({ success: false, error: 'That account is inactive.' }, { status: 400 })

    const { error: invErr } = await svc.auth.admin.inviteUserByEmail(acct.email, { redirectTo: portalSetPasswordRedirect() })
    if (invErr) {
      const { error: resetErr } = await svc.auth.resetPasswordForEmail(acct.email, { redirectTo: portalSetPasswordRedirect() })
      if (resetErr) throw new Error(resetErr.message)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
