import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Magic-link landing. Exchanges the one-time code for a session (cookies set by the SSR
 * client), then hands off to /portal — where the layout gate resolves the portal account
 * and links auth_user_id on this first visit.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (code) {
    const supabase = createServerClient()
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL('/portal', url.origin))
}
