import { NextResponse } from 'next/server'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Finish an invite / password reset. The customer arrives here already carrying a session
 * (the invite/recovery link's code was exchanged in /portal/auth/callback), then sets their
 * password and — optionally — a short username for quicker logins. We also stamp
 * auth_user_id + last_login_at on the matching portal account so future logins resolve
 * directly.
 */

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { password?: string; username?: string }
  const password = body.password ?? ''
  const username = (body.username ?? '').trim()

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ success: false, error: 'Your link has expired. Request a new one from the sign-in page.', code: 'PORTAL_NO_SESSION' }, { status: 401 })
  }

  if (password.length < 8) return bad('Password must be at least 8 characters.')
  if (username && !USERNAME_RE.test(username)) return bad('Username must be 3–30 characters: letters, numbers, dot, dash or underscore.')

  const svc = createServiceClient()

  // Username must be globally unique (case-insensitive), not counting this account.
  const { data: acct } = await svc
    .from('billing_portal_accounts')
    .select('id')
    .ilike('email', user.email)
    .eq('is_active', true)
    .maybeSingle()
  if (!acct) return NextResponse.json({ success: false, error: 'No portal access for this account.' }, { status: 403 })

  if (username) {
    const { data: taken } = await svc
      .from('billing_portal_accounts')
      .select('id')
      .ilike('username', username)
      .neq('id', acct.id)
      .maybeSingle()
    if (taken) return bad('That username is already taken — pick another.')
  }

  const { error: pwErr } = await supabase.auth.updateUser({ password })
  if (pwErr) return bad(pwErr.message)

  await svc
    .from('billing_portal_accounts')
    .update({ auth_user_id: user.id, last_login_at: new Date().toISOString(), ...(username ? { username } : {}) })
    .eq('id', acct.id)

  return NextResponse.json({ success: true })
}
