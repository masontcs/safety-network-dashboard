'use client'

export interface SelectableBranch {
  id: string
  name: string
  is_revenue_generating: boolean
}

interface Props {
  branches: SelectableBranch[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  role?: string
}

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

export default function BranchMultiSelect({ branches, selectedIds, onChange, role }: Props) {
  const ops = branches.filter((b) => b.is_revenue_generating)
  const corp = branches.filter((b) => !b.is_revenue_generating)
  const selectedBranches = branches.filter((b) => selectedIds.includes(b.id))

  const checkboxStyle: React.CSSProperties = {
    accentColor: '#ff6b00',
    width: 13,
    height: 13,
    cursor: 'pointer',
    flexShrink: 0,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#cccccc',
    cursor: 'pointer',
    userSelect: 'none',
  }

  const groupLabelStyle: React.CSSProperties = {
    fontSize: 10,
    color: '#555555',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontWeight: 500,
    padding: '6px 10px 4px',
  }

  function renderGroup(items: SelectableBranch[]) {
    return items.map((b) => (
      <label
        key={b.id}
        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px', cursor: 'pointer' }}
      >
        <input
          type="checkbox"
          checked={selectedIds.includes(b.id)}
          onChange={() => onChange(toggle(selectedIds, b.id))}
          style={checkboxStyle}
        />
        <span style={labelStyle}>{b.name}</span>
      </label>
    ))
  }

  // Role-based hint
  let hint: { text: string; color: string } | null = null
  if (role === 'district_manager' && selectedIds.length < 2) {
    hint = { text: 'District managers should have multiple branches assigned.', color: '#ff9800' }
  } else if (role === 'branch_manager' && selectedIds.length > 1) {
    hint = { text: 'Branch managers typically have one branch. Are you sure?', color: '#ff9800' }
  }

  return (
    <div>
      {/* Checkbox list */}
      <div
        style={{
          background: '#1a1a1a',
          border: '1px solid #333333',
          borderRadius: 6,
          maxHeight: 180,
          overflowY: 'auto',
        }}
      >
        {ops.length > 0 && (
          <>
            <div style={groupLabelStyle}>— Operations —</div>
            {renderGroup(ops)}
          </>
        )}
        {corp.length > 0 && (
          <>
            <div style={{ ...groupLabelStyle, paddingTop: ops.length > 0 ? 8 : 6 }}>— Corporate —</div>
            {renderGroup(corp)}
          </>
        )}
      </div>

      {/* Selected pills */}
      {selectedBranches.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {selectedBranches.map((b) => (
            <span
              key={b.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#2a1500',
                border: '1px solid #ff6b00',
                borderRadius: 4,
                padding: '2px 6px 2px 8px',
                fontSize: 11,
                color: '#ff6b00',
              }}
            >
              {b.name}
              <button
                type="button"
                onClick={() => onChange(selectedIds.filter((id) => id !== b.id))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ff6b00',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 13,
                  lineHeight: 1,
                  fontFamily: 'inherit',
                }}
                aria-label={`Remove ${b.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Role hint */}
      {hint && (
        <div style={{ fontSize: 11, color: hint.color, marginTop: 6 }}>
          {hint.text}
        </div>
      )}
    </div>
  )
}
