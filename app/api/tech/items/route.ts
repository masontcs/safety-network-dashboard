import { NextResponse } from 'next/server'
import { getTechContext } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Equipment picker for the tech app — the full catalog of RENTABLE items.
 *
 * Money-blind: no prices, ever. Only what a tech needs to record equipment:
 * code, name, whether it's tracked (needs an equipment ID), and its variations.
 * Tech-gated via getTechContext; the billing item picker (getAccessContext) returns
 * sale prices and must never be reachable here.
 */

interface Row {
  id: string
  code: string
  name: string
  tracked: boolean
  billing_item_variations: { id: string; name: string; sort_order: number }[]
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_items')
      .select('id, code, name, tracked, billing_item_variations(id, name, sort_order)')
      .eq('is_active', true)
      .eq('rentable', true)
      .order('code')
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown as Row[]
    return NextResponse.json({
      success: true,
      data: rows.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        tracked: i.tracked,
        variations: (i.billing_item_variations ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((v) => ({ id: v.id, name: v.name })),
      })),
    })
  } catch (err) {
    return billingApiError(err)
  }
}
