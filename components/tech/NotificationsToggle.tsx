'use client'

import { useEffect, useState } from 'react'

/**
 * Turn web-push notifications on/off for this device. Simple toggle: asks permission, subscribes
 * via the service worker, and stores the subscription. On iPhones, push only works once the app is
 * added to the Home Screen (iOS 16.4+), so when the browser can't support it we show that hint
 * instead of a dead button.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

type State = 'loading' | 'on' | 'off' | 'denied' | 'unsupported'

export default function NotificationsToggle() {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!supported) { setState('unsupported'); return }
    if (Notification.permission === 'denied') { setState('denied'); return }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : 'off'))
      .catch(() => setState('off'))
  }, [])

  async function enable() {
    setBusy(true); setHint(null)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return }
      const reg = await navigator.serviceWorker.ready
      const cfg = await fetch('/api/tech/push/config').then((r) => r.json()).catch(() => null)
      if (!cfg?.success) { setHint('Notifications aren’t set up yet — try again later.'); return }
      const appServerKey = urlBase64ToUint8Array(cfg.data.publicKey) as unknown as BufferSource
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey })
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      const res = await fetch('/api/tech/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) }).then((r) => r.json())
      if (!res.success) { setHint('Could not save notifications — try again.'); return }
      setState('on')
    } catch { setHint('Could not turn on notifications on this device.') }
    finally { setBusy(false) }
  }

  async function disable() {
    setBusy(true); setHint(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch(`/api/tech/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setState('off')
    } catch { /* ignore */ } finally { setBusy(false) }
  }

  // Once notifications are on, the prompt disappears entirely — nothing to show.
  if (state === 'loading' || state === 'on') return null

  // Slim single-line bar shared by every remaining state.
  const bar: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 10px', borderRadius: 9,
    border: '1px solid var(--tech-line, #2a2f38)', background: 'var(--tech-surface, #1a1f27)',
    marginBottom: 10, fontSize: 12.5,
  }
  const text: React.CSSProperties = { flex: 1, minWidth: 0, color: 'var(--tech-dim, #93a0b4)', overflow: 'hidden', textOverflow: 'ellipsis' }

  if (state === 'unsupported') {
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    return (
      <div style={bar}>
        <span aria-hidden>🔔</span>
        <span style={text}>{iOS ? 'Add to Home Screen to get shift alerts' : 'Notifications aren’t supported on this browser'}</span>
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div style={bar}>
        <span aria-hidden>🔕</span>
        <span style={text}>Notifications blocked — enable them in your device settings</span>
      </div>
    )
  }

  // off
  return (
    <div style={bar}>
      <span aria-hidden>🔔</span>
      <span style={text}>{hint ?? 'Get alerted when you’re scheduled'}</span>
      <button onClick={enable} disabled={busy} className="tech-btn accent sm" style={{ fontSize: 12.5, padding: '4px 12px' }}>{busy ? '…' : 'Enable'}</button>
    </div>
  )
}
