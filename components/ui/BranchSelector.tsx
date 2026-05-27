'use client'

interface Branch {
  id: string
  name: string
}

interface BranchSelectorProps {
  branches: Branch[]
  value: string
  onChange: (branchId: string) => void
}

export default function BranchSelector({ branches, value, onChange }: BranchSelectorProps) {
  if (branches.length <= 1) {
    const branch = branches[0]
    return (
      <span className="branch-name" style={{ fontSize: 13, fontWeight: 500 }}>
        {branch?.name ?? ''}
      </span>
    )
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-emphasis)',
        borderRadius: 8,
        padding: '5px 12px',
        fontSize: 13,
        color: '#ff6b00',
        fontFamily: 'inherit',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          {b.name}
        </option>
      ))}
    </select>
  )
}
