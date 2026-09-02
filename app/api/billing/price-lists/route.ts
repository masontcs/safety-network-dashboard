import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Price lists. Each list belongs to ONE entity (INC / STS / TCS) and holds an
 * ordered set of tiers. A billing profile picks a list per entity, plus a tier
 * per item category.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface ListRow {
  id: string
  name: string
  entity_id: string
  is_active: boolean
  updated_at: string
  entities: { code: string; name: string } | null
  billing_price_list_tiers: { id: string }[]
  billing_price_list_items: { id: string }[]
  billing_profile_entities: { id: string }[]
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_price_lists')
      .select(`
        id, name, entity_id, is_active, updated_at,
        entities(code, name),
        billing_price_list_tiers(id),
        billing_price_list_items(id),
        billing_profile_entities(id)
      `)
      .order('name')
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown as ListRow[]

    return NextResponse.json({
      success: true,
      data: rows.map((p) => ({
        id: p.id,
        name: p.name,
        entityId: p.entity_id,
        entityCode: p.entities?.code ?? '',
        isActive: p.is_active,
        updatedAt: p.updated_at,
        tierCount: (p.billing_price_list_tiers ?? []).length,
        itemCount: (p.billing_price_list_items ?? []).length,
        // A list used by a profile cannot be deleted (the DB enforces this).
        inUseByProfiles: (p.billing_profile_entities ?? []).length,
      })),
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // Billing roles are not defined yet — writes are admin-only until they are.
    const guard = guardBillingArea(ctx.access, 'pricelists')
    if (guard) return guard

    const body = (await request.json()) as {
      name?: string
      entityId?: string
      tiers?: { name: string; pctOffPrevious: number }[]
    }

    const name = body.name?.trim()
    if (!name) return bad('Price list name is required')
    if (!body.entityId) return bad('Entity is required')

    const tiers = body.tiers ?? [
      { name: 'T1', pctOffPrevious: 0 },
      { name: 'T2', pctOffPrevious: 10 },
      { name: 'T3', pctOffPrevious: 10 },
      { name: 'T4', pctOffPrevious: 5 },
    ]
    if (tiers.length === 0) return bad('A price list needs at least one tier')

    const seen = new Set<string>()
    for (const t of tiers) {
      const n = t.name?.trim()
      if (!n) return bad('Every tier needs a name')
      if (seen.has(n.toLowerCase())) return bad(`Duplicate tier name "${n}"`)
      seen.add(n.toLowerCase())
      if (!(t.pctOffPrevious >= 0 && t.pctOffPrevious < 100)) return bad('Tier % off must be between 0 and 100')
    }

    const supabase = createServiceClient()

    const { data: dup, error: dErr } = await supabase
      .from('billing_price_lists')
      .select('id')
      .eq('entity_id', body.entityId)
      .eq('name', name)
      .maybeSingle()
    if (dErr) throw new Error(dErr.message)
    if (dup) return bad(`That entity already has a price list named "${name}"`, 'CONFLICT', 409)

    const { data: created, error } = await supabase
      .from('billing_price_lists')
      .insert({ name, entity_id: body.entityId })
      .select('id, name')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create price list')

    const tierRows = tiers.map((t, i) => ({
      price_list_id: created.id,
      position: i + 1, // tiers[0] is the base tier; its % is ignored by the compiler
      name: t.name.trim(),
      pct_off_previous: i === 0 ? 0 : t.pctOffPrevious,
    }))
    const { error: tErr } = await supabase.from('billing_price_list_tiers').insert(tierRows)
    if (tErr) throw new Error(tErr.message)

    return NextResponse.json({ success: true, data: created })
  } catch (err) {
    return billingApiError(err)
  }
}
