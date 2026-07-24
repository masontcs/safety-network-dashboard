import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Field technicians. The tech-facing side of the system isn't built yet — for now
 * admins enter labor on their behalf, so this list exists mainly to exercise the
 * labor model. This data is disposable: tickets/jobs/techs get reset before launch.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // The pickers (dispatch, crew, labor) want only ACTIVE techs; the management screen
    // passes ?includeInactive=1 to see everyone and each one's active state.
    const includeInactive = new URL(request.url).searchParams.get('includeInactive') === '1'

    const supabase = createServiceClient()
    let q = supabase.from('billing_technicians').select('id, name, is_active').order('name')
    if (!includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      data: (data ?? []).map((t) => (includeInactive ? { id: t.id, name: t.name, isActive: t.is_active } : { id: t.id, name: t.name })),
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

    const body = (await request.json()) as { name?: string }
    const name = body.name?.trim()
    if (!name) return bad('A technician name is required')

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_technicians')
      .insert({ name })
      .select('id, name')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'Failed to add technician')

    return NextResponse.json({ success: true, data })
  } catch (err) {
    return billingApiError(err)
  }
}
