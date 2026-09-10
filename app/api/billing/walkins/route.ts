import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { nextNumber } from '@/lib/billing/rpc'
import { TIERED_CATEGORIES } from '@/lib/billing/constants'

/**
 * New walk-in — the front-counter one-step flow. Creates a billing profile under the House
 * Account (named for the walk-in), configures its entity pricing from the admin-set House Account
 * settings (price list + tier, so front counter never chooses pricing), and opens a job on it.
 * Returns the job so the caller can drop straight into adding a ticket.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    // Needs to create a job (and profile) — front counter, biller, branch manager, admin all have it.
    const guard = guardBillingArea(ctx.access, 'jobs')
    if (guard) return guard

    const body = (await request.json()) as { name?: string; branchId?: string }
    const name = body.name?.trim()
    if (!name) return bad('A walk-in name is required')

    const supabase = createServiceClient()

    // 1) The House Account customer must exist.
    const { data: house } = await supabase.from('billing_customers').select('id').eq('is_house_account', true).maybeSingle()
    if (!house) return bad('No House Account is set up yet. An admin must mark a customer as the House Account first.', 'CONFLICT', 409)

    // 2) House Account pricing must be configured (price list + tier).
    const { data: cfg } = await supabase.from('billing_house_account_config').select('price_list_id, tier_id').eq('id', true).maybeSingle()
    if (!cfg?.price_list_id || !cfg.tier_id) return bad('House Account pricing isn’t set up. An admin needs to choose the walk-in price list and tier first.', 'CONFLICT', 409)
    const { data: pl } = await supabase.from('billing_price_lists').select('id, entity_id').eq('id', cfg.price_list_id).maybeSingle()
    if (!pl?.entity_id) return bad('The House Account price list is misconfigured (no entity).', 'CONFLICT', 409)
    // That entity must be billing-enabled, or job numbers can't be generated for it.
    const { data: es } = await supabase.from('billing_entity_settings').select('billing_enabled').eq('entity_id', pl.entity_id).maybeSingle()
    if (!es?.billing_enabled) return bad('The House Account price list’s entity isn’t billing-enabled. An admin needs to enable it before walk-ins can be created.', 'CONFLICT', 409)

    // 3) Resolve the branch: explicit, else the user's own when unambiguous.
    let branchId = body.branchId || null
    if (!branchId && ctx.access.branchIds && ctx.access.branchIds.length === 1) branchId = ctx.access.branchIds[0]
    if (!branchId) return bad('Pick a branch for this walk-in.')
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(branchId)) return bad('You do not have access to that branch.', 'FORBIDDEN', 403)

    // 4) Create the walk-in profile under the House Account.
    const code = `WK${Date.now().toString(36).toUpperCase()}`
    const { data: profile, error: pErr } = await supabase
      .from('billing_profiles')
      .insert({ customer_id: house.id, branch_id: branchId, code, name, status: 'active', is_active: true })
      .select('id')
      .single()
    if (pErr || !profile) throw new Error(pErr?.message ?? 'Failed to create the walk-in profile')

    // 5) Configure the profile's entity at the House Account price list + tier (every tiered category).
    const { data: pe, error: peErr } = await supabase
      .from('billing_profile_entities')
      .insert({ profile_id: profile.id, entity_id: pl.entity_id, enabled: true, price_list_id: pl.id })
      .select('id')
      .single()
    if (peErr || !pe) throw new Error(peErr?.message ?? 'Failed to configure walk-in pricing')
    const tierId = cfg.tier_id // non-null (guarded above)
    const tierRows = TIERED_CATEGORIES.map((category) => ({
      profile_entity_id: pe.id, category, price_list_id: pl.id, tier_id: tierId,
    }))
    const { error: tErr } = await supabase.from('billing_profile_entity_category_tiers').insert(tierRows)
    if (tErr) throw new Error(tErr.message)

    // 6) Open a job on it.
    const jobNumber = await nextNumber(supabase, 'job', pl.entity_id, branchId)
    const { data: job, error: jErr } = await supabase
      .from('billing_jobs')
      .insert({ job_number: jobNumber, profile_id: profile.id, entity_id: pl.entity_id, branch_id: branchId, name, certified: false, prevailing_wage: false })
      .select('id, job_number')
      .single()
    if (jErr || !job) throw new Error(jErr?.message ?? 'Failed to open the walk-in job')

    return NextResponse.json({ success: true, data: { profileId: profile.id, jobId: job.id, jobNumber: job.job_number } })
  } catch (err) {
    return billingApiError(err)
  }
}
