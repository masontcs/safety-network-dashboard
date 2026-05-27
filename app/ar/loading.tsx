export default function ArLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Top nav skeleton */}
      <div style={{ height: 48, background: 'var(--bg-nav)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 }}>
        <div className="skeleton" style={{ width: 120, height: 14, borderRadius: 4 }} />
        <div style={{ flex: 1 }} />
        <div className="skeleton" style={{ width: 80, height: 14, borderRadius: 4 }} />
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar skeleton — desktop only */}
        <div className="hidden md:flex" style={{ width: 48, background: 'var(--bg-nav)', borderRight: '1px solid var(--border)', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 8 }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
          ))}
        </div>

        {/* Main content skeleton */}
        <main style={{ flex: 1, padding: 16, overflowY: 'auto', overflowX: 'hidden' }}>
          {/* Page header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="skeleton" style={{ width: 160, height: 22, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: 100, height: 32, borderRadius: 8 }} />
          </div>

          {/* Aging summary cards */}
          <div className="ar-aging-grid" style={{ marginBottom: 12 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
                <div className="skeleton" style={{ width: '60%', height: 10, borderRadius: 4, marginBottom: 10 }} />
                <div className="skeleton" style={{ width: '80%', height: 22, borderRadius: 4 }} />
              </div>
            ))}
          </div>

          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <div className="skeleton" style={{ width: 200, height: 36, borderRadius: 8 }} />
            <div className="skeleton" style={{ width: 120, height: 36, borderRadius: 8 }} />
            <div className="skeleton" style={{ width: 120, height: 36, borderRadius: 8 }} />
          </div>

          {/* Customer table skeleton */}
          <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', padding: 16 }}>
            {/* Table header */}
            <div style={{ display: 'flex', gap: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
              {[30, 12, 12, 12, 12, 10].map((w, i) => (
                <div key={i} className="skeleton" style={{ flex: w, height: 10, borderRadius: 4 }} />
              ))}
            </div>
            {/* Rows */}
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #1a1a1a' }}>
                {[30, 12, 12, 12, 12, 10].map((w, j) => (
                  <div key={j} className="skeleton" style={{ flex: w, height: 12, borderRadius: 4 }} />
                ))}
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
