'use client'

import { useState, useEffect, useRef } from 'react'
import Skeleton from '@/components/ui/Skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmpAssignment {
  id: string
  rawName: string
  entityCode: string
  currentPayrollCodeId: string | null
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

interface Branch {
  id: string
  name: string
  isCorporate: boolean
  isRevenueGenerating: boolean
  businessCode: string
}

interface PayrollCode {
  id: string
  code: string
  laborType: string
  branchId: string | null
  branchName: string
  entityCode: string
}

interface Employee {
  id: string
  displayName: string
  entityAssignments: Array<{ entityCode: string; branchId: string | null; branchName: string; laborType: string }>
}

interface PendingAllocation {
  id: string
  employee_id: string
  branch_id: string
  percentage: number
  effective_from: string
  effective_to: string | null
  status: string
  notes: string | null
  displayName: string
  branchName: string
}

interface PendingOverride {
  id: string
  employee_id: string
  period_date: string
  branch_id: string
  percentage: number
  status: string
  notes: string | null
  displayName: string
  branchName: string
}

interface ReviewData {
  employeeAssignments: EmpAssignment[]
  payrollItems: PayrollItem[]
  fuelCards: FuelCard[]
  groups: Group[]
  branches: Branch[]
  payrollCodes: PayrollCode[]
  employees: Employee[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtLaborType(lt: string): string {
  const map: Record<string, string> = {
    direct: 'Direct',
    admin_hourly: 'Admin Hr',
    admin_salary: 'Admin Sal',
    corp_hourly: 'Corp Hr',
    corp_salary: 'Corp Sal',
    hq_hourly: 'HQ Hr',
    hq_salary: 'HQ Sal',
  }
  return map[lt] ?? lt
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</div>
      {count > 0 && (
        <span
          style={{
            background: '#ff6b00',
            color: 'var(--text-primary)',
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
        color: 'var(--text-faint)',
        textAlign: 'center',
        borderTop: '1px solid var(--border)',
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
  const bg = variant === 'primary' ? '#ff6b00' : variant === 'danger' ? '#3a1a1a' : 'var(--bg-secondary)'
  const color = variant === 'primary' ? 'var(--text-primary)' : variant === 'danger' ? '#cc4444' : 'var(--text-muted)'
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

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  outline: 'none',
  width: 300,
}

const LABOR_TYPES: Array<{ value: string; label: string }> = [
  { value: 'direct', label: 'Direct' },
  { value: 'admin_hourly', label: 'Admin Hourly' },
  { value: 'admin_salary', label: 'Admin Salary' },
  { value: 'corp_hourly', label: 'Corp Hourly' },
  { value: 'corp_salary', label: 'Corp Salary' },
  { value: 'hq_hourly', label: 'HQ Hourly' },
  { value: 'hq_salary', label: 'HQ Salary' },
]

// ─── Employee Match Row ───────────────────────────────────────────────────────

function EmployeeMatchRow({
  item,
  branches,
  employees,
  onDismiss,
}: {
  item: EmpAssignment
  branches: Branch[]
  employees: Employee[]
  onDismiss: (id: string) => void
}) {
  const [linkMode, setLinkMode] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [laborType, setLaborType] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [overrideBranchId, setOverrideBranchId] = useState('')
  const [overrideLaborType, setOverrideLaborType] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const snOperations = branches.filter((b) => b.isRevenueGenerating && b.businessCode === 'SN')
  const snCorporate = branches.filter((b) => b.isCorporate && b.businessCode === 'SN')

  // Does the selected existing employee already have an assignment for this entity?
  const existingEntityAssignment = selectedEmployee?.entityAssignments.find(
    (ea) => ea.entityCode === item.entityCode,
  ) ?? null

  const needsOverride = linkMode && selectedEmployee !== null && existingEntityAssignment === null

  const filteredEmployees = searchQuery.length >= 2
    ? employees.filter((e) =>
        e.displayName.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : []

  const isValid = (() => {
    if (linkMode) {
      if (!selectedEmployee) return false
      if (needsOverride && (!overrideBranchId || !overrideLaborType)) return false
      return true
    }
    return !!(branchId && laborType)
  })()

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function resetLinkState() {
    setSelectedEmployee(null)
    setSearchQuery('')
    setSearchOpen(false)
    setOverrideBranchId('')
    setOverrideLaborType('')
  }

  async function handleConfirm() {
    if (!isValid || busy) return
    setBusy(true)
    setConfirmError(null)
    try {
      const body: Record<string, unknown> = {}
      if (linkMode) {
        body.mode = 'link_existing'
        body.existingEmployeeId = selectedEmployee!.id
        if (needsOverride) {
          body.branchId = overrideBranchId
          body.laborType = overrideLaborType
        }
      } else {
        body.mode = 'new_employee'
        body.branchId = branchId
        body.laborType = laborType
      }
      const res = await fetch(`/api/admin/review/employee-assignments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !json.success) {
        setConfirmError(json.error ?? 'Failed to save')
        return
      }
      setSaved(true)
      setTimeout(() => onDismiss(item.id), 700)
    } finally {
      setBusy(false)
    }
  }

  async function handleSkip() {
    if (busy) return
    setBusy(true)
    try {
      await fetch(`/api/admin/review/employee-assignments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'skip' }),
      })
      onDismiss(item.id)
    } finally {
      setBusy(false)
    }
  }

  async function handleTagBusiness(businessTag: 'western_highways' | 'signs') {
    if (busy) return
    setBusy(true)
    try {
      await fetch(`/api/admin/review/employee-assignments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'tag_business', businessTag }),
      })
      onDismiss(item.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid var(--border)' }}>
      {/* Import name */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
        Import name:{' '}
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>&ldquo;{item.rawName}&rdquo;</span>{' '}
        <span style={{ color: 'var(--text-faint)' }}>({item.entityCode})</span>
      </div>

      {/* AI suggestion */}
      {item.aiCandidateName ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          AI suggestion:{' '}
          <span style={{ color: '#ff6b00' }}>{item.aiCandidateName}</span>
          {item.aiScore !== null && (
            <span style={{ color: 'var(--text-faint)' }}> [{Math.round(item.aiScore)}%]</span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>
          No AI match suggestion
        </div>
      )}

      {/* Link to existing checkbox */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          marginBottom: 12,
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={linkMode}
          onChange={(e) => {
            setLinkMode(e.target.checked)
            resetLinkState()
            setBranchId('')
            setLaborType('')
            setConfirmError(null)
          }}
          style={{ accentColor: '#ff6b00' }}
        />
        Link to existing employee
      </label>

      {/* New employee fields */}
      {!linkMode && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Branch</div>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— select branch —</option>
              {snOperations.length > 0 && (
                <optgroup label="Operations">
                  {snOperations.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
              )}
              {snCorporate.length > 0 && (
                <optgroup label="Corporate">
                  {snCorporate.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Labor Type</div>
            <select
              value={laborType}
              onChange={(e) => setLaborType(e.target.value)}
              style={selectStyle}
            >
              <option value="">— select type —</option>
              {LABOR_TYPES.map((lt) => (
                <option key={lt.value} value={lt.value}>{lt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Link existing fields */}
      {linkMode && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Search employee</div>
          <div ref={searchRef} style={{ position: 'relative', display: 'inline-block' }}>
            <input
              type="text"
              value={selectedEmployee ? selectedEmployee.displayName : searchQuery}
              onChange={(e) => {
                if (selectedEmployee) {
                  setSelectedEmployee(null)
                  setOverrideBranchId('')
                  setOverrideLaborType('')
                }
                setSearchQuery(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Type to search by name…"
              style={inputStyle}
            />

            {/* Results dropdown */}
            {searchOpen && !selectedEmployee && searchQuery.length >= 2 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  minWidth: '100%',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-emphasis)',
                  borderRadius: 6,
                  marginTop: 2,
                  maxHeight: 220,
                  overflowY: 'auto',
                  zIndex: 20,
                }}
              >
                {filteredEmployees.length === 0 ? (
                  <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-faint)' }}>
                    No employees found
                  </div>
                ) : (
                  filteredEmployees.map((emp) => (
                    <button
                      key={emp.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedEmployee(emp)
                        setSearchQuery('')
                        setSearchOpen(false)
                        setOverrideBranchId('')
                        setOverrideLaborType('')
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid var(--border-emphasis)',
                        padding: '8px 12px',
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{emp.displayName}</span>
                      {emp.entityAssignments.length > 0 && (
                        <span style={{ color: 'var(--text-dim)', marginLeft: 8, fontSize: 11 }}>
                          {emp.entityAssignments
                            .map((ea) => `${ea.entityCode}: ${ea.branchName} ${fmtLaborType(ea.laborType)}`)
                            .join(', ')}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Clear selected employee */}
          {selectedEmployee && (
            <button
              onClick={resetLinkState}
              style={{
                marginLeft: 8,
                background: 'none',
                border: 'none',
                color: 'var(--text-dim)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ✕ clear
            </button>
          )}

          {/* Selected employee's existing assignments */}
          {selectedEmployee && existingEntityAssignment && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              Existing {item.entityCode} assignment:{' '}
              <span style={{ color: '#ff6b00' }}>
                {existingEntityAssignment.branchName} · {fmtLaborType(existingEntityAssignment.laborType)}
              </span>
            </div>
          )}

          {/* Override dropdowns if employee has no assignment for this entity */}
          {needsOverride && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {selectedEmployee.displayName} has no {item.entityCode} assignment yet — set one:
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Branch</div>
                  <select
                    value={overrideBranchId}
                    onChange={(e) => setOverrideBranchId(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— select branch —</option>
                    {snOperations.length > 0 && (
                      <optgroup label="Operations">
                        {snOperations.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {snCorporate.length > 0 && (
                      <optgroup label="Corporate">
                        {snCorporate.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Labor Type</div>
                  <select
                    value={overrideLaborType}
                    onChange={(e) => setOverrideLaborType(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— select type —</option>
                    {LABOR_TYPES.map((lt) => (
                      <option key={lt.value} value={lt.value}>{lt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inline error */}
      {confirmError && (
        <div style={{ fontSize: 12, color: '#cc4444', marginBottom: 8 }}>{confirmError}</div>
      )}

      {/* Saved flash */}
      {saved && (
        <div style={{ fontSize: 12, color: '#4caf50', marginBottom: 8 }}>Saved</div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
        <ActionBtn label="Tag: Western Hwy" disabled={busy || saved} onClick={() => handleTagBusiness('western_highways')} />
        <ActionBtn label="Tag: Signs" disabled={busy || saved} onClick={() => handleTagBusiness('signs')} />
        <ActionBtn label="Skip" disabled={busy || saved} onClick={handleSkip} />
        <ActionBtn
          label="Confirm"
          variant="primary"
          disabled={!isValid || busy || saved}
          onClick={handleConfirm}
        />
      </div>
    </div>
  )
}

// ─── Employee Matches section ──────────────────────────────────────────────────

function EmployeeMatchesSection({
  items,
  branches,
  employees,
  onDismiss,
}: {
  items: EmpAssignment[]
  branches: Branch[]
  employees: Employee[]
  onDismiss: (id: string) => void
}) {
  return (
    <div className="card">
      <SectionHeader title="Employee Matches" count={items.length} />
      {items.length === 0 ? (
        <EmptyQueue message="No pending employee matches." />
      ) : (
        <div>
          {items.map((item) => (
            <EmployeeMatchRow
              key={item.id}
              item={item}
              branches={branches}
              employees={employees}
              onDismiss={onDismiss}
            />
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
          {items.map((item) => {
            const chosenGroupId = selected[item.id] ?? item.currentGroupId
            return (
              <div
                key={item.id}
                style={{
                  padding: '12px 0',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                    &ldquo;{item.name}&rdquo;
                  </div>
                  {item.suggestedGroup && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      Suggested:{' '}
                      <span style={{ color: '#ff6b00' }}>{item.suggestedGroup}</span>
                      {item.confidence !== null && (
                        <span style={{ color: 'var(--text-faint)' }}>
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
                    style={selectStyle}
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

// ─── Fuel Card Row ────────────────────────────────────────────────────────────

function FuelCardRow({
  card,
  branches,
  employees,
  onDismiss,
}: {
  card: FuelCard
  branches: Branch[]
  employees: Employee[]
  onDismiss: (id: string) => void
}) {
  const [linkEmpMode, setLinkEmpMode] = useState(false)
  // Branch/tag mode
  const [selectedValue, setSelectedValue] = useState('')
  // Employee link mode
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [empBranchId, setEmpBranchId] = useState('')

  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  const snOperations = branches.filter((b) => b.isRevenueGenerating && b.businessCode === 'SN')
  const snCorporate = branches.filter((b) => b.isCorporate && b.businessCode === 'SN')
  const otherBiz = branches.filter((b) => b.businessCode !== 'SN')

  const filteredEmployees =
    searchQuery.length >= 2
      ? employees.filter((e) => e.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
      : []

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function handleSelectEmployee(emp: Employee) {
    setSelectedEmployee(emp)
    setSearchQuery('')
    setSearchOpen(false)
    // Auto-fill branch from their first non-null assignment
    const firstBranch = emp.entityAssignments.find((ea) => ea.branchId !== null)
    setEmpBranchId(firstBranch?.branchId ?? '')
  }

  const isValid = linkEmpMode ? !!(selectedEmployee && empBranchId) : !!selectedValue

  async function handleConfirm() {
    if (!isValid || busy) return
    setBusy(true)
    setRowError(null)
    try {
      const body: Record<string, string> = {}
      if (linkEmpMode) {
        body.employeeId = selectedEmployee!.id
        body.branchId = empBranchId
      } else if (selectedValue.startsWith('tag:')) {
        body.businessTag = selectedValue.slice(4)
      } else {
        body.branchId = selectedValue
      }
      const res = await fetch(`/api/admin/review/fuel-cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !json.success) {
        setRowError(json.error ?? 'Failed to save')
        return
      }
      setSaved(true)
      setTimeout(() => onDismiss(card.id), 700)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid var(--border)' }}>
      {/* Card info */}
      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 4 }}>
        &ldquo;{card.cardName}&rdquo;{' '}
        <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({card.vendor})</span>
      </div>
      {card.currentEmployeeName && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          Linked employee:{' '}
          <span style={{ color: '#ff6b00' }}>{card.currentEmployeeName}</span>
        </div>
      )}
      {card.businessTag && (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>
          Tagged: {card.businessTag}
        </div>
      )}

      {/* Toggle: link to employee */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          marginBottom: 12,
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={linkEmpMode}
          onChange={(e) => {
            setLinkEmpMode(e.target.checked)
            setSelectedValue('')
            setSelectedEmployee(null)
            setSearchQuery('')
            setEmpBranchId('')
            setRowError(null)
          }}
          style={{ accentColor: '#ff6b00' }}
        />
        Link to existing employee
      </label>

      {/* Branch / tag assignment mode */}
      {!linkEmpMode && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
          <select
            value={selectedValue}
            onChange={(e) => setSelectedValue(e.target.value)}
            style={selectStyle}
          >
            <option value="">— assign branch or tag —</option>
            {snOperations.length > 0 && (
              <optgroup label="Operations">
                {snOperations.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </optgroup>
            )}
            {snCorporate.length > 0 && (
              <optgroup label="Corporate">
                {snCorporate.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </optgroup>
            )}
            {otherBiz.length > 0 && (
              <optgroup label="Other Businesses">
                {otherBiz.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Tag as Business">
              <option value="tag:western_highways">Tag as Western Highways</option>
              <option value="tag:signs">Tag as Signs</option>
            </optgroup>
          </select>
        </div>
      )}

      {/* Employee link mode */}
      {linkEmpMode && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Search employee</div>
          <div ref={searchRef} style={{ position: 'relative', display: 'inline-block' }}>
            <input
              type="text"
              value={selectedEmployee ? selectedEmployee.displayName : searchQuery}
              onChange={(e) => {
                if (selectedEmployee) {
                  setSelectedEmployee(null)
                  setEmpBranchId('')
                }
                setSearchQuery(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Type to search by name…"
              style={inputStyle}
            />
            {searchOpen && !selectedEmployee && searchQuery.length >= 2 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  minWidth: '100%',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-emphasis)',
                  borderRadius: 6,
                  marginTop: 2,
                  maxHeight: 220,
                  overflowY: 'auto',
                  zIndex: 20,
                }}
              >
                {filteredEmployees.length === 0 ? (
                  <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-faint)' }}>
                    No employees found
                  </div>
                ) : (
                  filteredEmployees.map((emp) => {
                    const branchNames = [
                      ...new Set(
                        emp.entityAssignments
                          .filter((ea) => ea.branchId !== null)
                          .map((ea) => ea.branchName),
                      ),
                    ]
                    return (
                      <button
                        key={emp.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectEmployee(emp)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          background: 'none',
                          border: 'none',
                          borderBottom: '1px solid var(--border-emphasis)',
                          padding: '8px 12px',
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{emp.displayName}</span>
                        {branchNames.length > 0 && (
                          <span style={{ color: 'var(--text-dim)', marginLeft: 8, fontSize: 11 }}>
                            {branchNames.join(', ')}
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {selectedEmployee && (
            <button
              onClick={() => {
                setSelectedEmployee(null)
                setSearchQuery('')
                setEmpBranchId('')
              }}
              style={{
                marginLeft: 8,
                background: 'none',
                border: 'none',
                color: 'var(--text-dim)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ✕ clear
            </button>
          )}

          {/* Branch select for cost allocation — shown after employee is chosen */}
          {selectedEmployee && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                Card branch (for cost allocation)
              </div>
              <select
                value={empBranchId}
                onChange={(e) => setEmpBranchId(e.target.value)}
                style={selectStyle}
              >
                <option value="">— select branch —</option>
                {snOperations.length > 0 && (
                  <optgroup label="Operations">
                    {snOperations.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </optgroup>
                )}
                {snCorporate.length > 0 && (
                  <optgroup label="Corporate">
                    {snCorporate.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {empBranchId && (
                <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>
                  auto-filled from employee
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {rowError && (
        <div style={{ fontSize: 12, color: '#cc4444', marginBottom: 8 }}>{rowError}</div>
      )}
      {saved && (
        <div style={{ fontSize: 12, color: '#4caf50', marginBottom: 8 }}>Saved</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <ActionBtn
          label={linkEmpMode ? 'Link' : 'Assign'}
          variant="primary"
          disabled={!isValid || busy || saved}
          onClick={handleConfirm}
        />
      </div>
    </div>
  )
}

// ─── Unassigned Fuel Cards section ────────────────────────────────────────────

function FuelCardsSection({
  cards,
  branches,
  employees,
  onDismiss,
}: {
  cards: FuelCard[]
  branches: Branch[]
  employees: Employee[]
  onDismiss: (id: string) => void
}) {
  return (
    <div className="card">
      <SectionHeader title="Unassigned Fuel Cards" count={cards.length} />
      {cards.length === 0 ? (
        <EmptyQueue message="No unassigned fuel cards." />
      ) : (
        <div>
          {cards.map((card) => (
            <FuelCardRow
              key={card.id}
              card={card}
              branches={branches}
              employees={employees}
              onDismiss={onDismiss}
            />
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
  const [pendingAllocs, setPendingAllocs] = useState<PendingAllocation[]>([])
  const [pendingOverrides, setPendingOverrides] = useState<PendingOverride[]>([])
  const [allocActioning, setAllocActioning] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/review')
      .then((r) => r.json())
      .then((json: { success: boolean; data: ReviewData; error?: string }) => {
        if (!json.success) throw new Error(json.error)
        setData(json.data)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))

    fetch('/api/admin/allocations')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setPendingAllocs(json.data.pendingAllocations ?? [])
          setPendingOverrides(json.data.pendingOverrides ?? [])
        }
      })
      .catch(() => {/* non-critical */})
  }, [])

  function dismiss(type: keyof ReviewData, id: string) {
    setData((prev) => {
      if (!prev) return prev
      const field = prev[type]
      if (!Array.isArray(field)) return prev
      return {
        ...prev,
        [type]: field.filter((item: { id: string }) => item.id !== id),
      }
    })
  }

  const actOnAllocation = async (empId: string, id: string, status: 'approved' | 'denied', type: 'alloc' | 'override') => {
    setAllocActioning(id)
    const path = type === 'alloc'
      ? `/api/employees/${empId}/allocations/${id}`
      : `/api/employees/${empId}/allocation-overrides/${id}`
    await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (type === 'alloc') setPendingAllocs((prev) => prev.filter((a) => a.id !== id))
    else setPendingOverrides((prev) => prev.filter((o) => o.id !== id))
    setAllocActioning(null)
  }

  const totalPending = data
    ? data.employeeAssignments.length + data.payrollItems.length + data.fuelCards.length + pendingAllocs.length + pendingOverrides.length
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>Review Queue</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
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
            branches={data.branches}
            employees={data.employees}
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
            employees={data.employees}
            onDismiss={(id) => dismiss('fuelCards', id)}
          />
          {(pendingAllocs.length > 0 || pendingOverrides.length > 0) && (
            <div className="card">
              <SectionHeader title="Pending Allocations" count={pendingAllocs.length + pendingOverrides.length} />
              {pendingAllocs.length > 0 && (
                <>
                  <p style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Default Allocations</p>
                  {pendingAllocs.map((a) => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <span style={{ color: '#ff6b00', fontSize: 13, fontWeight: 500 }}>{a.displayName}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>{a.branchName} — {a.percentage}% from {a.effective_from}</span>
                        {a.notes && <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: '2px 0 0' }}>{a.notes}</p>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => actOnAllocation(a.employee_id, a.id, 'approved', 'alloc')} disabled={allocActioning === a.id}
                          style={{ background: '#1a3a1a', color: '#4caf50', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                          Approve
                        </button>
                        <button onClick={() => actOnAllocation(a.employee_id, a.id, 'denied', 'alloc')} disabled={allocActioning === a.id}
                          style={{ background: '#3a1a1a', color: '#cc4444', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {pendingOverrides.length > 0 && (
                <>
                  <p style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 12, marginBottom: 8 }}>Weekly Overrides</p>
                  {pendingOverrides.map((o) => (
                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <span style={{ color: '#ff6b00', fontSize: 13, fontWeight: 500 }}>{o.displayName}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>{o.period_date} — {o.branchName} {o.percentage}%</span>
                        {o.notes && <p style={{ color: 'var(--text-dim)', fontSize: 11, margin: '2px 0 0' }}>{o.notes}</p>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => actOnAllocation(o.employee_id, o.id, 'approved', 'override')} disabled={allocActioning === o.id}
                          style={{ background: '#1a3a1a', color: '#4caf50', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                          Approve
                        </button>
                        <button onClick={() => actOnAllocation(o.employee_id, o.id, 'denied', 'override')} disabled={allocActioning === o.id}
                          style={{ background: '#3a1a1a', color: '#cc4444', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
