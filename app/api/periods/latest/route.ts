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
      .from('revenue_transactions')
      .select('period_date')
      .order('period_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(`Failed to query latest period: ${error.message}`)

    return NextResponse.json({
      success: true,
      data: { periodDate: data?.period_date ?? null },
    })
  } catch (err) {
    return apiError(err)
  }
}
