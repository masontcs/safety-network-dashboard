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

/** Dispatch board / tech assignments changed (dispatched, reassigned, yard, etc.). */
export const broadcastDispatchChanged = () => broadcast('dispatch', 'changed')
