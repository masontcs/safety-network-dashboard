import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Job types — the GLOBAL list the dispatch picker offers (multiselect per shift). Any billing
 * user may READ the active list (they dispatch); only the 'jobtypes' area (admin + Branch
 * Manager) may see the full list or create one. Shifts store job-type names, so this is a
 * managed vocabulary, not a foreign key.
 *
 *   GET            → active list [{id,name}] for the picker (any billing user)
 *   GET ?manage=1  → full list incl. inactive [{id,name,sortOrder,isActive}] (jobtypes area)
 *   POST           → create (jobtypes area)
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()
    const manage = new URL(request.url).searchParams.get('manage') === '1'

    if (manage) {
      const guard = guardBillingArea(ctx.access, 'jobtypes')
      if (guard) return guard
      const { data, error } = await supabase.from('billing_job_types')
        .select('id, name, sort_order, is_active').order('is_active', { ascending: false }).order('sort_order')
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true, data: (data ?? []).map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active })) })
    }

    const { data, error } = await supabase.from('billing_job_types')
      .select('id, name').eq('is_active', true).order('sort_order')
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, data: (data ?? []).map((r) => ({ id: r.id, name: r.name })) })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'jobtypes')
    if (guard) return guard
    const supabase = createServiceClient()

    const body = (await request.json()) as { name?: string }
    const name = body.name?.trim()
    if (!name) return bad('A name is required')

    const { data: dupe } = await supabase.from('billing_job_types').select('id').ilike('name', name).eq('is_active', true).maybeSingle()
    if (dupe) return bad(`"${name}" already exists`, 'CONFLICT', 409)

    // Append to the end of the current order.
    const { data: last } = await supabase.from('billing_job_types').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
    const nextSort = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1

    const { data, error } = await supabase.from('billing_job_types').insert({ name, sort_order: nextSort }).select('id').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, data: { id: (data as { id: string }).id } }, { status: 201 })
  } catch (err) {
    return billingApiError(err)
  }
}
