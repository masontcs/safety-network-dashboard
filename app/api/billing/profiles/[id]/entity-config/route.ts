import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import { getClientIp, logAudit } from '@/lib/audit/log'

/**
 * Billing profile x entity configuration.
 *
 * This is the entity the v1 prototype was missing. A billing profile enables
 * one or more entities (INC / STS / TCS); each ENABLED entity must select a
 * price list AND a tier per item category (the CategoryTierRule that pricing
 * resolves against). Without this row there is nowhere for a price-list
 * assignment to live -- which is exactly why the prototype's price list
 * appeared hardcoded and unchangeable.
 *
 * Scoping follows the existing codebase convention: service client + app-level
 * branch scoping (branchIds === null means full access). Database RLS is a
 * fail-closed second layer, not the primary check.
 */

const CATEGORIES = ['Equipment', 'Labor', 'Lump Sum', 'Misc'] as const
type Category = (typeof CATEGORIES)[number]

interface EntityConfigInput {
  entityId: string
  enabled: boolean
  priceListId: string | null
  tierByCategory: Partial<Record<Category, string>>
}

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

async function loadProfileScoped(supabase: ReturnType<typeof createServiceClient>, profileId: string, branchIds: string[] | null) {
  const { data: profile, error } = await supabase
    .from('billing_profiles')
    .select('id, name, code, branch_id, customer_id')
    .eq('id', profileId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!profile) return { profile: null, forbidden: false }
  if (branchIds !== null && !branchIds.includes(profile.branch_id)) {
    return { profile: null, forbidden: true }
  }
  return { profile, forbidden: false }
}

// ── GET — current config plus everything the picker needs ────────────────────
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { profile, forbidden } = await loadProfileScoped(supabase, params.id, ctx.access.branchIds)
    if (forbidden) return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)
    if (!profile) return bad('Billing profile not found', 'NOT_FOUND', 404)

    // Entities that are billing-enabled
    const { data: entities, error: eErr } = await supabase
      .from('billing_entity_settings')
      .select('entity_id, letter, billing_enabled, entities(id, code, name)')
      .eq('billing_enabled', true)
    if (eErr) throw new Error(eErr.message)

    // Price lists + their tiers, for the picker
    const { data: priceLists, error: plErr } = await supabase
      .from('billing_price_lists')
      .select('id, name, entity_id, is_active, billing_price_list_tiers(id, name, position)')
      .eq('is_active', true)
      .order('name')
    if (plErr) throw new Error(plErr.message)

    // Existing config
    const { data: config, error: cErr } = await supabase
      .from('billing_profile_entities')
      .select('id, entity_id, enabled, price_list_id, billing_profile_entity_category_tiers(category, tier_id)')
      .eq('profile_id', params.id)
    if (cErr) throw new Error(cErr.message)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configByEntity = new Map<string, any>((config ?? []).map((c: any) => [c.entity_id, c]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shaped = (entities ?? []).map((e: any) => {
      const c = configByEntity.get(e.entity_id)
      const tierByCategory: Record<string, string> = {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const t of c?.billing_profile_entity_category_tiers ?? []) tierByCategory[t.category] = t.tier_id
      return {
        entityId: e.entity_id,
        code: e.entities?.code ?? '',
        name: e.entities?.name ?? '',
        letter: e.letter,
        enabled: c?.enabled ?? false,
        priceListId: c?.price_list_id ?? null,
        tierByCategory,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        profile: { id: profile.id, name: profile.name, code: profile.code, branchId: profile.branch_id },
        categories: CATEGORIES,
        entities: shaped,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        priceLists: (priceLists ?? []).map((pl: any) => ({
          id: pl.id,
          name: pl.name,
          entityId: pl.entity_id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tiers: (pl.billing_price_list_tiers ?? []).sort((a: any, b: any) => a.position - b.position),
        })),
      },
    })
  } catch (err) {
    return apiError(err)
  }
}

// ── PUT — replace the whole config for this profile ──────────────────────────
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // Billing roles are not defined yet — writes are admin-only until they are.
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { profile, forbidden } = await loadProfileScoped(supabase, params.id, ctx.access.branchIds)
    if (forbidden) return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)
    if (!profile) return bad('Billing profile not found', 'NOT_FOUND', 404)

    const body = (await request.json()) as { entities?: EntityConfigInput[] }
    const inputs = body.entities
    if (!Array.isArray(inputs) || inputs.length === 0) return bad('`entities` is required')

    // ---- validate BEFORE writing anything -----------------------------------
    const { data: priceLists, error: plErr } = await supabase
      .from('billing_price_lists')
      .select('id, entity_id, billing_price_list_tiers(id)')
    if (plErr) throw new Error(plErr.message)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plById = new Map<string, any>((priceLists ?? []).map((p: any) => [p.id, p]))

    for (const inp of inputs) {
      if (!inp.enabled) continue

      if (!inp.priceListId) return bad(`An enabled entity must have a price list selected.`)
      const pl = plById.get(inp.priceListId)
      if (!pl) return bad(`Price list ${inp.priceListId} not found.`)
      if (pl.entity_id !== inp.entityId) {
        return bad('That price list belongs to a different entity.', 'CONFLICT', 409)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tierIds = new Set<string>((pl.billing_price_list_tiers ?? []).map((t: any) => t.id))
      for (const cat of CATEGORIES) {
        const tierId = inp.tierByCategory?.[cat]
        if (!tierId) return bad(`Missing tier for category "${cat}".`)
        if (!tierIds.has(tierId)) return bad(`Tier for "${cat}" does not belong to the selected price list.`)
      }
    }

    // ---- write --------------------------------------------------------------
    // Order matters: the category-tier rows carry a composite FK back to
    // (profile_entity_id, price_list_id). Delete children before changing the
    // parent's price_list_id, or the FK will reject the update.
    for (const inp of inputs) {
      const { data: existing, error: exErr } = await supabase
        .from('billing_profile_entities')
        .select('id')
        .eq('profile_id', params.id)
        .eq('entity_id', inp.entityId)
        .maybeSingle()
      if (exErr) throw new Error(exErr.message)

      let profileEntityId: string
      if (existing) {
        profileEntityId = existing.id
        const { error: delErr } = await supabase
          .from('billing_profile_entity_category_tiers')
          .delete()
          .eq('profile_entity_id', profileEntityId)
        if (delErr) throw new Error(delErr.message)

        const { error: updErr } = await supabase
          .from('billing_profile_entities')
          .update({ enabled: inp.enabled, price_list_id: inp.enabled ? inp.priceListId : null })
          .eq('id', profileEntityId)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { data: ins, error: insErr } = await supabase
          .from('billing_profile_entities')
          .insert({
            profile_id: params.id,
            entity_id: inp.entityId,
            enabled: inp.enabled,
            price_list_id: inp.enabled ? inp.priceListId : null,
          })
          .select('id')
          .single()
        if (insErr || !ins) throw new Error(insErr?.message ?? 'Failed to create entity config')
        profileEntityId = ins.id
      }

      if (inp.enabled && inp.priceListId) {
        // Hoist out of the closure so the `string | null` narrowing survives,
        // and re-assert the tier ids the validation pass above already proved.
        const priceListId = inp.priceListId
        const rows = CATEGORIES.map((cat) => {
          const tierId = inp.tierByCategory[cat]
          if (!tierId) throw new Error(`Missing tier for category "${cat}"`)
          return {
            profile_entity_id: profileEntityId,
            category: cat,
            price_list_id: priceListId,
            tier_id: tierId,
          }
        })
        const { error: tErr } = await supabase.from('billing_profile_entity_category_tiers').insert(rows)
        if (tErr) throw new Error(tErr.message)
      }
    }

    await logAudit({
      userId: ctx.access.userId,
      userDisplayName: ctx.access.displayName,
      userRole: ctx.access.role,
      action: 'billing.profile_entity_config.update',
      resourceType: 'billing_profile',
      resourceId: params.id,
      resourceLabel: profile.name,
      metadata: {
        entities: inputs.map((i) => ({
          entityId: i.entityId,
          enabled: i.enabled,
          priceListId: i.enabled ? i.priceListId : null,
        })),
      },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
