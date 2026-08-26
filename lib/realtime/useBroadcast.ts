'use client'

import { useEffect, useRef } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Subscribe to a realtime broadcast channel and run `onEvent` when a ping arrives. The ping
 * carries no data — the handler refetches through the normal API. Subscribes once per
 * topic/event; the latest handler is always used (kept in a ref) so callers don't need to
 * memoize. Best-effort: if realtime is unavailable, nothing breaks.
 */
export function useBroadcast(topic: string, event: string, onEvent: () => void): void {
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => {
    const supabase = createBrowserClient()
    const channel = supabase
      .channel(topic)
      .on('broadcast', { event }, () => cb.current())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [topic, event])
}
