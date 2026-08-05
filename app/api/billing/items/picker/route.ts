import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Lightweight item picker for ticket entry: active items with the fields the
 * Equipment ledger and Sale lines need (tracked flag, salable + sale price,
 * and each item's variations).
 */

interface Row {
  id: string
  code: string
  name: string
  category: string
  tracked: boolean
  rentable: boolean
  salable: boolean
  sale_price_cents: number | null
  owner_profile_id: string | null
  billing_item_variations: { id: string; name: string; sort_order: number }[]
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_items')
      .select('id, code, name, category, tracked, rentable, salable, sale_price_cents, owner_profile_id, billing_item_variations(id, name, sort_order)')
      .eq('is_active', true)
      .order('code')
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown as Row[]
    return NextResponse.json({
      success: true,
      data: rows.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        category: i.category,
        tracked: i.tracked,
        rentable: i.rentable,
        salable: i.salable,
        salePriceCents: i.sale_price_cents,
        ownerProfileId: i.owner_profile_id,
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
