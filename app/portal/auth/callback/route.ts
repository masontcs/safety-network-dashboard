import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Auth landing for the portal. Establishes the session server-side (cookies set by the SSR
 * client), then hands off:
 *   • invite / password-reset links (?next=set-password) → the set-password page
 *   • anything else → /portal, where the layout gate resolves the account and links
 *     auth_user_id on first visit.
 *
 * Two link shapes are supported:
 *   • token_hash + type — the shape invite/recovery emails use (verifyOtp). This is what
 *     our email templates link to.
 *   • code — the PKCE exchange (exchangeCodeForSession), kept for completeness.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const code = url.searchParams.get('code')

  const supabase = createServerClient()
  if (tokenHash && type) {
    await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  } else if (code) {
    await supabase.auth.exchangeCodeForSession(code)
  }

  const dest = url.searchParams.get('next') === 'set-password' ? '/portal/auth/set-password' : '/portal'
  return NextResponse.redirect(new URL(dest, url.origin))
}
