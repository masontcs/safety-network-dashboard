import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Lightweight item picker for ticket entry: active items with the fields the
 * Equipment ledger and Sale lines need (tracked flag, salable + sale price,
 * and each item's variations).
 *
 * When called with the ticket's profileId + entityId, each item carries `onPriceList` — whether
 * it's actually priced on THIS job's price list. The ticket uses that to keep the list-priced
 * pickers (Equipment / Labor / Lump Sum) to items the profile is set up for, so you can't add a
 * line that has no rate. Without those params (e.g. quotes) nothing is scoped (onPriceList=true).
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

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const url = new URL(request.url)
    const profileId = url.searchParams.get('profileId')
    const entityId = url.searchParams.get('entityId')

    // Resolve which items are on this job's price list, when we're given the profile+entity.
    let priceListItemIds: Set<string> | null = null
    if (profileId && entityId) {
      const { data: pe } = await supabase
        .from('billing_profile_entities')
        .select('price_list_id')
        .eq('profile_id', profileId)
        .eq('entity_id', entityId)
        .maybeSingle()
      const priceListId = (pe as { price_list_id: string | null } | null)?.price_list_id ?? null
      priceListItemIds = new Set<string>()
      if (priceListId) {
        const { data: plis } = await supabase.from('billing_price_list_items').select('item_id').eq('price_list_id', priceListId)
        for (const p of (plis ?? []) as { item_id: string }[]) priceListItemIds.add(p.item_id)
      }
    }

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
        // Not scoped (no profile/entity) → true; scoped → whether it's on this job's list.
        onPriceList: priceListItemIds ? priceListItemIds.has(i.id) : true,
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
