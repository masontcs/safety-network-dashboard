import type { ReactNode } from 'react'

interface MetricCardProps {
  label: string
  sub?: string
  value: string
  delta?: string
  deltaType?: 'up' | 'down'
  progress?: number
  progressLabel?: string
  icon?: ReactNode
  chart?: ReactNode
  variant?: 'hero' | 'default'
}

export default function MetricCard({
  label,
  sub,
  value,
  delta,
  deltaType,
  progress,
  progressLabel,
  icon,
  chart,
  variant = 'default',
}: MetricCardProps) {
  const isHero = variant === 'hero'

  return (
    <div
      style={{
        background: isHero ? '#ff6b00' : 'var(--bg-surface)',
        borderRadius: 12,
        border: isHero ? 'none' : '1px solid var(--border)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div
            style={{
              fontSize: 11,
              color: isHero ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontWeight: 400,
            }}
          >
            {label}
          </div>
          {sub && (
            <div style={{ fontSize: 11, color: isHero ? 'rgba(255,255,255,0.65)' : 'var(--text-dim)' }}>
              {sub}
            </div>
          )}
        </div>
        {icon && (
          <div
            style={{
              width: 36,
              height: 36,
              background: isHero ? 'rgba(255,255,255,0.2)' : 'var(--bg-secondary)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: isHero ? 28 : 26,
          fontWeight: 500,
          color: isHero ? '#ffffff' : 'var(--text-primary)',
          lineHeight: 1.1,
          marginTop: 8,
        }}
      >
        {value}
      </div>

      {delta && (
        <div
          style={{
            fontSize: 11,
            color: isHero
              ? 'rgba(255,255,255,0.9)'
              : deltaType === 'up'
              ? '#ff6b00'
              : '#cc4444',
            marginTop: 2,
          }}
        >
          {delta}
        </div>
      )}

      {progress !== undefined && (
        <>
          <div
            style={{
              height: 4,
              background: isHero ? 'rgba(255,255,255,0.3)' : 'var(--bg-secondary)',
              borderRadius: 2,
              marginTop: 8,
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, progress))}%`,
                height: '100%',
                background: isHero ? 'rgba(255,255,255,0.9)' : '#ff6b00',
                borderRadius: 2,
              }}
            />
          </div>
          {progressLabel && (
            <div
              style={{
                fontSize: 11,
                color: isHero ? 'rgba(255,255,255,0.65)' : 'var(--text-dim)',
                marginTop: 4,
              }}
            >
              {progressLabel}
            </div>
          )}
        </>
      )}

      {chart && <div style={{ marginTop: 12, flex: 1 }}>{chart}</div>}
    </div>
  )
}
