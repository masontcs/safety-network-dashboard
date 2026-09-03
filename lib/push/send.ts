import webpush from 'web-push'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Server-side web push. VAPID keys and subscriptions live in Supabase (push_config /
 * push_subscriptions), so this is self-contained — no env wiring needed. Runs on the Node
 * runtime only (web-push uses Node crypto); the routes that call it are all Node routes.
 *
 * Sends are best-effort and non-fatal: a failure never breaks the action that triggered it,
 * and subscriptions the push service reports as gone (404/410) are pruned.
 */

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

let vapidReady = false
async function ensureVapid(supabase: ReturnType<typeof createServiceClient>): Promise<boolean> {
  if (vapidReady) return true
  const { data } = await supabase.from('push_config').select('public_key, private_key, subject').eq('id', true).maybeSingle()
  const cfg = data as { public_key: string; private_key: string; subject: string } | null
  if (!cfg) return false
  webpush.setVapidDetails(cfg.subject, cfg.public_key, cfg.private_key)
  vapidReady = true
  return true
}

/** Send a notification to every device of the given users. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return
  try {
    const supabase = createServiceClient()
    if (!(await ensureVapid(supabase))) return
    const { data: subs } = await supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids)
    const rows = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]
    if (rows.length === 0) return

    const body = JSON.stringify(payload)
    const dead: string[] = []
    await Promise.all(rows.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 })
      } catch (e) {
        const status = (e && typeof e === 'object' && 'statusCode' in e) ? (e as { statusCode?: number }).statusCode : undefined
        if (status === 404 || status === 410) dead.push(s.id) // subscription gone — prune it
      }
    }))
    if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead)
  } catch { /* never let a push failure break the caller */ }
}

/** Map technician ids to their linked user accounts, then notify. */
export async function sendPushToTechnicians(technicianIds: string[], payload: PushPayload): Promise<void> {
  const ids = [...new Set(technicianIds.filter(Boolean))]
  if (ids.length === 0) return
  try {
    const supabase = createServiceClient()
    const { data } = await supabase.from('billing_technicians').select('user_id').in('id', ids)
    const userIds = ((data ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((u): u is string => !!u)
    await sendPushToUsers(userIds, payload)
  } catch { /* best-effort */ }
}
