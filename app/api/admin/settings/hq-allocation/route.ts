import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('businesses')
      .select('code, name, hq_allocation_pct')
      .in('code', ['SN', 'WH', 'SIGNS'])

    if (error) throw new Error(error.message)

    const row = (code: string) => data?.find((b) => b.code === code)

    return NextResponse.json({
      success: true,
      data: {
        safetyNetwork: row('SN')?.hq_allocation_pct ?? 0,
        westernHighways: row('WH')?.hq_allocation_pct ?? 0,
        signs: row('SIGNS')?.hq_allocation_pct ?? 0,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as { safetyNetwork?: number; westernHighways?: number; signs?: number }
    const { safetyNetwork, westernHighways, signs } = body

    if (
      typeof safetyNetwork !== 'number' ||
      typeof westernHighways !== 'number' ||
      typeof signs !== 'number'
    ) {
      return NextResponse.json(
        { success: false, error: 'safetyNetwork, westernHighways, and signs are required numbers', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const total = Math.round((safetyNetwork + westernHighways + signs) * 10000) / 10000
    if (Math.abs(total - 1.0) > 0.0001) {
      return NextResponse.json(
        { success: false, error: `Percentages must sum to 100% (got ${(total * 100).toFixed(4)}%)`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    const updates = [
      supabase.from('businesses').update({ hq_allocation_pct: safetyNetwork }).eq('code', 'SN'),
      supabase.from('businesses').update({ hq_allocation_pct: westernHighways }).eq('code', 'WH'),
      supabase.from('businesses').update({ hq_allocation_pct: signs }).eq('code', 'SIGNS'),
    ]

    const results = await Promise.all(updates)
    for (const r of results) {
      if (r.error) throw new Error(r.error.message)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
