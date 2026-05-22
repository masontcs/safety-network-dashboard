import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOrExecutive } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOrExecutive(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const [allocRes, overrideRes] = await Promise.all([
      supabase
        .from('employee_allocations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('employee_allocation_overrides')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ])

    if (allocRes.error) throw new Error(allocRes.error.message)
    if (overrideRes.error) throw new Error(overrideRes.error.message)

    const count = (allocRes.count ?? 0) + (overrideRes.count ?? 0)

    return NextResponse.json({ success: true, data: { count } })
  } catch (err) {
    return apiError(err)
  }
}
