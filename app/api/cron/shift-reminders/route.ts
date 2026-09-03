import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendPushToTechnicians } from '@/lib/push/send'

/**
 * Morning-of reminder. Run once each morning by a Vercel cron; sends every tech who has work
 * today a "you're on the schedule" push. Protected by a secret (stored in push_config, since we
 * can't set Vercel env on this project) and idempotent per day via push_reminder_runs, so a
 * double invocation never double-notifies. web-push needs Node.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const supabase = createServiceClient()

    // Auth: the caller must present the shared secret.
    const key = new URL(request.url).searchParams.get('key')
    const { data: cfg } = await supabase.from('push_config').select('cron_secret').eq('id', true).maybeSingle()
    const secret = (cfg as { cron_secret: string | null } | null)?.cron_secret
    if (!secret || key !== secret) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    // "Today" in the yard's timezone (Pacific), as YYYY-MM-DD.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

    // Idempotency: first run of the day claims the date; a later run this day no-ops.
    const { data: existing } = await supabase.from('push_reminder_runs').select('run_date').eq('run_date', today).maybeSingle()
    if (existing) return NextResponse.json({ success: true, data: { skipped: 'already ran today' } })
    await supabase.from('push_reminder_runs').insert({ run_date: today })

    // Who has work today: crew on non-voided tickets dated today, plus yard shifts today.
    const techIds = new Set<string>()

    const { data: tks } = await supabase.from('billing_tickets').select('id').eq('ticket_date', today).eq('is_voided', false)
    const ticketIds = ((tks ?? []) as { id: string }[]).map((t) => t.id)
    if (ticketIds.length) {
      const { data: asg } = await supabase.from('billing_ticket_assignments').select('technician_id').in('ticket_id', ticketIds)
      for (const a of (asg ?? []) as { technician_id: string }[]) techIds.add(a.technician_id)
    }
    const { data: yard } = await supabase.from('billing_yard_shifts').select('technician_id').eq('shift_date', today)
    for (const y of (yard ?? []) as { technician_id: string }[]) techIds.add(y.technician_id)

    if (techIds.size > 0) {
      await sendPushToTechnicians([...techIds], {
        title: 'Today’s schedule',
        body: 'You’re on the schedule today. Tap to view your shifts.',
        url: '/tech',
        tag: `daily-${today}`,
      })
    }

    return NextResponse.json({ success: true, data: { date: today, notified: techIds.size } })
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
