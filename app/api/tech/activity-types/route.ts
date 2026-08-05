import { NextResponse } from 'next/server'
import { getTechContext } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Activity types for the tech app's "Add time" sheet (Yard / Transit / Onsite …).
 *
 * Tech-gated (getTechContext) and money-blind — these describe HOW time was spent, not
 * what it costs. Mirrors /api/billing/activity-types but reachable by a `tech`, whom the
 * dashboard/billing guards reject outright.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
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
