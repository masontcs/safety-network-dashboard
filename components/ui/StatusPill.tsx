type Status = 'paid' | 'pending' | 'overdue'

const STYLES: Record<Status, React.CSSProperties> = {
  paid:    { background: 'var(--pill-paid-bg)',    color: 'var(--pill-paid-fg)' },
  pending: { background: 'var(--pill-pending-bg)', color: 'var(--pill-pending-fg)' },
  overdue: { background: 'var(--pill-overdue-bg)', color: 'var(--pill-overdue-fg)' },
}

export default function StatusPill({ status }: { status: Status }) {
  return (
    <span style={{ ...STYLES[status], padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500 }}>
      {status}
    </span>
  )
}
