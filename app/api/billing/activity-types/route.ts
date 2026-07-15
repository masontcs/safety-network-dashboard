import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Activity types — the GLOBAL list describing how a tech's time was spent
 * (Yard / Transit / Onsite). Descriptive only: not item categories, not billable.
 * Billing decides separately which activity types roll into which labor item.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_activity_types')
      .select('id, name, sort_order')
      .eq('is_active', true)
      .order('sort_order')
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      data: (data ?? []).map((a) => ({ id: a.id, name: a.name })),
    })
  } catch (err) {
    return billingApiError(err)
  }
}
