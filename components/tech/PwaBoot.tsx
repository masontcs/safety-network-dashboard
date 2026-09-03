'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker for the tech PWA so web-push can deliver notifications and the
 * app is installable. Renders nothing. Runs only under /tech (mounted from the tech layout),
 * which is served on the field subdomain, so it never registers on billing/dashboards.
 */
export default function PwaBoot() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => { /* SW unsupported / blocked — app still works, just no push */ })
  }, [])
  return null
}
