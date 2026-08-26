/**
 * Realtime "something changed" pings, sent from the server after a write. These carry NO
 * data — a client that receives one refetches through the normal, guarded API. So the tech
 * app stays money-blind and no table is exposed to the browser; the ping is just a nudge.
 *
 * Best-effort by design: if the broadcast fails, nothing breaks — the client still updates
 * on its next fetch. We never let a failed ping fail the actual write.
 */
export async function broadcast(topic: string, event: string, payload: Record<string, unknown> = {}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic, event, payload }] }),
    })
  } catch {
    // swallow — a missed ping is harmless
  }
}

/**
 * Something in billing changed and open views should refetch: a dispatch/assignment, a
 * ticket create/edit/void, or an invoice generate/void. One shared channel keeps the
 * dispatch board, tickets list, invoices list, and the tech app all live off a single ping.
 * The ping still carries no data — every listener refetches through its own guarded API.
 */
export const broadcastBillingChanged = () => broadcast('billing', 'changed')

/** @deprecated use broadcastBillingChanged — kept as an alias so callers don't break. */
export const broadcastDispatchChanged = broadcastBillingChanged
