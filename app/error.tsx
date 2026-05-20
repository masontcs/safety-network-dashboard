'use client'

import { useEffect } from 'react'

// Global error boundary — catches ChunkLoadError (stale deployment) and
// automatically reloads the page once so the new chunks are fetched.
// On non-chunk errors, shows a simple recovery UI.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // ChunkLoadError happens when the browser has a cached reference to a
    // webpack chunk that no longer exists after a new deployment.
    // A single hard reload fetches the new chunk manifest and recovers automatically.
    const isChunkError =
      error?.name === 'ChunkLoadError' ||
      error?.message?.includes('Loading chunk') ||
      error?.message?.includes('Failed to fetch dynamically imported module')

    if (isChunkError) {
      // Guard against an infinite reload loop
      const reloaded = sessionStorage.getItem('chunk-error-reload')
      if (!reloaded) {
        sessionStorage.setItem('chunk-error-reload', '1')
        window.location.reload()
      }
    }
  }, [error])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#111111',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ fontSize: 18, fontWeight: 500, color: '#ffffff' }}>Something went wrong</div>
      <div style={{ fontSize: 13, color: '#888888', maxWidth: 400, textAlign: 'center' }}>
        {error?.name === 'ChunkLoadError' || error?.message?.includes('Loading chunk')
          ? 'A new version of the app was deployed. Reloading to get the latest…'
          : 'An unexpected error occurred. Try refreshing the page.'}
      </div>
      <button
        onClick={() => {
          sessionStorage.removeItem('chunk-error-reload')
          reset()
        }}
        style={{
          marginTop: 8,
          background: '#ff6b00',
          border: 'none',
          borderRadius: 8,
          color: '#fff',
          padding: '8px 20px',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  )
}
