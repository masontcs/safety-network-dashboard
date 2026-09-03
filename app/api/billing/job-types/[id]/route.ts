import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Edit or delete a job type — 'jobtypes' area (admin + Branch Manager).
 *   PATCH  → rename / reorder (sortOrder) / activate-deactivate
 *   DELETE → hard delete (job types aren't FK'd; shifts keep the name they saved)
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'jobtypes')
    if (guard) return guard
    const supabase = createServiceClient()

    const body = (await request.json()) as { name?: string; sortOrder?: number; isActive?: boolean }
    const patch: Database['public']['Tables']['billing_job_types']['Update'] = {}

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return bad('A name is required')
      const { data: dupe } = await supabase.from('billing_job_types').select('id').ilike('name', name).eq('is_active', true).neq('id', params.id).maybeSingle()
      if (dupe) return bad(`"${name}" already exists`, 'CONFLICT', 409)
      patch.name = name
    }
    if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder
    if (body.isActive !== undefined) patch.is_active = body.isActive
    if (Object.keys(patch).length === 0) return bad('Nothing to update')

    const { error } = await supabase.from('billing_job_types').update(patch).eq('id', params.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'jobtypes')
    if (guard) return guard
    const supabase = createServiceClient()

    const { error } = await supabase.from('billing_job_types').delete().eq('id', params.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
