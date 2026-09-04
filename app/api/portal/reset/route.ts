import { NextResponse } from 'next/server'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'

/**
 * "Forgot password" — send a reset link, but ONLY to an email that has an active portal
 * account. Unknown emails get the same success response (no account enumeration) and no
 * email is sent. The link lands on the callback, which routes to the set-password page.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { email?: string }
  const email = (body.email ?? '').trim().toLowerCase()
  const ok = NextResponse.json({ success: true }) // uniform response
  if (!email || !email.includes('@')) return ok

  const svc = createServiceClient()
  const { data: acct } = await svc
    .from('billing_portal_accounts')
    .select('id')
    .ilike('email', email)
    .eq('is_active', true)
    .maybeSingle()
  if (!acct) return ok // no leak; send nothing

  const origin = new URL(request.url).origin
  const supabase = createServerClient()
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/portal/auth/callback?next=set-password` })
  return ok
}
