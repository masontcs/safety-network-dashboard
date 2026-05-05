'use client'

import { useState, useEffect } from 'react'
import Skeleton from '@/components/ui/Skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmpAssignment {
  id: string
  rawName: string
  entityCode: string
  aiCandidateId: string | null
  aiCandidateName: string | null
  aiScore: number | null
}

interface PayrollItem {
  id: string
  name: string
  suggestedGroup: string | null
  confidence: number | null
  currentGroupId: string
}

interface FuelCard {
  id: string
  cardName: string
  vendor: string
  currentEmployeeId: string | null
  currentEmployeeName: string | null
  currentBranchId: string | null
  businessTag: string | null
}

interface Group { id: string; name: string }
interface Branch { id: string; name: string }

interface ReviewData {
  employeeAssignments: EmpAssignment[]
  payrollItems: PayrollItem[]
  fuelCards: FuelCard[]
  groups: Group[]
  branches: Branch[]
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>{title}</div>
      {count > 0 && (
        <span
          style={{
            background: '#ff6b00',
            color: '#ffffff',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 7px',
            lineHeight: '16px',
          }}
        >
          {count}
        </span>
      )}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyQueue({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '20px 0',
        fontSize: 12,
        color: '#555555',
        textAlign: 'center',
        borderTop: '1px solid #2a2a2a',
      }}
    >
      {message}
    </div>
  )
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({
  label,
  onClick,
  variant = 'secondary',
  disabled,
}: {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}) {
  const bg = variant === 'primary' ? '#ff6b00' : variant === 'danger' ? '#3a1a1a' : '#2a2a2a'
  const color = variant === 'primary' ? '#ffffff' : variant === 'danger' ? '#cc4444' : '#888888'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bg,
        border: 'none',
        borderRadius: 6,
        padding: '5px 12px',
        fontSize: 12,
        color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  )
}

// ─── Employee Matches section ──────────────────────────────────────────────────

function EmployeeMatchesSection({
  items,
  onDismiss,
}: {
  items: EmpAssignment[]
  onDismiss: (id: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  async function handleAction(item: EmpAssignment, action: 'confirm' | 'skip') {
    setBusy(item.id)
    try {
      const body: Record<string, unknown> = { action }
      if (action === 'confirm' && item.aiCandidateId) {
        body.employeeId = item.aiCandidateId
      }
      const res = await fetch(`/api/admin/review/employee-assignments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) onDismiss(item.id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card">
      <SectionHeader title="Employee Matches" count={items.length} />
      {items.length === 0 ? (
        <EmptyQueue message="No pending employee matches." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {items.map((item, i) => (
            <div
              key={item.id}
              style={{
                padding: '12px 0',
                borderTop: i === 0 ? '1px solid #2a2a2a' : '1px solid #2a2a2a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#cccccc' }}>
                  Import name:{' '}
                  <span style={{ color: '#ffffff', fontWeight: 500 }}>
                    &ldquo;{item.rawName}&rdquo;
                  </span>{' '}
                  <span style={{ color: '#555555' }}>({item.entityCode})</span>
                </div>
                {item.aiCandidateName ? (
                  <div style={{ fontSize: 12, color: '#888888', marginTop: 3 }}>
                    Suggested match:{' '}
                    <span style={{ color: '#ff6b00' }}>{item.aiCandidateName}</span>
                    {item.aiScore !== null && (
                      <span style={{ color: '#555555' }}>
                        {' '}[{Math.round(item.aiScore)}%]
                      </span>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#555555', marginTop: 3 }}>
                    No AI match suggestion
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {item.aiCandidateName && (
                  <ActionBtn
                    label="Confirm Match"
                    variant="primary"
                    disabled={busy === item.id}
                    onClick={() => handleAction(item, 'confirm')}
                  />
                )}
                <ActionBtn
                  label="Skip"
                  disabled={busy === item.id}
                  onClick={() => handleAction(item, 'skip')}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Unknown Payroll Items section ────────────────────────────────────────────

function PayrollItemsSection({
  items,
  groups,
  onDismiss,
}: {
  items: PayrollItem[]
  groups: Group[]
  onDismiss: (id: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({})

  async function handleConfirm(item: PayrollItem) {
    const groupId = selected[item.id] ?? item.currentGroupId
    if (!groupId) return
    setBusy(item.id)
    try {
      const res = await fetch(`/api/admin/review/payroll-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      })
      if (res.ok) onDismiss(item.id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card">
      <SectionHeader title="Unknown Payroll Items" count={items.length} />
      {items.length === 0 ? (
        <EmptyQueue message="No unconfirmed payroll items." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((item, i) => {
            const chosenGroupId = selected[item.id] ?? item.currentGroupId
            const suggestedGroup = groups.find((g) => g.name === item.suggestedGroup)
            return (
              <div
                key={item.id}
                style={{
                  padding: '12px 0',
                  borderTop: '1px solid #2a2a2a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#ffffff', fontWeight: 500 }}>
                    &ldquo;{item.name}&rdquo;
                  </div>
                  {item.suggestedGroup && (
                    <div style={{ fontSize: 12, color: '#888888', marginTop: 3 }}>
                      Suggested:{' '}
                      <span style={{ color: '#ff6b00' }}>{item.suggestedGroup}</span>
                      {item.confidence !== null && (
                        <span style={{ color: '#555555' }}>
                          {' '}[{Math.round(item.confidence)}%]
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <select
                    value={chosenGroupId}
                    onChange={(e) => setSelected((s) => ({ ...s, [item.id]: e.target.value }))}
                    style={{
                      background: '#2a2a2a',
                      border: '1px solid #333333',
                      borderRadius: 6,
                      padding: '4px 8px',
                      fontSize: 12,
                      color: '#cccccc',
                      fontFamily: 'inherit',
                    }}
                  >
                    <option value="">— select group —</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <ActionBtn
                    label="Confirm"
                    variant="primary"
                    disabled={busy === item.id || !chosenGroupId}
                    onClick={() => handleConfirm(item)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Unassigned Fuel Cards section ────────────────────────────────────────────

function FuelCardsSection({
  cards,
  branches,
  onDismiss,
}: {
  cards: FuelCard[]
  branches: Branch[]
  onDismiss: (id: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({})

  async function handleAssign(card: FuelCard) {
    const branchId = selected[card.id]
    if (!branchId) return
    setBusy(card.id)
    try {
      const res = await fetch(`/api/admin/review/fuel-cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId }),
      })
      if (res.ok) onDismiss(card.id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card">
      <SectionHeader title="Unassigned Fuel Cards" count={cards.length} />
      {cards.length === 0 ? (
        <EmptyQueue message="No unassigned fuel cards." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {cards.map((card) => (
            <div
              key={card.id}
              style={{
                padding: '12px 0',
                borderTop: '1px solid #2a2a2a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#ffffff', fontWeight: 500 }}>
                  &ldquo;{card.cardName}&rdquo;{' '}
                  <span style={{ color: '#555555', fontWeight: 400 }}>({card.vendor})</span>
                </div>
                {card.currentEmployeeName && (
                  <div style={{ fontSize: 12, color: '#888888', marginTop: 3 }}>
                    Linked employee:{' '}
                    <span style={{ color: '#ff6b00' }}>{card.currentEmployeeName}</span>
                  </div>
                )}
                {card.businessTag && (
                  <div style={{ fontSize: 11, color: '#555555', marginTop: 3 }}>
                    Tagged: {card.businessTag}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <select
                  value={selected[card.id] ?? ''}
                  onChange={(e) => setSelected((s) => ({ ...s, [card.id]: e.target.value }))}
                  style={{
                    background: '#2a2a2a',
                    border: '1px solid #333333',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 12,
                    color: '#cccccc',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="">— assign to branch —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <ActionBtn
                  label="Assign"
                  variant="primary"
                  disabled={busy === card.id || !selected[card.id]}
                  onClick={() => handleAssign(card)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function ReviewClient() {
  const [data, setData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/review')
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error)
        setData(json.data)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function dismiss(type: keyof ReviewData, id: string) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [type]: (prev[type] as { id: string }[]).filter((item) => item.id !== id),
      }
    })
  }

  const totalPending = data
    ? data.employeeAssignments.length + data.payrollItems.length + data.fuelCards.length
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Review Queue</div>
        <div style={{ fontSize: 12, color: '#666666', marginTop: 4 }}>
          {loading
            ? 'Loading…'
            : totalPending === 0
            ? 'All clear — nothing needs review.'
            : `${totalPending} item${totalPending === 1 ? '' : 's'} need your attention.`}
        </div>
      </div>

      {error && (
        <div style={{ color: '#cc4444', fontSize: 13 }}>Failed to load review queue: {error}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton height={120} borderRadius={12} />
          <Skeleton height={120} borderRadius={12} />
          <Skeleton height={120} borderRadius={12} />
        </div>
      ) : data ? (
        <>
          <EmployeeMatchesSection
            items={data.employeeAssignments}
            onDismiss={(id) => dismiss('employeeAssignments', id)}
          />
          <PayrollItemsSection
            items={data.payrollItems}
            groups={data.groups}
            onDismiss={(id) => dismiss('payrollItems', id)}
          />
          <FuelCardsSection
            cards={data.fuelCards}
            branches={data.branches}
            onDismiss={(id) => dismiss('fuelCards', id)}
          />
        </>
      ) : null}
    </div>
  )
}
