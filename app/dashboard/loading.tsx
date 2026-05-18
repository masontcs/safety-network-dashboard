export default function DashboardLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#111111' }}>
      {/* Top nav skeleton */}
      <div style={{ height: 48, background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 }}>
        <div className="skeleton" style={{ width: 120, height: 14, borderRadius: 4 }} />
        <div style={{ flex: 1 }} />
        <div className="skeleton" style={{ width: 80, height: 14, borderRadius: 4 }} />
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar skeleton — desktop only */}
        <div className="hidden md:flex" style={{ width: 48, background: '#1a1a1a', borderRight: '1px solid #2a2a2a', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 8 }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
          ))}
        </div>

        {/* Main content skeleton */}
        <main style={{ flex: 1, padding: 16, overflowY: 'auto', overflowX: 'hidden' }}>
          {/* Tab bar skeleton */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton" style={{ width: 80, height: 32, borderRadius: 8 }} />
            ))}
          </div>

          {/* Metric cards: 2-col on mobile, 4-col on desktop */}
          <div className="dash-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
                <div className="skeleton" style={{ width: '50%', height: 10, borderRadius: 4, marginBottom: 10 }} />
                <div className="skeleton" style={{ width: '75%', height: 24, borderRadius: 4 }} />
              </div>
            ))}
          </div>

          {/* Chart area skeleton */}
          <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16, marginBottom: 12 }}>
            <div className="skeleton" style={{ width: 120, height: 14, borderRadius: 4, marginBottom: 12 }} />
            <div className="skeleton" style={{ width: '100%', height: 180, borderRadius: 8 }} />
          </div>

          {/* Second metric row */}
          <div className="dash-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16 }}>
                <div className="skeleton" style={{ width: '50%', height: 10, borderRadius: 4, marginBottom: 10 }} />
                <div className="skeleton" style={{ width: '75%', height: 24, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
