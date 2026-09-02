import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

const SCOPED_CATEGORIES = ['Labor', 'Lump Sum'] as const
type ScopedCategory = (typeof SCOPED_CATEGORIES)[number]

const bad = (error: string, code = 'VALIDATION_ERROR', status = 400) =>
  NextResponse.json({ success: false, error, code }, { status })

/**
 * Edit a profile-scoped custom item — name/code/category, the single rate, or the
 * per-variation prices (update existing, add new, remove unused). A variation already used
 * on a ticket can't be removed (its billing history references it) — rename it instead.
 */
export async function PATCH(request: Request, { params }: { params: { id: string; itemId: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard

    const body = (await request.json()) as {
      category?: string; name?: string; code?: string; ownRateCents?: number | null
      variations?: { id?: string; name?: string; ownRateCents?: number }[]
    }

    const supabase = createServiceClient()

    // Must exist AND belong to this profile — one profile can't edit another's item.
    const { data: item } = await supabase
      .from('billing_items')
      .select('id')
      .eq('id', params.itemId)
      .eq('owner_profile_id', params.id)
      .maybeSingle()
    if (!item) return bad('Item not found', 'NOT_FOUND', 404)

    // ── item fields ─────────────────────────────────────────────────────────
    const patch: { name?: string; code?: string; category?: ScopedCategory; own_rate_cents?: number | null } = {}
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return bad('A name is required.')
      patch.name = name
    }
    if (body.code !== undefined) {
      const code = body.code.trim().toUpperCase()
      if (!code) return bad('A code is required.')
      patch.code = code
    }
    if (body.category !== undefined) {
      if (!SCOPED_CATEGORIES.includes(body.category as ScopedCategory)) return bad('Category must be Labor or Lump Sum.')
      patch.category = body.category as ScopedCategory
    }

    const hasVariations = Array.isArray(body.variations) && body.variations.length > 0

    // Rate lives on the variations when there are any; otherwise on the item.
    if (hasVariations) {
      patch.own_rate_cents = null
    } else if (body.variations && body.variations.length === 0) {
      // Explicitly cleared variations → a single rate is required.
      if (!Number.isInteger(body.ownRateCents) || (body.ownRateCents as number) < 0) return bad('A price of zero or more is required.')
      patch.own_rate_cents = body.ownRateCents as number
    } else if (body.ownRateCents !== undefined) {
      if (body.ownRateCents !== null && (!Number.isInteger(body.ownRateCents) || body.ownRateCents < 0)) return bad('Price must be zero or more.')
      patch.own_rate_cents = body.ownRateCents
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('billing_items').update(patch).eq('id', params.itemId)
      if (error) {
        if (error.code === '23505' || error.message.includes('duplicate')) return bad(`Code "${patch.code}" is already used on this profile.`, 'CONFLICT', 409)
        throw new Error(error.message)
      }
    }

    // ── variations: reconcile (update / add / remove), never delete-all ───────
    if (body.variations) {
      const seen = new Set<string>()
      for (const v of body.variations) {
        const n = v.name?.trim()
        if (!n) return bad('Every variation needs a name.')
        if (seen.has(n.toLowerCase())) return bad(`Duplicate variation "${n}".`)
        seen.add(n.toLowerCase())
        if (!Number.isInteger(v.ownRateCents) || (v.ownRateCents as number) < 0) return bad(`"${n}" needs a price of zero or more.`)
      }

      const { data: current } = await supabase.from('billing_item_variations').select('id').eq('item_id', params.itemId)
      const keepIds = new Set(body.variations.filter((v) => v.id).map((v) => v.id as string))
      const toDelete = (current ?? []).map((c) => c.id).filter((id) => !keepIds.has(id))
      if (toDelete.length > 0) {
        const { error: dErr } = await supabase.from('billing_item_variations').delete().in('id', toDelete)
        if (dErr) return bad('A variation is already used on a ticket and can’t be removed — rename it instead.', 'CONFLICT', 409)
      }

      for (const [idx, v] of body.variations.entries()) {
        if (v.id) {
          const { error } = await supabase.from('billing_item_variations')
            .update({ name: v.name!.trim(), own_rate_cents: v.ownRateCents as number, sort_order: idx }).eq('id', v.id)
          if (error) throw new Error(error.message)
        } else {
          const { error } = await supabase.from('billing_item_variations')
            .insert({ item_id: params.itemId, name: v.name!.trim(), own_rate_cents: v.ownRateCents as number, sort_order: idx })
          if (error) throw new Error(error.message)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

/** Delete a profile-scoped custom item — blocked if it's already on a ticket line. */
export async function DELETE(_req: Request, { params }: { params: { id: string; itemId: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard

    const supabase = createServiceClient()

    // Scope the delete to THIS profile so one profile can't delete another's item.
    const { data: item } = await supabase
      .from('billing_items')
      .select('id')
      .eq('id', params.itemId)
      .eq('owner_profile_id', params.id)
      .maybeSingle()
    if (!item) return bad('Item not found', 'NOT_FOUND', 404)

    const { count } = await supabase
      .from('billing_ticket_lines')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', params.itemId)
    if ((count ?? 0) > 0) return bad('This item is already used on a ticket — it can’t be deleted.', 'CONFLICT', 409)

    const { error } = await supabase.from('billing_items').delete().eq('id', params.itemId).eq('owner_profile_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
