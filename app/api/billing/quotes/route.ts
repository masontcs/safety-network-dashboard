import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
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
      .select('id, quote_number, status, quote_date, job_name, total_cents, branch_id, billing_profiles(name, billing_customers(name))')
      .order('quote_date', { ascending: false })
    if (profileId) q = q.eq('profile_id', profileId)
    if (ctx.access.branchIds !== null) {
      if (ctx.access.branchIds.length === 0) return NextResponse.json({ success: true, data: [] })
      q = q.in('branch_id', ctx.access.branchIds)
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as Row[]

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id, quoteNumber: r.quote_number, status: r.status, quoteDate: r.quote_date,
        jobName: r.job_name, totalCents: r.total_cents,
        customer: r.billing_profiles?.billing_customers?.name ?? null,
        profile: r.billing_profiles?.name ?? null,
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
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as { profileId?: string; jobName?: string }
    if (!body.profileId) return bad('A billing profile is required')

    const supabase = createServiceClient()
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

    // The quote prices against the profile's first enabled entity.
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
        quote_number: quoteNumber,
        profile_id: body.profileId,
        entity_id: pe.entity_id,
        branch_id: profile.branch_id,
        status: 'draft',
        job_name: body.jobName?.trim() || null,
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
