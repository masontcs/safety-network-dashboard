import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Auth landing for the portal. Exchanges the one-time code for a session (cookies set by
 * the SSR client), then hands off:
 *   • invite / password-reset links (?next=set-password) → the set-password page
 *   • anything else → /portal, where the layout gate resolves the account and links
 *     auth_user_id on first visit.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (code) {
    const supabase = createServerClient()
    await supabase.auth.exchangeCodeForSession(code)
  }
  const dest = url.searchParams.get('next') === 'set-password' ? '/portal/auth/set-password' : '/portal'
  return NextResponse.redirect(new URL(dest, url.origin))
}
