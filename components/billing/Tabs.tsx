'use client'

/**
 * A minimal tab bar for the billing detail pages. Presentational only — the
 * parent owns which tab is active — so a page can key content off it however
 * it likes. The active tab carries the restrained orange accent (underline).
 */
export default function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: number | string }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
      {tabs.map((t) => {
        const on = t.id === active
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 14px', border: 0, background: 'transparent', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 600 : 500,
              color: on ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== 0 && (
              <span style={{
                fontSize: 10.5, fontWeight: 600, minWidth: 16, textAlign: 'center',
                padding: '1px 6px', borderRadius: 999,
                background: on ? 'var(--accent-soft-bg)' : 'var(--bg-tertiary)',
                color: on ? 'var(--accent)' : 'var(--text-muted)',
              }}>
                {t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
