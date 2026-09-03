/* Safety Network Field — service worker (web push for the tech PWA).
   Handles incoming push messages and notification taps. No offline caching yet; a no-op fetch
   handler is present only so the app meets the installable criteria. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Present so browsers consider the app installable; we don't intercept requests.
self.addEventListener('fetch', () => {})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_e) { data = {} }
  const title = data.title || 'Safety Network'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,      // same tag collapses/replaces an earlier notification
    renotify: !!data.tag,
    data: { url: data.url || '/tech' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/tech'
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of wins) {
      if (c.url.includes('/tech')) { await c.focus(); if ('navigate' in c) { try { await c.navigate(url) } catch (_e) {} } return }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url)
  })())
})
