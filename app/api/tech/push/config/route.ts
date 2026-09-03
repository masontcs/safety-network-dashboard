import { NextResponse } from 'next/server'
import { getTechContext } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/** The VAPID public key the tech app needs to create a push subscription. Public by design. */
export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()
    const { data } = await supabase.from('push_config').select('public_key').eq('id', true).maybeSingle()
    if (!data) return NextResponse.json({ success: false, error: 'Push is not configured.', code: 'NOT_CONFIGURED' }, { status: 503 })
    return NextResponse.json({ success: true, data: { publicKey: (data as { public_key: string }).public_key } })
  } catch (err) {
    return billingApiError(err)
  }
}
