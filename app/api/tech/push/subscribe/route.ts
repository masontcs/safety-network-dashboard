import { NextResponse } from 'next/server'
import { getTechContext } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * A tech's web-push subscription for one device. POST to register (or refresh) it, DELETE to
 * turn notifications off on that device. One row per endpoint; re-subscribing upserts.
 */

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const body = (await request.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    const endpoint = body.endpoint
    const p256dh = body.keys?.p256dh
    const auth = body.keys?.auth
    if (!endpoint || !p256dh || !auth) return NextResponse.json({ success: false, error: 'Invalid subscription.', code: 'VALIDATION_ERROR' }, { status: 400 })

    const supabase = createServiceClient()
    const { error } = await supabase.from('push_subscriptions').upsert(
      { user_id: ctx.tech.userId, endpoint, p256dh, auth, user_agent: request.headers.get('user-agent') },
      { onConflict: 'endpoint' }
    )
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const endpoint = new URL(request.url).searchParams.get('endpoint')
    if (!endpoint) return NextResponse.json({ success: false, error: 'endpoint is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    const supabase = createServiceClient()
    // Scope the delete to the caller so a device can only remove its own subscription.
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', ctx.tech.userId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
