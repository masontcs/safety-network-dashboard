type Status = 'paid' | 'pending' | 'overdue'

const STYLES: Record<Status, React.CSSProperties> = {
  paid:    { background: '#1a3a1a', color: '#4caf50' },
  pending: { background: '#3a2a1a', color: '#ff9800' },
  overdue: { background: '#3a1a1a', color: '#cc4444' },
}

export default function StatusPill({ status }: { status: Status }) {
  return (
    <span style={{ ...STYLES[status], padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500 }}>
      {status}
    </span>
  )
}
