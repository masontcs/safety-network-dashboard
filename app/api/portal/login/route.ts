import { NextResponse } from 'next/server'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Customer-portal password sign-in. The customer types EITHER their email OR their username
 * plus a password. We resolve the identifier to the account's email with the service client
 * (the browser never supplies the username→email mapping), require an active portal account
 * (so a staff email can't sign in here), then authenticate with Supabase. A uniform "invalid"
 * error avoids revealing whether a given login exists.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { identifier?: string; password?: string }
  const identifier = (body.identifier ?? '').trim()
  const password = body.password ?? ''
  const invalid = NextResponse.json({ success: false, error: 'That login or password is incorrect.', code: 'PORTAL_BAD_LOGIN' }, { status: 401 })
  if (!identifier || !password) return invalid

  const svc = createServiceClient()
  const base = svc.from('billing_portal_accounts').select('email').eq('is_active', true)
  const { data: acct } = identifier.includes('@')
    ? await base.ilike('email', identifier).maybeSingle()
    : await base.ilike('username', identifier).maybeSingle()
  if (!acct?.email) return invalid

  const supabase = createServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email: acct.email.toLowerCase(), password })
  if (error) return invalid

  return NextResponse.json({ success: true })
}
