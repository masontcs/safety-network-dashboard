import { NextResponse } from 'next/server'
import { getPortalContext } from '@/lib/api/portal'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Open jobs for the customer's opted-in profiles (everything not completed/closed),
 * with a live on-rent unit count so they can see what equipment is still out.
 */
export async function GET(): Promise<NextResponse> {
  const res = await getPortalContext()
  if (!res.ok) return res.response
  const { ctx } = res
  if (ctx.profileIds.length === 0) return NextResponse.json({ success: true, data: [] })

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('billing_jobs')
    .select('id, job_number, name, status, date_opened, profile_id, city, state')
    .in('profile_id', ctx.profileIds)
    .in('status', ['new', 'in_progress', 'on_hold'])
    .order('date_opened', { ascending: false })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  const jobs = (data ?? []) as {
    id: string; job_number: string; name: string | null; status: string
    date_opened: string; profile_id: string; city: string | null; state: string | null
  }[]

  // On-rent units per job from the equipment ledger (pickup +, return/lost −).
  const onRentByJob = new Map<string, number>()
  if (jobs.length) {
    const { data: ledger } = await svc
      .from('billing_ticket_ledger')
      .select('job_id, event_type, qty')
      .in('job_id', jobs.map((j) => j.id))
    for (const l of (ledger ?? []) as { job_id: string; event_type: string; qty: number }[]) {
      const sign = l.event_type === 'pickup' ? 1 : -1
      onRentByJob.set(l.job_id, (onRentByJob.get(l.job_id) ?? 0) + sign * (l.qty ?? 0))
    }
  }

  return NextResponse.json({
    success: true,
    data: jobs.map((j) => ({
      id: j.id, jobNumber: j.job_number, name: j.name, status: j.status,
      dateOpened: j.date_opened,
      location: [j.city, j.state].filter(Boolean).join(', ') || null,
      onRentUnits: Math.max(0, onRentByJob.get(j.id) ?? 0),
    })),
  })
}
