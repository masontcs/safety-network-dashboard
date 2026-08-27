import { NextResponse } from 'next/server'
import { getTechContext, techBad } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'

/**
 * A tech acknowledges their shift ("Accept") — records they've seen the meal type, schedule
 * and plan. Not a decline: acknowledgement only. A tech may only acknowledge a shift they're
 * actually on (positive crew check).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const { data: crew } = await supabase
      .from('billing_shift_crew')
      .select('id, acknowledged_at')
      .eq('shift_id', params.id)
      .eq('technician_id', ctx.tech.technicianId)
      .maybeSingle()
    if (!crew) return techBad('Shift not found', 'NOT_FOUND', 404) // not mine — don't confirm it exists

    if (!crew.acknowledged_at) {
      const { error } = await supabase
        .from('billing_shift_crew')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', crew.id)
      if (error) throw new Error(error.message)
      await broadcastBillingChanged()
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
