'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import BarChart, { type BarChartDataPoint } from '@/components/charts/BarChart'
import { formatCurrency } from '@/lib/utils/format'
import type { LaborType, Vendor } from '@/lib/supabase/database.types'
import type { Role } from '@/lib/supabase/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LegalName {
  entityCode: string
  entityName: string
  rawName: string
}

interface Assignment {
  entityId: string
  entityCode: string
  entityName: string
  payrollCode: string
  laborType: LaborType
  branchId: string | null
  branchName: string | null
}

interface EmployeeData {
  id: string
  firstName: string
  lastName: string
  displayName: string
  isActive: boolean
  legalNames: LegalName[]
  assignments: Assignment[]
}

interface PayrollRow {
  periodDate: string
  itemId: string | null
  itemName: string | null
  groupName: string | null
  hours: number | null
  rate: number | null
  amount: number
  entityCode: string
  laborType: LaborType
}

interface FuelRow {
  id: string
  transactionDate: string
  vendor: Vendor
  siteName: string | null
  siteCity: string | null
  siteState: string | null
  product: string | null
  gallons: number | null
  pricePerGallon: number | null
  totalWithTax: number
}

interface TaxRow {
  periodDate: string
  amount: number
}

interface DetailData {
  employee: EmployeeData
  payrollHistory: PayrollRow[]
  taxHistory: TaxRow[]
  fuelHistory: FuelRow[]
}

interface TransferRecord {
  id: string
  effectiveDate: string
  createdAt: string
  notes: string | null
  fromPayrollCodeId: string
  toPayrollCodeId: string
  fromCode: string
  toCode: string
  fromBranchName: string | null
  toBranchName: string | null
  entityCode: string
}

interface AssignmentPeriod {
  id: string
  entityCode: string
  entityName: string
  payrollCode: string
  laborType: LaborType
  branchName: string | null
  effectiveFrom: string
  effectiveTo: string | null
  payrollCodeId: string | null
}

interface TransferPayrollCode {
  id: string
  code: string
  laborType: LaborType
  branchId: string | null
  branchName: string
  entityCode: string
  entityId: string
}

interface TransferData {
  transfers: TransferRecord[]
  assignments: AssignmentPeriod[]
  payrollCodes: TransferPayrollCode[]
}

interface Props {
  employeeId: string
  role: Role
  returnPath: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPeriod(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function formatLaborType(lt: LaborType): string {
  switch (lt) {
    case 'direct': return 'Direct'
    case 'admin_hourly': return 'Admin Hourly'
    case 'admin_salary': return 'Admin Salary'
    case 'corp_hourly': return 'Corp Hourly'
    case 'corp_salary': return 'Corp Salary'
    case 'hq_hourly': return 'HQ Hourly'
    case 'hq_salary': return 'HQ Salary'
  }
}

function toWeekBucket(dateStr: string): string {
  // Returns ISO-week-aligned Saturday for grouping fuel transactions
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay() // 0=Sun ... 6=Sat
  const daysToSat = dow === 6 ? 0 : 6 - dow
  const sat = new Date(date)
  sat.setDate(date.getDate() + daysToSat)
  return sat.toISOString().slice(0, 10)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmployeeDetailClient({ employeeId, role, returnPath }: Props) {
  const router = useRouter()
  const isAdmin = role === 'admin'

  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit name state
  const [editing, setEditing] = useState(false)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // Fuel filter state
  const [vendorFilter, setVendorFilter] = useState<'all' | 'interstate' | 'flyers'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | '90d' | '1y'>('all')

  // Payroll table pagination
  const [payrollPage, setPayrollPage] = useState(1)
  const PAYROLL_PAGE_SIZE = 25

  // Branch transfer state (admin + executive only)
  const [transferData, setTransferData] = useState<TransferData | null>(null)
  const [showTransferForm, setShowTransferForm] = useState(false)
  const [transferEntity, setTransferEntity] = useState('')   // entity filter (INC/TCS/STS)
  const [transferCodeId, setTransferCodeId] = useState('')
  const [transferDate, setTransferDate] = useState('')
  const [transferNotes, setTransferNotes] = useState('')
  const [transferConfirm, setTransferConfirm] = useState('')
  const [submittingTransfer, setSubmittingTransfer] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<string | null>(null)

  // Allocation state (admin only)
  interface AllocationRow { id: string; branch_id: string; percentage: number; effective_from: string; effective_to: string | null; status: string; notes: string | null; branches: { name: string } | null }
  interface OverrideRow { id: string; period_date: string; branch_id: string; percentage: number; status: string; notes: string | null; branches: { name: string } | null }
  const [allocations, setAllocations] = useState<AllocationRow[]>([])
  const [overrides, setOverrides] = useState<OverrideRow[]>([])
  const [allocLoading, setAllocLoading] = useState(false)
  const [showAllocForm, setShowAllocForm] = useState(false)
  const [allocSplits, setAllocSplits] = useState<Array<{ branchId: string; percentage: number }>>([{ branchId: '', percentage: 100 }])
  const [allocEffectiveFrom, setAllocEffectiveFrom] = useState('')
  const [allocNotes, setAllocNotes] = useState('')
  const [allocError, setAllocError] = useState<string | null>(null)
  const [allocSaving, setAllocSaving] = useState(false)
  const [availableBranches, setAvailableBranches] = useState<Array<{ id: string; name: string }>>([])

  // Labor type change state (admin only)
  const [changingLaborFor, setChangingLaborFor] = useState<string | null>(null) // entityId
  const [ltNewType, setLtNewType] = useState<LaborType>('direct')
  const [ltRetroactive, setLtRetroactive] = useState(false)
  const [ltRetroFrom, setLtRetroFrom] = useState('')
  const [ltSaving, setLtSaving] = useState(false)
  const [ltError, setLtError] = useState<string | null>(null)
  const [ltSuccess, setLtSuccess] = useState<string | null>(null)

  const loadAllocations = useCallback(() => {
    setAllocLoading(true)
    fetch(`/api/employees/${employeeId}/allocations`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setAllocations(json.data.allocations ?? [])
          setOverrides(json.data.overrides ?? [])
        }
      })
      .catch(() => {/* non-critical */})
      .finally(() => setAllocLoading(false))
  }, [employeeId])

  useEffect(() => {
    if (role === 'admin') {
      loadAllocations()
      fetch('/api/branches')
        .then((r) => r.json())
        .then((json) => { if (json.success) setAvailableBranches(json.data ?? []) })
        .catch(() => {/* non-critical */})
    }
  }, [role, loadAllocations])

  const submitAllocation = async () => {
    setAllocError(null)
    const total = allocSplits.reduce((s, sp) => s + Number(sp.percentage), 0)
    if (Math.abs(total - 100) > 0.01) { setAllocError('Percentages must sum to 100'); return }
    if (!allocEffectiveFrom) { setAllocError('Effective from date is required'); return }
    setAllocSaving(true)
    try {
      const res = await fetch(`/api/employees/${employeeId}/allocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splits: allocSplits, effectiveFrom: allocEffectiveFrom, notes: allocNotes || undefined }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to save')
      setShowAllocForm(false)
      setAllocSplits([{ branchId: '', percentage: 100 }])
      setAllocEffectiveFrom('')
      setAllocNotes('')
      loadAllocations()
    } catch (e) {
      setAllocError((e as Error).message)
    } finally {
      setAllocSaving(false)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/employees/${employeeId}/detail`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error ?? 'Failed to load employee')
        setData(json.data as DetailData)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [employeeId])

  useEffect(() => { load() }, [load])

  const loadTransfers = useCallback(() => {
    fetch(`/api/employees/${employeeId}/transfers`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setTransferData(json.data as TransferData) })
      .catch(() => {/* non-critical */})
  }, [employeeId])

  useEffect(() => {
    if (role === 'admin' || role === 'executive') loadTransfers()
  }, [role, loadTransfers])

  // ── Derived payroll data ──────────────────────────────────────────────────

  const weeklyHours = useMemo<BarChartDataPoint[]>(() => {
    if (!data) return []
    const byPeriod: Record<string, number> = {}
    for (const row of data.payrollHistory) {
      if (row.hours == null) continue
      byPeriod[row.periodDate] = (byPeriod[row.periodDate] ?? 0) + row.hours
    }
    return Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([date, value]) => ({ label: formatPeriod(date), value }))
  }, [data])

  const weeklyEarnings = useMemo<BarChartDataPoint[]>(() => {
    if (!data) return []
    const byPeriod: Record<string, number> = {}
    for (const row of data.payrollHistory) {
      byPeriod[row.periodDate] = (byPeriod[row.periodDate] ?? 0) + row.amount
    }
    return Object.entries(byPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([date, value]) => ({ label: formatPeriod(date), value }))
  }, [data])

  const groupBreakdown = useMemo<{ groupName: string; total: number; pct: number }[]>(() => {
    if (!data) return []
    const byGroup: Record<string, number> = {}
    const grandTotal = data.payrollHistory.reduce((s, r) => s + r.amount, 0)
    for (const row of data.payrollHistory) {
      const key = row.groupName ?? 'Uncategorized'
      byGroup[key] = (byGroup[key] ?? 0) + row.amount
    }
    return Object.entries(byGroup)
      .map(([groupName, total]) => ({
        groupName,
        total,
        pct: grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
  }, [data])

  const totalEarnings = useMemo(
    () => data?.payrollHistory.reduce((s, r) => s + r.amount, 0) ?? 0,
    [data]
  )
  const totalHours = useMemo(
    () => data?.payrollHistory.reduce((s, r) => s + (r.hours ?? 0), 0) ?? 0,
    [data]
  )

  // ── Derived fuel data ─────────────────────────────────────────────────────

  const filteredFuel = useMemo<FuelRow[]>(() => {
    if (!data) return []
    let rows = data.fuelHistory
    if (vendorFilter !== 'all') rows = rows.filter((r) => r.vendor === vendorFilter)
    if (dateFilter !== 'all') {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - (dateFilter === '90d' ? 90 : 365))
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      rows = rows.filter((r) => r.transactionDate >= cutoffStr)
    }
    return rows
  }, [data, vendorFilter, dateFilter])

  const weeklyGallons = useMemo<BarChartDataPoint[]>(() => {
    const byWeek: Record<string, number> = {}
    for (const row of filteredFuel) {
      if (row.gallons == null) continue
      const bucket = toWeekBucket(row.transactionDate)
      byWeek[bucket] = (byWeek[bucket] ?? 0) + row.gallons
    }
    return Object.entries(byWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([date, value]) => ({ label: formatPeriod(date), value }))
  }, [filteredFuel])

  const totalFuelCost = useMemo(
    () => filteredFuel.reduce((s, r) => s + r.totalWithTax, 0),
    [filteredFuel]
  )
  const totalGallons = useMemo(
    () => filteredFuel.reduce((s, r) => s + (r.gallons ?? 0), 0),
    [filteredFuel]
  )

  const totalWeeks = useMemo(() => {
    if (!data) return 0
    return new Set(data.payrollHistory.map((r) => r.periodDate)).size
  }, [data])

  const totalEmployerTaxes = useMemo(
    () => data?.taxHistory.reduce((s, r) => s + r.amount, 0) ?? 0,
    [data]
  )

  const taxByPeriod = useMemo<Record<string, number>>(() => {
    if (!data) return {}
    return data.taxHistory.reduce<Record<string, number>>((m, r) => {
      m[r.periodDate] = (m[r.periodDate] ?? 0) + r.amount
      return m
    }, {})
  }, [data])

  const weeklyTaxes = useMemo<BarChartDataPoint[]>(() => {
    return Object.entries(taxByPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([date, value]) => ({ label: formatPeriod(date), value }))
  }, [taxByPeriod])

  const payrollItemSummary = useMemo(() => {
    if (!data) return []
    const byItem: Record<string, { itemName: string; groupName: string; rates: { rate: number | null; date: string }[]; count: number }> = {}
    for (const row of data.payrollHistory) {
      const key = row.itemName ?? '__none__'
      if (!byItem[key]) byItem[key] = { itemName: row.itemName ?? 'Uncategorized', groupName: row.groupName ?? '—', rates: [], count: 0 }
      byItem[key].rates.push({ rate: row.rate, date: row.periodDate })
      byItem[key].count++
    }
    return Object.values(byItem).map((item) => {
      const sortedRates = item.rates.filter((r) => r.rate != null).sort((a, b) => b.date.localeCompare(a.date))
      const sortedDates = [...item.rates].sort((a, b) => b.date.localeCompare(a.date))
      return {
        itemName: item.itemName,
        groupName: item.groupName,
        mostRecentRate: sortedRates[0]?.rate ?? null,
        lastDate: sortedDates[0]?.date ?? '',
        occurrences: item.count,
      }
    }).sort((a, b) => b.occurrences - a.occurrences)
  }, [data])

  const weeklyFuelCost = useMemo<BarChartDataPoint[]>(() => {
    const byWeek: Record<string, number> = {}
    for (const row of filteredFuel) {
      const bucket = toWeekBucket(row.transactionDate)
      byWeek[bucket] = (byWeek[bucket] ?? 0) + row.totalWithTax
    }
    return Object.entries(byWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-13)
      .map(([date, value]) => ({ label: formatPeriod(date), value }))
  }, [filteredFuel])

  // ── Edit name handlers ────────────────────────────────────────────────────

  function startEdit() {
    if (!data) return
    setEditFirst(data.employee.firstName)
    setEditLast(data.employee.lastName)
    setNameError(null)
    setEditing(true)
  }

  async function saveName() {
    const first = editFirst.trim()
    const last = editLast.trim()
    if (!first || !last) {
      setNameError('Both first and last name are required.')
      return
    }
    setSavingName(true)
    setNameError(null)
    try {
      const res = await fetch(`/api/employees/${employeeId}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: first, lastName: last }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Save failed')
      // Update local state
      setData((prev) =>
        prev
          ? {
              ...prev,
              employee: {
                ...prev.employee,
                firstName: json.data.firstName,
                lastName: json.data.lastName,
                displayName: json.data.displayName,
              },
            }
          : prev
      )
      setEditing(false)
    } catch (e) {
      setNameError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingName(false)
    }
  }

  // ── Transfer handlers ─────────────────────────────────────────────────────

  async function submitTransfer() {
    setTransferError(null)
    setSubmittingTransfer(true)
    try {
      const res = await fetch(`/api/employees/${employeeId}/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toPayrollCodeId: transferCodeId,
          effectiveDate: transferDate,
          notes: transferNotes || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Transfer failed')
      setShowTransferForm(false)
      setTransferEntity('')
      setTransferCodeId('')
      setTransferDate('')
      setTransferNotes('')
      setTransferConfirm('')
      loadTransfers()
      load()
    } catch (e) {
      setTransferError(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setSubmittingTransfer(false)
    }
  }

  async function revertTransfer(transferId: string) {
    setRevertingId(transferId)
    try {
      const res = await fetch(`/api/employees/${employeeId}/transfers/${transferId}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Revert failed')
      loadTransfers()
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Revert failed')
    } finally {
      setRevertingId(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 32, background: 'var(--bg-secondary)', borderRadius: 8, width: 200, marginBottom: 12 }} />
        <div style={{ height: 24, background: 'var(--bg-secondary)', borderRadius: 8, width: 140, marginBottom: 24 }} />
        <div style={{ height: 120, background: 'var(--bg-surface)', borderRadius: 12, marginBottom: 12 }} />
        <div style={{ height: 200, background: 'var(--bg-surface)', borderRadius: 12 }} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24 }}>
        <button
          onClick={() => router.back()}
          style={{ color: 'var(--text-muted)', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16 }}
        >
          ← Back
        </button>
        <p style={{ color: '#cc4444', fontSize: 14 }}>{error ?? 'Employee not found.'}</p>
      </div>
    )
  }

  const { employee, payrollHistory, fuelHistory } = data
  const hasFuel = fuelHistory.length > 0

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Back */}
      <button
        onClick={() => router.back()}
        style={{
          color: 'var(--text-muted)',
          fontSize: 13,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        ← Back
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  placeholder="First name"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-emphasis)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    fontSize: 18,
                    fontWeight: 500,
                    padding: '6px 12px',
                    outline: 'none',
                    width: 160,
                  }}
                />
                <input
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  placeholder="Last name"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-emphasis)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    fontSize: 18,
                    fontWeight: 500,
                    padding: '6px 12px',
                    outline: 'none',
                    width: 160,
                  }}
                />
                <button
                  onClick={saveName}
                  disabled={savingName}
                  style={{
                    background: '#ff6b00',
                    color: 'var(--text-primary)',
                    border: 'none',
                    borderRadius: 8,
                    padding: '6px 16px',
                    fontSize: 13,
                    cursor: savingName ? 'not-allowed' : 'pointer',
                    opacity: savingName ? 0.7 : 1,
                  }}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: 8,
                    padding: '6px 16px',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
              {nameError && <p style={{ color: '#cc4444', fontSize: 12, margin: 0 }}>{nameError}</p>}
              {/* Legal names shown read-only during edit */}
              {employee.legalNames.map((ln, i) => (
                <p key={i} style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>
                  Legal name ({ln.entityCode}): {ln.rawName}
                </p>
              ))}
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
                {employee.displayName}
                {!employee.isActive && (
                  <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                    inactive
                  </span>
                )}
              </h1>
              {employee.legalNames.map((ln, i) => (
                <p key={i} style={{ margin: '0 0 2px 0', fontSize: 11, color: 'var(--text-faint)' }}>
                  Legal name ({ln.entityCode}): {ln.rawName}
                </p>
              ))}
            </>
          )}
        </div>

        {isAdmin && !editing && (
          <button
            onClick={startEdit}
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-emphasis)',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Edit Name
          </button>
        )}
      </div>

      {/* Assignment pills */}
      <div style={{ marginBottom: 24 }}>
        {employee.assignments.map((a, i) => (
          <div key={i} style={{ marginBottom: changingLaborFor === a.entityId ? 12 : 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {a.branchName && <Pill color="orange">{a.branchName}</Pill>}
              <Pill>{a.entityCode}</Pill>
              <Pill>{a.payrollCode}</Pill>
              <Pill>{formatLaborType(a.laborType)}</Pill>
              {isAdmin && changingLaborFor !== a.entityId && (
                <button
                  onClick={() => {
                    setChangingLaborFor(a.entityId)
                    setLtNewType(a.laborType)
                    setLtRetroactive(false)
                    setLtRetroFrom('')
                    setLtError(null)
                    setLtSuccess(null)
                  }}
                  style={{ background: 'none', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '2px 10px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Change
                </button>
              )}
            </div>

            {/* Inline change form */}
            {isAdmin && changingLaborFor === a.entityId && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginTop: 8, maxWidth: 420 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
                  Change Labor Type — {a.entityCode}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>New labor type</div>
                  <select
                    value={ltNewType}
                    onChange={(e) => setLtNewType(e.target.value as LaborType)}
                    style={ltInputStyle}
                  >
                    {(['direct', 'admin_hourly', 'admin_salary', 'corp_hourly', 'corp_salary', 'hq_hourly', 'hq_salary'] as LaborType[]).map((lt) => (
                      <option key={lt} value={lt}>{formatLaborType(lt)}</option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>Effective</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, cursor: 'pointer' }}>
                    <input type="radio" checked={!ltRetroactive} onChange={() => setLtRetroactive(false)} />
                    Going forward only — future imports use the new type
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input type="radio" checked={ltRetroactive} onChange={() => setLtRetroactive(true)} />
                    Retroactive from date
                  </label>
                  {ltRetroactive && (
                    <div style={{ marginTop: 8, marginLeft: 22 }}>
                      <input
                        type="date"
                        value={ltRetroFrom}
                        onChange={(e) => setLtRetroFrom(e.target.value)}
                        style={ltInputStyle}
                      />
                      <div style={{ fontSize: 11, color: '#cc4444', marginTop: 6 }}>
                        All historical transactions from this date onward will be re-attributed to the new code.
                      </div>
                    </div>
                  )}
                </div>

                {ltError && <div style={{ fontSize: 12, color: '#cc4444', marginBottom: 10 }}>{ltError}</div>}
                {ltSuccess && <div style={{ fontSize: 12, color: '#4caf50', marginBottom: 10 }}>{ltSuccess}</div>}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    disabled={ltSaving || ltNewType === a.laborType}
                    onClick={async () => {
                      if (ltRetroactive && !ltRetroFrom) { setLtError('Select a retroactive start date'); return }
                      setLtSaving(true)
                      setLtError(null)
                      setLtSuccess(null)
                      try {
                        const res = await fetch(`/api/employees/${employeeId}/labor-type`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            entityId: a.entityId,
                            newLaborType: ltNewType,
                            retroactiveFrom: ltRetroactive ? ltRetroFrom : undefined,
                          }),
                        })
                        const json = await res.json()
                        if (!json.success) throw new Error(json.error ?? 'Failed to save')
                        const msg = ltRetroactive
                          ? `Updated. ${json.data.updatedTransactions} historical transaction${json.data.updatedTransactions !== 1 ? 's' : ''} re-attributed.`
                          : 'Updated. Future imports will use the new labor type.'
                        setLtSuccess(msg)
                        setChangingLaborFor(null)
                        load()
                      } catch (e) {
                        setLtError((e as Error).message)
                      } finally {
                        setLtSaving(false)
                      }
                    }}
                    style={{
                      background: ltNewType === a.laborType ? 'var(--bg-secondary)' : '#ff6b00',
                      color: ltNewType === a.laborType ? 'var(--text-faint)' : 'var(--text-primary)',
                      border: 'none', borderRadius: 8, padding: '7px 16px',
                      fontSize: 12, fontWeight: 500,
                      cursor: ltSaving || ltNewType === a.laborType ? 'not-allowed' : 'pointer',
                      opacity: ltSaving ? 0.6 : 1,
                    }}
                  >
                    {ltSaving ? 'Saving…' : 'Save Change'}
                  </button>
                  <button
                    onClick={() => { setChangingLaborFor(null); setLtError(null); setLtSuccess(null) }}
                    style={{ background: 'none', border: '1px solid var(--border-emphasis)', borderRadius: 8, padding: '7px 16px', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Summary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Gross Earnings" value={formatCurrency(totalEarnings)} />
        <SummaryCard label="Employer Taxes" value={formatCurrency(totalEmployerTaxes)} muted={totalEmployerTaxes === 0} />
        <SummaryCard label="Total Hours" value={`${totalHours.toFixed(1)} hrs`} />
        <SummaryCard
          label="Avg Hourly Rate"
          value={
            totalHours > 0
              ? formatCurrency(totalEarnings / totalHours)
              : '—'
          }
        />
        <SummaryCard label="Total Weeks" value={String(totalWeeks)} />
      </div>

      {/* ── Payroll section ── */}
      <SectionHeader>Payroll History</SectionHeader>

      {payrollHistory.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>No payroll records found.</p>
      ) : (
        <>
          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={cardStyle}>
              <p style={cardLabelStyle}>Hours per Week (last 13)</p>
              <BarChart
                data={weeklyHours}
                color="#ff6b00"
                height={130}
                formatValue={(v) => `${v.toFixed(1)} hrs`}
              />
            </div>
            <div style={cardStyle}>
              <p style={cardLabelStyle}>Gross Earnings per Week (last 13)</p>
              <BarChart data={weeklyEarnings} color="#ff6b00" height={130} />
            </div>
            {weeklyTaxes.length > 0 && (
              <div style={cardStyle}>
                <p style={cardLabelStyle}>Employer Taxes per Week (last 13)</p>
                <BarChart
                  data={weeklyTaxes}
                  color="#cc4444"
                  height={130}
                  formatValue={(v) => formatCurrency(v)}
                />
              </div>
            )}
          </div>

          {/* Rate history table with pagination */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ ...cardLabelStyle, margin: 0 }}>Rate History</p>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {payrollHistory.length} transactions
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Period', 'Item', 'Group', 'Entity', 'Rate', 'Hours', 'Amount'].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const pageRows = payrollHistory.slice(
                      (payrollPage - 1) * PAYROLL_PAGE_SIZE,
                      payrollPage * PAYROLL_PAGE_SIZE
                    )
                    const renderedPeriods = new Set<string>()
                    const elements: React.ReactNode[] = []
                    let rowIdx = 0

                    for (const row of pageRows) {
                      elements.push(
                        <tr
                          key={rowIdx}
                          style={{
                            borderTop: '1px solid var(--border)',
                            background: rowIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                          }}
                        >
                          <td style={tdStyle}>{formatPeriod(row.periodDate)}</td>
                          <td style={tdStyle}>{row.itemName ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                          <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{row.groupName ?? '—'}</td>
                          <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{row.entityCode}</td>
                          <td style={tdStyle}>{row.rate != null ? formatCurrency(row.rate) : '—'}</td>
                          <td style={tdStyle}>{row.hours != null ? row.hours.toFixed(2) : '—'}</td>
                          <td style={{ ...tdStyle, color: '#ff6b00' }}>{formatCurrency(row.amount)}</td>
                        </tr>
                      )
                      rowIdx++

                      // Inject tax row after the last transaction for this period on this page
                      const nextRow = pageRows[pageRows.indexOf(row) + 1]
                      const isLastOfPeriod = !nextRow || nextRow.periodDate !== row.periodDate
                      if (isLastOfPeriod && !renderedPeriods.has(row.periodDate)) {
                        const taxAmt = taxByPeriod[row.periodDate]
                        if (taxAmt != null && taxAmt > 0) {
                          renderedPeriods.add(row.periodDate)
                          elements.push(
                            <tr
                              key={`tax-${row.periodDate}`}
                              style={{ borderTop: '1px solid var(--border)', background: 'rgba(204,68,68,0.04)' }}
                            >
                              <td style={tdStyle}>{formatPeriod(row.periodDate)}</td>
                              <td style={{ ...tdStyle, color: '#cc4444', fontStyle: 'italic' }} colSpan={5}>
                                Employer Taxes &amp; Contributions
                              </td>
                              <td style={{ ...tdStyle, color: '#cc4444' }}>{formatCurrency(taxAmt)}</td>
                            </tr>
                          )
                        }
                      }
                    }
                    return elements
                  })()}
                </tbody>
              </table>
            </div>
            {/* Pagination controls */}
            {payrollHistory.length > PAYROLL_PAGE_SIZE && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
                <span>
                  Showing {(payrollPage - 1) * PAYROLL_PAGE_SIZE + 1}–{Math.min(payrollPage * PAYROLL_PAGE_SIZE, payrollHistory.length)} of {payrollHistory.length} transactions
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    disabled={payrollPage <= 1}
                    onClick={() => setPayrollPage((p) => p - 1)}
                    style={{ background: 'var(--bg-secondary)', border: 'none', borderRadius: 6, padding: '4px 10px', color: payrollPage <= 1 ? 'var(--text-faint)' : 'var(--text-secondary)', cursor: payrollPage <= 1 ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12 }}
                  >
                    ← Prev
                  </button>
                  <button
                    disabled={payrollPage * PAYROLL_PAGE_SIZE >= payrollHistory.length}
                    onClick={() => setPayrollPage((p) => p + 1)}
                    style={{ background: 'var(--bg-secondary)', border: 'none', borderRadius: 6, padding: '4px 10px', color: payrollPage * PAYROLL_PAGE_SIZE >= payrollHistory.length ? 'var(--text-faint)' : 'var(--text-secondary)', cursor: payrollPage * PAYROLL_PAGE_SIZE >= payrollHistory.length ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12 }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Payroll Items & Rate History summary */}
          {payrollItemSummary.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <p style={{ ...cardLabelStyle, marginBottom: 12 }}>Payroll Items & Rate History</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Item Name', 'Group', 'Most Recent Rate', 'Last Date', 'Occurrences'].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payrollItemSummary.map((item, i) => (
                      <tr
                        key={i}
                        style={{
                          borderTop: '1px solid var(--border)',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                        }}
                      >
                        <td style={tdStyle}>{item.itemName}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{item.groupName}</td>
                        <td style={tdStyle}>{item.mostRecentRate != null ? formatCurrency(item.mostRecentRate) : '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{item.lastDate ? formatPeriod(item.lastDate) : '—'}</td>
                        <td style={{ ...tdStyle, color: '#ff6b00' }}>{item.occurrences}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Group breakdown */}
          <div style={cardStyle}>
            <p style={{ ...cardLabelStyle, marginBottom: 12 }}>Pay Group Breakdown</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupBreakdown.map((g) => (
                <div key={g.groupName}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{g.groupName}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {g.pct}% &nbsp;
                      <span style={{ color: '#ff6b00' }}>{formatCurrency(g.total)}</span>
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2 }}>
                    <div
                      style={{
                        height: 4,
                        width: `${g.pct}%`,
                        background: '#ff6b00',
                        borderRadius: 2,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Branch History section (admin + executive) ── */}
      {(role === 'admin' || role === 'executive') && transferData && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginBottom: 12 }}>
            <SectionHeader style={{ margin: 0 }}>Branch History</SectionHeader>
            {isAdmin && !showTransferForm && (
              <button
                onClick={() => { setShowTransferForm(true); setTransferError(null) }}
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-emphasis)',
                  borderRadius: 8,
                  padding: '6px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Transfer Branch
              </button>
            )}
          </div>

          {/* Assignment period timeline grouped by entity */}
          {(() => {
            const byEntity: Record<string, AssignmentPeriod[]> = {}
            for (const a of transferData.assignments) {
              if (!byEntity[a.entityCode]) byEntity[a.entityCode] = []
              byEntity[a.entityCode].push(a)
            }
            return Object.entries(byEntity).map(([entityCode, periods]) => (
              <div key={entityCode} style={{ ...cardStyle, marginBottom: 8 }}>
                <p style={cardLabelStyle}>{entityCode}</p>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Branch', 'Code', 'Type', 'From', 'To'].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((a, i) => (
                      <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ ...tdStyle, color: '#ff6b00' }}>{a.branchName ?? '—'}</td>
                        <td style={tdStyle}>{a.payrollCode}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{formatLaborType(a.laborType)}</td>
                        <td style={{ ...tdStyle, color: a.effectiveFrom === '1900-01-01' ? 'var(--text-faint)' : 'var(--text-secondary)' }}>
                          {a.effectiveFrom === '1900-01-01' ? 'Original' : formatPeriod(a.effectiveFrom)}
                        </td>
                        <td style={tdStyle}>
                          {a.effectiveTo ? (
                            formatPeriod(a.effectiveTo)
                          ) : (
                            <span style={{ color: '#4caf50', fontSize: 11 }}>Current</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          })()}

          {/* Transfer log */}
          {transferData.transfers.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 8 }}>
              <p style={cardLabelStyle}>Transfer Log</p>
              {transferData.transfers.map((t, i) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '10px 0',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span style={{ color: '#cc4444' }}>{t.fromBranchName ?? t.fromCode}</span>
                      {' → '}
                      <span style={{ color: '#ff6b00' }}>{t.toBranchName ?? t.toCode}</span>
                      <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>({t.entityCode})</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
                      Effective {formatPeriod(t.effectiveDate)}
                      {t.notes && <span style={{ color: 'var(--text-faint)' }}> · {t.notes}</span>}
                    </div>
                  </div>
                  {isAdmin && i === 0 && (
                    <button
                      onClick={() => revertTransfer(t.id)}
                      disabled={revertingId === t.id}
                      style={{
                        background: '#3a1a1a',
                        color: '#cc4444',
                        border: 'none',
                        borderRadius: 6,
                        padding: '4px 10px',
                        fontSize: 11,
                        cursor: revertingId === t.id ? 'not-allowed' : 'pointer',
                        opacity: revertingId === t.id ? 0.6 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {revertingId === t.id ? 'Reverting…' : 'Revert'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Transfer form */}
          {isAdmin && showTransferForm && (() => {
            // Unique entities that have codes (sorted)
            const entityCodes = [...new Set(transferData.payrollCodes.map((pc) => pc.entityCode))].sort()

            // Filter codes to selected entity, then group by branch
            const filteredCodes = transferEntity
              ? transferData.payrollCodes.filter((pc) => pc.entityCode === transferEntity)
              : []
            const codesByBranch = filteredCodes.reduce<Record<string, TransferPayrollCode[]>>((acc, pc) => {
              if (!acc[pc.branchName]) acc[pc.branchName] = []
              acc[pc.branchName].push(pc)
              return acc
            }, {})

            const selectedCode = transferData.payrollCodes.find((c) => c.id === transferCodeId)
            const selectedBranchName = selectedCode?.branchName ?? ''
            const expectedName = data.employee.displayName
            const nameMatch = transferConfirm.trim().toLowerCase() === expectedName.trim().toLowerCase()
            const canSubmit = !!transferCodeId && !!transferDate && nameMatch && !submittingTransfer

            return (
              <div style={{ ...cardStyle, border: '1px solid var(--border-emphasis)', marginBottom: 8 }}>
                <p style={{ ...cardLabelStyle, marginBottom: 16 }}>Transfer Branch</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {/* Step 1: Entity picker */}
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                      ENTITY
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {entityCodes.map((code) => (
                        <button
                          key={code}
                          onClick={() => { setTransferEntity(code); setTransferCodeId('') }}
                          style={{
                            padding: '5px 16px',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            border: transferEntity === code ? '1px solid #ff6b00' : '1px solid var(--border-emphasis)',
                            background: transferEntity === code ? 'rgba(255,107,0,0.15)' : 'var(--bg-secondary)',
                            color: transferEntity === code ? '#ff6b00' : 'var(--text-muted)',
                          }}
                        >
                          {code}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Step 2: Payroll code selector — only shown after entity chosen */}
                  {transferEntity && (
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                      DESTINATION PAYROLL CODE
                    </label>
                    <select
                      value={transferCodeId}
                      onChange={(e) => setTransferCodeId(e.target.value)}
                      style={{ ...selectStyle, width: '100%', maxWidth: 400 }}
                    >
                      <option value="">— select destination —</option>
                      {Object.entries(codesByBranch).sort(([a], [b]) => a.localeCompare(b)).map(([branchName, codes]) => (
                        <optgroup key={branchName} label={branchName}>
                          {codes.map((pc) => (
                            <option key={pc.id} value={pc.id}>
                              {pc.code} · {pc.laborType.replace(/_/g, ' ')}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  )}

                  {/* Effective date */}
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                      EFFECTIVE DATE (must be a Saturday)
                    </label>
                    <input
                      type="date"
                      value={transferDate}
                      onChange={(e) => setTransferDate(e.target.value)}
                      style={{ ...selectStyle, width: 180 }}
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                      NOTES (optional)
                    </label>
                    <input
                      type="text"
                      value={transferNotes}
                      onChange={(e) => setTransferNotes(e.target.value)}
                      placeholder="Reason for transfer…"
                      style={{ ...selectStyle, width: '100%', maxWidth: 400 }}
                    />
                  </div>

                  {/* Warning */}
                  {transferCodeId && transferDate && (
                    <div style={{
                      background: '#2a1a0a',
                      border: '1px solid #cc5500',
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: 12,
                      color: '#ff9944',
                      lineHeight: 1.5,
                    }}>
                      This will reassign all payroll and fuel transactions from{' '}
                      <strong>{formatPeriod(transferDate)}</strong> onward to{' '}
                      <strong>{selectedBranchName}</strong>. Transactions before this date will remain under the current branch. This cannot be undone without contacting an administrator.
                    </div>
                  )}

                  {/* Name confirmation */}
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                      TYPE &ldquo;{expectedName.toUpperCase()}&rdquo; TO CONFIRM
                    </label>
                    <input
                      type="text"
                      value={transferConfirm}
                      onChange={(e) => setTransferConfirm(e.target.value)}
                      placeholder={expectedName}
                      style={{
                        ...selectStyle,
                        width: '100%',
                        maxWidth: 300,
                        borderColor: transferConfirm && !nameMatch ? '#cc4444' : 'var(--bg-tertiary)',
                      }}
                    />
                  </div>

                  {transferError && (
                    <p style={{ color: '#cc4444', fontSize: 12, margin: 0 }}>{transferError}</p>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={submitTransfer}
                      disabled={!canSubmit}
                      style={{
                        background: canSubmit ? '#ff6b00' : 'var(--bg-secondary)',
                        color: canSubmit ? 'var(--text-primary)' : 'var(--text-faint)',
                        border: 'none',
                        borderRadius: 8,
                        padding: '7px 18px',
                        fontSize: 13,
                        cursor: canSubmit ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {submittingTransfer ? 'Transferring…' : 'Transfer Employee'}
                    </button>
                    <button
                      onClick={() => {
                        setShowTransferForm(false)
                        setTransferEntity('')
                        setTransferCodeId('')
                        setTransferDate('')
                        setTransferNotes('')
                        setTransferConfirm('')
                        setTransferError(null)
                      }}
                      style={{
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-secondary)',
                        border: 'none',
                        borderRadius: 8,
                        padding: '7px 18px',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* ── Allocation section (admin only) ── */}
      {isAdmin && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 32, marginBottom: 12 }}>
            <SectionHeader style={{ margin: 0 }}>Branch Allocation</SectionHeader>
            {!showAllocForm && (
              <button
                onClick={() => setShowAllocForm(true)}
                style={{ background: '#ff6b00', color: 'var(--text-primary)', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}
              >
                + Set Allocation
              </button>
            )}
          </div>

          {allocLoading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
          ) : allocations.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No active allocation — 100% home branch by default.</p>
          ) : (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Branch', 'Pct', 'From', 'To', 'Status'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 400, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((a) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px', color: '#ff6b00' }}>{a.branches?.name ?? a.branch_id}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{a.percentage}%</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{a.effective_from}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{a.effective_to ?? '—'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ background: a.status === 'approved' ? '#1a3a1a' : '#3a2a1a', color: a.status === 'approved' ? '#4caf50' : '#ff9800', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{a.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {overrides.length > 0 && (
            <>
              <p style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Weekly Overrides (last 52 weeks)</p>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Period', 'Branch', 'Pct', 'Status'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-dim)', fontWeight: 400, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.map((o) => (
                      <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{o.period_date}</td>
                        <td style={{ padding: '8px 12px', color: '#ff6b00' }}>{o.branches?.name ?? o.branch_id}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{o.percentage}%</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ background: o.status === 'approved' ? '#1a3a1a' : '#3a2a1a', color: o.status === 'approved' ? '#4caf50' : '#ff9800', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{o.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {showAllocForm && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-emphasis)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <p style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Set Default Allocation</p>
              {allocSplits.map((sp, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <select
                    value={sp.branchId}
                    onChange={(e) => { const s = [...allocSplits]; s[i] = { ...s[i], branchId: e.target.value }; setAllocSplits(s) }}
                    style={{ flex: 2, background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '6px 8px', fontSize: 13 }}
                  >
                    <option value="">Select branch…</option>
                    {availableBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={sp.percentage}
                    onChange={(e) => { const s = [...allocSplits]; s[i] = { ...s[i], percentage: Number(e.target.value) }; setAllocSplits(s) }}
                    style={{ width: 70, background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '6px 8px', fontSize: 13 }}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>%</span>
                  {allocSplits.length > 1 && (
                    <button onClick={() => setAllocSplits(allocSplits.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#cc4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ color: allocSplits.reduce((s, sp) => s + Number(sp.percentage), 0) === 100 ? '#4caf50' : '#cc4444', fontSize: 12 }}>
                  Total: {allocSplits.reduce((s, sp) => s + Number(sp.percentage), 0)}%
                </span>
                <button onClick={() => setAllocSplits([...allocSplits, { branchId: '', percentage: 0 }])} style={{ background: 'none', border: '1px solid var(--border-emphasis)', borderRadius: 6, color: 'var(--text-muted)', padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  + Branch
                </button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Effective From (Saturday)</label>
                <input
                  type="date"
                  value={allocEffectiveFrom}
                  onChange={(e) => setAllocEffectiveFrom(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '6px 8px', fontSize: 13 }}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Notes (optional)</label>
                <input
                  type="text"
                  value={allocNotes}
                  onChange={(e) => setAllocNotes(e.target.value)}
                  placeholder="Reason for split…"
                  style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, color: 'var(--text-secondary)', padding: '6px 8px', fontSize: 13 }}
                />
              </div>
              {allocError && <p style={{ color: '#cc4444', fontSize: 12, marginBottom: 8 }}>{allocError}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={submitAllocation} disabled={allocSaving} style={{ background: '#ff6b00', color: 'var(--text-primary)', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>
                  {allocSaving ? 'Saving…' : 'Save Allocation'}
                </button>
                <button onClick={() => { setShowAllocForm(false); setAllocError(null) }} style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Fuel section ── */}
      <SectionHeader style={{ marginTop: 32 }}>Fuel History</SectionHeader>

      {!hasFuel ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No fuel transactions found for this employee.</p>
      ) : (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value as typeof vendorFilter)}
              style={selectStyle}
            >
              <option value="all">All Vendors</option>
              <option value="interstate">Interstate</option>
              <option value="flyers">Flyers</option>
            </select>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
              style={selectStyle}
            >
              <option value="all">All Time</option>
              <option value="1y">Last 12 Months</option>
              <option value="90d">Last 90 Days</option>
            </select>
          </div>

          {/* Fuel summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            <SummaryCard label="Total Transactions" value={String(filteredFuel.length)} />
            <SummaryCard label="Total Gallons" value={`${totalGallons.toFixed(0)} gal`} />
            <SummaryCard label="Total Cost" value={formatCurrency(totalFuelCost)} />
          </div>

          {/* Fuel charts — cost and gallons side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={cardStyle}>
              <p style={cardLabelStyle}>Fuel Cost per Week (last 13)</p>
              <BarChart
                data={weeklyFuelCost}
                color="#cc4444"
                height={130}
                formatValue={(v) => formatCurrency(v)}
              />
            </div>
            <div style={cardStyle}>
              <p style={cardLabelStyle}>Gallons per Week (last 13)</p>
              <BarChart
                data={weeklyGallons}
                color="#ff6b00"
                height={130}
                formatValue={(v) => `${v.toFixed(0)} gal`}
              />
            </div>
          </div>

          {/* Location history table */}
          <div style={cardStyle}>
            <p style={{ ...cardLabelStyle, marginBottom: 12 }}>Transaction History</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'Vendor', 'Site', 'City, State', 'Product', 'Gallons', '$/Gal', 'Cost'].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredFuel.map((row, i) => (
                    <tr
                      key={row.id}
                      style={{
                        borderTop: '1px solid var(--border)',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <td style={tdStyle}>{formatPeriod(row.transactionDate)}</td>
                      <td style={{ ...tdStyle, textTransform: 'capitalize' }}>{row.vendor}</td>
                      <td style={tdStyle}>{row.siteName ?? '—'}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>
                        {[row.siteCity, row.siteState].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{row.product ?? '—'}</td>
                      <td style={tdStyle}>{row.gallons != null ? row.gallons.toFixed(3) : '—'}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{row.pricePerGallon != null ? `$${row.pricePerGallon.toFixed(3)}` : '—'}</td>
                      <td style={{ ...tdStyle, color: '#ff6b00' }}>{formatCurrency(row.totalWithTax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Pill({ children, color }: { children: React.ReactNode; color?: 'orange' }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 400,
        background: 'var(--bg-secondary)',
        color: color === 'orange' ? '#ff6b00' : 'var(--text-secondary)',
        border: '1px solid var(--border-emphasis)',
      }}
    >
      {children}
    </span>
  )
}

function SummaryCard({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={cardStyle}>
      <p style={cardLabelStyle}>{label}</p>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 500, color: muted ? 'var(--text-faint)' : 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function SectionHeader({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <h2
      style={{
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--text-primary)',
        margin: '0 0 12px 0',
        ...style,
      }}
    >
      {children}
    </h2>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  borderRadius: 12,
  border: '1px solid var(--border)',
  padding: 16,
}

const cardLabelStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: 11,
  fontWeight: 400,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 400,
  color: 'var(--text-dim)',
  paddingBottom: 8,
  paddingRight: 16,
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary)',
  padding: '8px 16px 8px 0',
  whiteSpace: 'nowrap',
}

const ltInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  fontSize: 12,
  padding: '6px 10px',
  outline: 'none',
  boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-emphasis)',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  fontSize: 12,
  padding: '5px 12px',
  cursor: 'pointer',
  outline: 'none',
}
