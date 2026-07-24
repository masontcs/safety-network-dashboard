import { NextResponse } from 'next/server'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Send a magic sign-in link — but ONLY to an email that an admin has already provisioned
 * a portal account for. Unknown emails get the same success response (never reveal who
 * has access) and no link is sent, so this can't be used to enumerate accounts or to
 * spawn stray auth users.
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
  await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/portal/auth/callback` },
  })
  return ok
}
