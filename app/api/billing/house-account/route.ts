import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * House Account pricing settings — the single price list + tier every walk-in (house-account)
 * profile is configured to. Read for any billing user (the walk-in flow needs it); only an admin
 * can change it, so front counter can't move walk-in pricing.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const { data: cfg } = await supabase.from('billing_house_account_config').select('price_list_id, tier_id').eq('id', true).maybeSingle()
    const { data: priceLists } = await supabase
      .from('billing_price_lists')
      .select('id, name, entity_id, billing_price_list_tiers(id, name, position)')
      .eq('is_active', true)
      .order('name')

    return NextResponse.json({
      success: true,
      data: {
        canManage: ctx.access.role === 'admin',
        priceListId: cfg?.price_list_id ?? null,
        tierId: cfg?.tier_id ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        priceLists: (priceLists ?? []).map((pl: any) => ({
          id: pl.id, name: pl.name, entityId: pl.entity_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tiers: (pl.billing_price_list_tiers ?? []).slice().sort((a: any, b: any) => a.position - b.position).map((t: any) => ({ id: t.id, name: t.name })),
        })),
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const adminGuard = guardAdminOnly(ctx.access.role)
    if (adminGuard) return adminGuard

    const body = (await request.json()) as { priceListId?: string; tierId?: string }
    if (!body.priceListId || !body.tierId) return bad('A price list and tier are required')

    const supabase = createServiceClient()
    // The tier must belong to the chosen price list.
    const { data: tier } = await supabase
      .from('billing_price_list_tiers')
      .select('id, price_list_id')
      .eq('id', body.tierId)
      .maybeSingle()
    if (!tier || tier.price_list_id !== body.priceListId) return bad('That tier does not belong to the selected price list.')

    const { error } = await supabase.from('billing_house_account_config')
      .update({ price_list_id: body.priceListId, tier_id: body.tierId, updated_at: new Date().toISOString() })
      .eq('id', true)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
