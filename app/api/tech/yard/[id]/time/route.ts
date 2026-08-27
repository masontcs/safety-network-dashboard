import { NextResponse } from 'next/server'
import { getTechContext, techBad } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { timeToMinutes, minutesToTime, roundToQuarter, segmentMinutes } from '@/lib/billing/labor'

/**
 * Yard time — a tech logging hours against their yard shift (no ticket). Same time model as
 * ticket labor (round to the quarter, derive duration; end < start = crossed midnight), but
 * this never touches billing. A tech may only touch their OWN yard shift.
 */

function normalise(start?: string, end?: string): { start: string; end: string } | string {
  if (!start || !end) return 'A start and end time are required'
  const s0 = timeToMinutes(start), e0 = timeToMinutes(end)
  if (Number.isNaN(s0) || Number.isNaN(e0)) return 'Times must be valid (HH:MM)'
  const s = roundToQuarter(s0), e = roundToQuarter(e0)
  if (s === e) return 'Start and end round to the same quarter hour — that segment has no length.'
  if (segmentMinutes(s, e) <= 0) return 'That segment has no length.'
  return { start: minutesToTime(s), end: minutesToTime(e) }
}

type SB = ReturnType<typeof createServiceClient>
async function loadMyShift(supabase: SB, id: string, technicianId: string) {
  const { data } = await supabase
    .from('billing_yard_shifts')
    .select('id')
    .eq('id', id)
    .eq('technician_id', technicianId) // positive check: only my own yard shift
    .maybeSingle()
  return data
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const shift = await loadMyShift(supabase, params.id, ctx.tech.technicianId)
    if (!shift) return techBad('Yard shift not found', 'NOT_FOUND', 404)

    const body = (await request.json()) as { activityTypeId?: string; startTime?: string; endTime?: string; notes?: string; workDate?: string }
    if (!body.activityTypeId) return techBad('An activity is required')
    if (body.workDate !== undefined && body.workDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.workDate)) return techBad('Date must be YYYY-MM-DD')
    const norm = normalise(body.startTime, body.endTime)
    if (typeof norm === 'string') return techBad(norm)

    const { error } = await supabase.from('billing_yard_time').insert({
      yard_shift_id: params.id,
      technician_id: ctx.tech.technicianId,
      activity_type_id: body.activityTypeId,
      start_time: norm.start,
      end_time: norm.end,
      work_date: body.workDate || null,
      notes: body.notes?.trim() || null,
      entered_by: ctx.tech.userId,
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const shift = await loadMyShift(supabase, params.id, ctx.tech.technicianId)
    if (!shift) return techBad('Yard shift not found', 'NOT_FOUND', 404)

    const entryId = new URL(request.url).searchParams.get('entryId')
    if (!entryId) return techBad('entryId is required')

    const { error } = await supabase
      .from('billing_yard_time')
      .delete()
      .eq('id', entryId)
      .eq('yard_shift_id', params.id)
      .eq('technician_id', ctx.tech.technicianId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
