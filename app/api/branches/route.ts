import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('branches')
      .select('id, name, is_revenue_generating, is_corporate, is_active')
      .eq('is_active', true)
      .order('name')

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch (err) {
    return apiError(err)
  }
}
