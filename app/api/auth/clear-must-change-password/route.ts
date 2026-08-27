import { NextResponse } from 'next/server'
import { createRouteClient, createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

/**
 * Self-service: clear the caller's own must_change_password flag after they've set a new
 * password. Resolves the user straight from the session claims (NOT getAccessContext) so it
 * works for ANY authenticated role — including techs, who are rejected by getAccessContext.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const routeClient = createRouteClient()
    const { data: claims, error: authErr } = await routeClient.auth.getClaims()
    const userId = claims?.claims?.sub as string | undefined
    if (authErr || !userId) return NextResponse.json({ success: false, error: 'Unauthorized.', code: 'UNAUTHORIZED' }, { status: 401 })

    const supabase = createServiceClient()
    const { error } = await supabase.from('user_profiles').update({ must_change_password: false }).eq('id', userId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
