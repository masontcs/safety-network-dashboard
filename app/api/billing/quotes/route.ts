import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { nextNumber } from '@/lib/billing/rpc'

/**
 * Quotes (bids) — list + create.
 *
 * A quote belongs to a PROFILE (which carries branch + terms). Its entity is the
 * profile's first enabled entity — a quote can't price against an entity the profile
 * doesn't bill. Create makes an empty draft; the builder fills it in.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface Row {
  id: string; quote_number: string; status: string; quote_date: string; job_name: string | null; total_cents: number; branch_id: string
  prospect_company: string | null
  billing_profiles: { name: string; billing_customers: { name: string } | null } | null
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const url = new URL(request.url)
    const profileId = url.searchParams.get('profileId')

    const supabase = createServiceClient()
    let q = supabase
      .from('billing_quotes')
      .select('id, quote_number, status, quote_date, job_name, total_cents, branch_id, prospect_company, billing_profiles(name, billing_customers(name))')
      .order('quote_date', { ascending: false })
    if (profileId) q = q.eq('profile_id', profileId)
    const reqBranch = url.searchParams.get('branchId') || ''
    let effBranchIds = ctx.access.branchIds
    if (reqBranch) effBranchIds = effBranchIds === null ? [reqBranch] : effBranchIds.filter((b) => b === reqBranch)
    if (effBranchIds !== null) {
      if (effBranchIds.length === 0) return NextResponse.json({ success: true, data: [] })
      q = q.in('branch_id', effBranchIds)
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as Row[]

    return NextResponse.json({
      success: true,
      data: rows.map((r) => {
        const isProspect = !r.billing_profiles && !!r.prospect_company
        return {
          id: r.id, quoteNumber: r.quote_number, status: r.status, quoteDate: r.quote_date,
          jobName: r.job_name, totalCents: r.total_cents,
          // A prospect quote has no profile yet — show the company as the customer.
          customer: r.billing_profiles?.billing_customers?.name ?? r.prospect_company ?? null,
          profile: r.billing_profiles?.name ?? (isProspect ? 'Prospect' : null),
          isProspect,
        }
      }),
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'quotes')
    if (guard) return guard

    const body = (await request.json()) as {
      profileId?: string; jobName?: string
      // prospect (not-yet-customer) path:
      prospect?: { company?: string; contactName?: string; contactEmail?: string; contactPhone?: string }
      priceListId?: string; tierId?: string; branchId?: string
    }
    const supabase = createServiceClient()

    // ── Existing-customer quote: prices against the profile's first enabled entity ──
    if (body.profileId) {
      const { data: profile, error: pErr } = await supabase
        .from('billing_profiles')
        .select('id, branch_id')
        .eq('id', body.profileId)
        .maybeSingle()
      if (pErr) throw new Error(pErr.message)
      if (!profile) return bad('Profile not found', 'NOT_FOUND', 404)
      if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(profile.branch_id)) {
        return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)
      }
      const { data: pe } = await supabase
        .from('billing_profile_entities')
        .select('entity_id')
        .eq('profile_id', body.profileId)
        .eq('enabled', true)
        .limit(1)
        .maybeSingle()
      if (!pe) return bad('This profile has no enabled entity yet — configure its pricing before quoting.')

      const quoteNumber = await nextNumber(supabase, 'bid', pe.entity_id, profile.branch_id)
      const { data: created, error } = await supabase
        .from('billing_quotes')
        .insert({
          quote_number: quoteNumber, profile_id: body.profileId, entity_id: pe.entity_id,
          branch_id: profile.branch_id, status: 'draft', job_name: body.jobName?.trim() || null,
          created_by: ctx.access.userId ?? null,
        })
        .select('id, quote_number')
        .single()
      if (error || !created) throw new Error(error?.message ?? 'Failed to create the quote')
      return NextResponse.json({ success: true, data: { id: created.id, quoteNumber: created.quote_number } })
    }

    // ── Prospect quote: a company not in the system. Prices against a chosen price list + tier;
    //    the entity comes from that list. On "won" it becomes a real customer + profile. ──
    const company = body.prospect?.company?.trim()
    if (!company) return bad('A billing profile OR a prospect company name is required')
    if (!body.priceListId || !body.tierId) return bad('Pick a price list and tier to price the prospect quote')
    if (!body.branchId) return bad('Pick a branch for the prospect quote')
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(body.branchId)) {
      return bad('You do not have access to that branch.', 'FORBIDDEN', 403)
    }
    const { data: pl } = await supabase.from('billing_price_lists').select('id, entity_id').eq('id', body.priceListId).maybeSingle()
    if (!pl?.entity_id) return bad('That price list was not found.', 'NOT_FOUND', 404)
    const { data: tier } = await supabase.from('billing_price_list_tiers').select('id').eq('id', body.tierId).eq('price_list_id', body.priceListId).maybeSingle()
    if (!tier) return bad('That tier doesn’t belong to the chosen price list.')

    const quoteNumber = await nextNumber(supabase, 'bid', pl.entity_id, body.branchId)
    const { data: created, error } = await supabase
      .from('billing_quotes')
      .insert({
        quote_number: quoteNumber, profile_id: null, entity_id: pl.entity_id, branch_id: body.branchId,
        status: 'draft', job_name: body.jobName?.trim() || null,
        prospect_company: company,
        prospect_contact_name: body.prospect?.contactName?.trim() || null,
        prospect_contact_email: body.prospect?.contactEmail?.trim() || null,
        prospect_contact_phone: body.prospect?.contactPhone?.trim() || null,
        prospect_price_list_id: pl.id, prospect_tier_id: tier.id,
        created_by: ctx.access.userId ?? null,
      })
      .select('id, quote_number')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create the quote')
    return NextResponse.json({ success: true, data: { id: created.id, quoteNumber: created.quote_number } })
  } catch (err) {
    return billingApiError(err)
  }
}
