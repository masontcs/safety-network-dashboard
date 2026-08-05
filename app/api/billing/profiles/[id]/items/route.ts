import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Custom items that belong to ONE billing profile — negotiated Lump Sum / Labor lines made
 * just for that contract. They carry their own price (per variation, or a single rate when
 * they have no variations) and never appear on any other profile's tickets.
 *
 * Global catalog items live in /api/billing/items; this endpoint is only the scoped ones.
 */

const SCOPED_CATEGORIES = ['Labor', 'Lump Sum'] as const
type ScopedCategory = (typeof SCOPED_CATEGORIES)[number]

const bad = (error: string, code = 'VALIDATION_ERROR', status = 400) =>
  NextResponse.json({ success: false, error, code }, { status })

interface Row {
  id: string; code: string; name: string; category: string; own_rate_cents: number | null
  billing_item_variations: { id: string; name: string; own_rate_cents: number | null; sort_order: number }[]
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_items')
      .select('id, code, name, category, own_rate_cents, billing_item_variations(id, name, own_rate_cents, sort_order)')
      .eq('owner_profile_id', params.id)
      .order('code')
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      data: ((data ?? []) as unknown as Row[]).map((i) => ({
        id: i.id, code: i.code, name: i.name, category: i.category, ownRateCents: i.own_rate_cents,
        variations: (i.billing_item_variations ?? [])
          .slice().sort((a, b) => a.sort_order - b.sort_order)
          .map((v) => ({ id: v.id, name: v.name, ownRateCents: v.own_rate_cents })),
      })),
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as {
      category?: string; name?: string; code?: string; ownRateCents?: number | null
      variations?: { name?: string; ownRateCents?: number }[]
    }
    const category = body.category as ScopedCategory | undefined
    if (!category || !SCOPED_CATEGORIES.includes(category)) return bad('Category must be Labor or Lump Sum.')
    const name = body.name?.trim()
    const code = body.code?.trim().toUpperCase()
    if (!name) return bad('A name is required.')
    if (!code) return bad('A code is required.')

    const variations = body.variations ?? []
    let ownRateCents: number | null = null
    const cleanVars: { name: string; own_rate_cents: number; sort_order: number }[] = []

    if (variations.length > 0) {
      // Each variation sets its OWN full price (design "B"); the item itself has no rate.
      const seen = new Set<string>()
      variations.forEach((v, idx) => {
        const vn = v.name?.trim()
        if (!vn) throw new Error('Every variation needs a name.')
        if (seen.has(vn.toLowerCase())) throw new Error(`Duplicate variation "${vn}".`)
        seen.add(vn.toLowerCase())
        if (!Number.isInteger(v.ownRateCents) || (v.ownRateCents as number) < 0) throw new Error(`"${vn}" needs a price of zero or more.`)
        cleanVars.push({ name: vn, own_rate_cents: v.ownRateCents as number, sort_order: idx })
      })
    } else {
      // No variations → a single negotiated rate on the item.
      if (!Number.isInteger(body.ownRateCents) || (body.ownRateCents as number) < 0) return bad('A price of zero or more is required.')
      ownRateCents = body.ownRateCents as number
    }

    const supabase = createServiceClient()

    // Make sure the profile exists before hanging items off it.
    const { data: profile } = await supabase.from('billing_profiles').select('id').eq('id', params.id).maybeSingle()
    if (!profile) return bad('Profile not found.', 'NOT_FOUND', 404)

    const { data: item, error: iErr } = await supabase
      .from('billing_items')
      // Charge items (Labor / Lump Sum) are never goods — billing_items_charge_flags_chk
      // requires all four flags false, so set them explicitly (rentable defaults true).
      .insert({ code, name, category, owner_profile_id: params.id, own_rate_cents: ownRateCents, is_active: true, rentable: false, salable: false, tracked: false, taxable: false })
      .select('id')
      .single()
    if (iErr) {
      if (iErr.message.includes('duplicate') || iErr.code === '23505') return bad(`Code "${code}" is already used on this profile.`, 'CONFLICT', 409)
      throw new Error(iErr.message)
    }

    if (cleanVars.length > 0) {
      const { error: vErr } = await supabase
        .from('billing_item_variations')
        .insert(cleanVars.map((v) => ({ item_id: item.id, name: v.name, own_rate_cents: v.own_rate_cents, sort_order: v.sort_order })))
      if (vErr) {
        await supabase.from('billing_items').delete().eq('id', item.id) // don't leave a half-built item
        throw new Error(vErr.message)
      }
    }

    return NextResponse.json({ success: true, data: { id: item.id } }, { status: 201 })
  } catch (err) {
    return billingApiError(err)
  }
}
