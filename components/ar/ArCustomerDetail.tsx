'use client'

import { useState, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { Role } from '@/lib/supabase/database.types'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Contact { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }
interface Note    { id: string; content: string; noteType: 'collection' | 'operation'; createdAt: string; createdByName: string | null }
interface PmAssignment { userId: string; displayName: string; role: string }
interface ArAssignment { userId: string; displayName: string; role: string }
interface EntityRef { entityCode: string; quickbooksName: string }
interface BranchSlice { name: string; total: number }

interface CustomerProfile {
  id: string
  displayName: string
  isExcluded: boolean
  customerStatus: string
  collectionStatus: string
  entityRefs: EntityRef[]
  contacts: Contact[]
  notes: Note[]
  pmAssignments: PmAssignment[]
  branchBreakdown: BranchSlice[]
}

interface Invoice {
  id: string; entity_code: string; invoice_number: string | null; po_number: string | null
  job_name: string | null; invoice_date: string | null; due_date: string | null; terms: string | null
  open_balance: number; aging_bucket: string; aging_days: number | null; raw_class_code: string | null
  branch: { id: string; name: string } | null
}

interface CustomerSummary {
  id: string; displayName: string; isExcluded: boolean
  current: number; d30: number; d60: number; d90: number; d90plus: number; totalAr: number; invoiceCount: number
}

interface SearchResult { id: string; displayName: string; entityRefs: EntityRef[] }

interface Props {
  customer: CustomerSummary
  entity: string
  role: Role
  onBack: () => void
  onRefresh: () => void
}

// ─── Status metadata ───────────────────────────────────────────────────────────

const CUSTOMER_STATUS_OPTIONS = [
  { value: 'active',      label: 'Active',       color: '#4caf50' },
  { value: 'inactive',    label: 'Inactive',      color: '#555'    },
  { value: 'one_time',    label: 'One Time',      color: '#888'    },
  { value: 'key_account', label: 'Key Account',   color: '#ff6b00' },
]

const COLLECTION_STATUS_OPTIONS = [
  { value: 'none',           label: 'None',                color: '#555',    priority: 0 },
  { value: 'promise_to_pay', label: 'Promise to Pay',      color: '#ff6b00', priority: 1 },
  { value: 'payment_plan',   label: 'Payment Plan',        color: '#ff6b00', priority: 1 },
  { value: 'legal',          label: 'Legal Action',        color: '#992222', priority: 1 },
  { value: 'collections',    label: 'Sent to Collections', color: '#cc4444', priority: 1 },
  { value: 'on_hold',        label: 'On Hold',             color: '#cc9900', priority: 2 },
  { value: 'dispute',        label: 'Dispute',             color: '#cc6600', priority: 2 },
  { value: 'write_off',      label: 'Write Off',           color: '#444',    priority: 3 },
]

const PRIORITY_LABEL: Record<number, string> = { 1: 'Critical', 2: 'High', 3: 'Low', 0: '' }

function getCustomerStatusMeta(v: string) {
  return CUSTOMER_STATUS_OPTIONS.find((o) => o.value === v) ?? CUSTOMER_STATUS_OPTIONS[0]
}
function getCollectionStatusMeta(v: string) {
  return COLLECTION_STATUS_OPTIONS.find((o) => o.value === v) ?? COLLECTION_STATUS_OPTIONS[0]
}

// ─── Chart palette ─────────────────────────────────────────────────────────────

const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '>90'] as const
const BUCKET_COLORS: Record<string, string> = {
  'Current': '#ff6b00', '1-30': '#cc9900', '31-60': '#cc6600', '61-90': '#cc4444', '>90': '#992222',
}
const BRANCH_PALETTE = ['#ff6b00', '#ff8c33', '#cc5500', '#e67300', '#b34400', '#804000', '#663300', '#997755']

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}
function fmtTs(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  )
}

// ─── Donut chart helper ────────────────────────────────────────────────────────

function DonutChart({ data, colors, centerLabel }: {
  data: { name: string; value: number }[]
  colors: string[]
  centerLabel?: string
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: '32px 0' }}>No data</div>

  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
          strokeWidth={0}
        >
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={13} fontWeight={500}>
          {centerLabel}
        </text>
        <Tooltip
          formatter={(value: number) => fmt(value)}
          contentStyle={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
          itemStyle={{ color: '#ccc' }}
          labelStyle={{ color: '#fff', fontWeight: 500 }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ─── Merge modal ───────────────────────────────────────────────────────────────

function MergeModal({ customerId, customerName, onClose, onMerged }: {
  customerId: string; customerName: string; onClose: () => void; onMerged: (name: string) => void
}) {
  const [q, setQ]                 = useState('')
  const [results, setResults]     = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected]   = useState<SearchResult | null>(null)
  const [merging, setMerging]     = useState(false)

  useEffect(() => {
    if (q.length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const res = await fetch(`/api/ar/customers/search?q=${encodeURIComponent(q)}&excludeId=${customerId}`)
      if (res.ok) setResults((await res.json()).customers ?? [])
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [q, customerId])

  const handleMerge = async () => {
    if (!selected) return
    setMerging(true)
    const res = await fetch(`/api/ar/customers/${customerId}/merge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceCustomerId: selected.id }),
    })
    if (res.ok) onMerged((await res.json()).mergedName)
    setMerging(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget && !merging) onClose() }}>
      <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 24, width: 500, maxWidth: '90vw' }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: '#fff', marginBottom: 4 }}>Link customer</div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
          Search for a customer to merge into <span style={{ color: '#ff6b00' }}>{customerName}</span>. Their invoices, contacts, and notes will be combined.
        </div>
        {!selected ? (
          <>
            <input autoFocus type="text" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ width: '100%', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 12 }} />
            {searching && <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: 16 }}>Searching…</div>}
            {!searching && q.length >= 2 && results.length === 0 && <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: 16 }}>No customers found</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
              {results.map((r) => (
                <div key={r.id} onClick={() => setSelected(r)}
                  style={{ background: '#2a2a2a', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', border: '1px solid #333' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#ff6b00')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#333')}>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{r.displayName}</div>
                  {r.entityRefs.length > 0 && <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>{r.entityRefs.map((ref) => `${ref.entityCode}: ${ref.quickbooksName}`).join(' · ')}</div>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#888', padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          </>
        ) : (
          <div>
            <div style={{ background: '#2a2a2a', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Merging into {customerName}:</div>
              <div style={{ fontSize: 14, color: '#ff6b00', fontWeight: 500 }}>{selected.displayName}</div>
              {selected.entityRefs.length > 0 && <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{selected.entityRefs.map((ref) => `${ref.entityCode}: ${ref.quickbooksName}`).join(' · ')}</div>}
            </div>
            <div style={{ fontSize: 12, color: '#cc4444', marginBottom: 16 }}>This will permanently delete the selected customer record. This cannot be undone.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setSelected(null)} disabled={merging} style={{ background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#888', padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Back</button>
              <button onClick={handleMerge} disabled={merging} style={{ background: '#ff6b00', border: 'none', borderRadius: 8, color: '#fff', padding: '7px 20px', fontSize: 13, fontWeight: 500, cursor: merging ? 'default' : 'pointer', opacity: merging ? 0.6 : 1 }}>
                {merging ? 'Merging…' : 'Confirm Merge'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Contact form ──────────────────────────────────────────────────────────────

function ContactForm({ customerId, onSaved, onCancel }: { customerId: string; onSaved: (c: Contact) => void; onCancel: () => void }) {
  const [name, setName]       = useState('')
  const [title, setTitle]     = useState('')
  const [email, setEmail]     = useState('')
  const [phone, setPhone]     = useState('')
  const [primary, setPrimary] = useState(false)
  const [saving, setSaving]   = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    const res = await fetch(`/api/ar/customers/${customerId}/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, title, email, phone, isPrimary: primary }),
    })
    if (res.ok) onSaved((await res.json()).contact)
    setSaving(false)
  }

  const inp = { background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '6px 10px', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box' as const }
  return (
    <div style={{ background: '#242424', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="ar-detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} style={inp} />
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={inp} />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
        <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} style={inp} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', cursor: 'pointer' }}>
          <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
          Primary contact
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid #333', borderRadius: 6, color: '#888', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving || !name.trim()}
          style={{ background: '#ff6b00', border: 'none', borderRadius: 6, color: '#fff', padding: '5px 14px', fontSize: 12, cursor: saving || !name.trim() ? 'default' : 'pointer', opacity: saving || !name.trim() ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function ArCustomerDetail({ customer, entity, role, onBack, onRefresh }: Props) {
  const isAdmin      = role === 'admin'
  const isArAdmin    = role === 'admin' || role === 'ar_manager'
  const canManagePMs = role === 'admin' || role === 'executive' || role === 'district_manager' || role === 'branch_manager'

  // All roles see both note sections; write access differs
  const canWriteCollectionNotes = isAdmin || role === 'ar_manager' || role === 'ar_team' || role === 'office_team' || role === 'executive'
  const canWriteOperationNotes  = isAdmin || role === 'executive' || role === 'district_manager' || role === 'branch_manager' || role === 'project_manager'

  const [profile, setProfile]           = useState<CustomerProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [invoices, setInvoices]         = useState<Invoice[]>([])
  const [invTotal, setInvTotal]         = useState(0)
  const [invPage, setInvPage]           = useState(1)
  const [invPageCount, setInvPageCount] = useState(0)
  const [invLoading, setInvLoading]     = useState(true)
  const [credits, setCredits]           = useState<Invoice[]>([])
  const [creditsLoading, setCreditsLoading] = useState(true)
  interface PmBranch { id: string; name: string; users: { id: string; displayName: string; role: string }[] }
  const [pmBranches, setPmBranches] = useState<PmBranch[]>([])
  const [arTeamUsers, setArTeamUsers]   = useState<{ id: string; displayName: string; role: string }[]>([])
  const [arAssignments, setArAssignments] = useState<ArAssignment[]>([])
  const [showMerge, setShowMerge]       = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [collectionNoteText, setCollectionNoteText]   = useState('')
  const [operationNoteText, setOperationNoteText]     = useState('')
  const [addingCollectionNote, setAddingCollectionNote] = useState(false)
  const [addingOperationNote, setAddingOperationNote]   = useState(false)
  const [togglingExclude, setTogglingExclude] = useState(false)

  const fetchProfile = useCallback(async () => {
    setProfileLoading(true)
    const res = await fetch(`/api/ar/customers/${customer.id}`)
    if (res.ok) setProfile((await res.json()).customer)
    setProfileLoading(false)
  }, [customer.id])

  useEffect(() => { fetchProfile() }, [fetchProfile])

  useEffect(() => {
    setInvLoading(true)
    const p = new URLSearchParams({ customerId: customer.id, page: String(invPage) })
    if (entity) p.set('entity', entity)
    fetch(`/api/ar/invoices?${p}`)
      .then((r) => r.json())
      .then((d) => { setInvoices(d.invoices ?? []); setInvTotal(d.total ?? 0); setInvPageCount(d.pageCount ?? 0) })
      .finally(() => setInvLoading(false))
  }, [customer.id, entity, invPage])

  useEffect(() => {
    setCreditsLoading(true)
    const p = new URLSearchParams({ customerId: customer.id, rowType: 'credit_memo' })
    if (entity) p.set('entity', entity)
    fetch(`/api/ar/invoices?${p}`)
      .then((r) => r.json())
      .then((d) => setCredits(d.invoices ?? []))
      .finally(() => setCreditsLoading(false))
  }, [customer.id, entity])

  useEffect(() => {
    if (!canManagePMs) return
    fetch(`/api/ar/pm-candidates?customerId=${customer.id}`)
      .then((r) => r.json())
      .then((d) => setPmBranches(d.branches ?? []))
  }, [canManagePMs, customer.id])

  useEffect(() => {
    if (!isArAdmin) return
    fetch('/api/ar/team-members')
      .then((r) => r.json())
      .then((d) => setArTeamUsers(d.users ?? []))
  }, [isArAdmin])

  useEffect(() => {
    fetch(`/api/ar/customers/${customer.id}/ar-assignments`)
      .then((r) => r.json())
      .then((d) => setArAssignments(d.assignments ?? []))
  }, [customer.id])

  const patchCustomer = async (payload: Record<string, unknown>) => {
    await fetch(`/api/ar/customers/${customer.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
  }

  const handleExcludeToggle = async () => {
    setTogglingExclude(true)
    await patchCustomer({ isExcluded: !profile?.isExcluded })
    setTogglingExclude(false)
    onRefresh()
  }

  const handleCustomerStatusChange = async (v: string) => {
    await patchCustomer({ customerStatus: v })
    setProfile((p) => p ? { ...p, customerStatus: v } : p)
  }

  const handleCollectionStatusChange = async (v: string) => {
    await patchCustomer({ collectionStatus: v })
    setProfile((p) => p ? { ...p, collectionStatus: v } : p)
  }

  const handleAddNote = async (noteType: 'collection' | 'operation') => {
    const text = noteType === 'collection' ? collectionNoteText : operationNoteText
    if (!text.trim()) return
    if (noteType === 'collection') setAddingCollectionNote(true)
    else setAddingOperationNote(true)
    const res = await fetch(`/api/ar/customers/${customer.id}/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.trim(), noteType }),
    })
    if (res.ok) {
      const { note } = await res.json()
      setProfile((p) => p ? { ...p, notes: [note, ...p.notes] } : p)
      if (noteType === 'collection') setCollectionNoteText('')
      else setOperationNoteText('')
    }
    if (noteType === 'collection') setAddingCollectionNote(false)
    else setAddingOperationNote(false)
  }

  const handleDeleteNote = async (noteId: string) => {
    await fetch(`/api/ar/customers/${customer.id}/notes/${noteId}`, { method: 'DELETE' })
    setProfile((p) => p ? { ...p, notes: p.notes.filter((n) => n.id !== noteId) } : p)
  }

  const handleContactSaved = (contact: Contact) => {
    setProfile((p) => p ? {
      ...p,
      contacts: [...p.contacts.filter((c) => !contact.isPrimary || !c.isPrimary), contact]
        .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)),
    } : p)
    setShowAddContact(false)
  }

  const handleDeleteContact = async (contactId: string) => {
    await fetch(`/api/ar/customers/${customer.id}/contacts/${contactId}`, { method: 'DELETE' })
    setProfile((p) => p ? { ...p, contacts: p.contacts.filter((c) => c.id !== contactId) } : p)
  }

  const handleAssignPm = async (userId: string) => {
    const res = await fetch(`/api/ar/customers/${customer.id}/pm-assignments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }),
    })
    if (res.ok) {
      const { pm } = await res.json()
      setProfile((p) => p ? { ...p, pmAssignments: [...p.pmAssignments, pm] } : p)
    }
  }

  const handleRemovePm = async (userId: string) => {
    await fetch(`/api/ar/customers/${customer.id}/pm-assignments/${userId}`, { method: 'DELETE' })
    setProfile((p) => p ? { ...p, pmAssignments: p.pmAssignments.filter((pm) => pm.userId !== userId) } : p)
  }

  const handleAssignAr = async (userId: string) => {
    const res = await fetch(`/api/ar/customers/${customer.id}/ar-assignments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }),
    })
    if (res.ok) {
      const { assignment } = await res.json()
      setArAssignments((prev) => [...prev, { userId: assignment.userId, displayName: assignment.displayName, role: assignment.role }])
    }
  }

  const handleRemoveAr = async (userId: string) => {
    await fetch(`/api/ar/customers/${customer.id}/ar-assignments/${userId}`, { method: 'DELETE' })
    setArAssignments((prev) => prev.filter((a) => a.userId !== userId))
  }

  // Chart data
  const agingChartData = [
    { name: 'Current', value: customer.current },
    { name: '1-30',    value: customer.d30     },
    { name: '31-60',   value: customer.d60     },
    { name: '61-90',   value: customer.d90     },
    { name: '>90',     value: customer.d90plus },
  ].filter((d) => d.value > 0)

  const branchChartData = (profile?.branchBreakdown ?? []).map((b) => ({ name: b.name, value: b.total }))

  const assignedPmIds = new Set(profile?.pmAssignments.map((pm) => pm.userId) ?? [])

  // Build branch groups with assigned users removed and duplicates collapsed
  const seenInDropdown = new Set<string>()
  const availablePmBranches = pmBranches
    .map((branch) => ({
      ...branch,
      users: branch.users.filter((u) => {
        if (assignedPmIds.has(u.id) || seenInDropdown.has(u.id)) return false
        seenInDropdown.add(u.id)
        return true
      }),
    }))
    .filter((b) => b.users.length > 0)

  const assignedArIds       = new Set(arAssignments.map((a) => a.userId))
  const availableArTeamUsers = arTeamUsers.filter((u) => !assignedArIds.has(u.id))

  const custStatusMeta = getCustomerStatusMeta(profile?.customerStatus ?? 'active')
  const collStatusMeta = getCollectionStatusMeta(profile?.collectionStatus ?? 'none')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Back + name + download row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack}
            style={{ background: '#2a2a2a', border: 'none', borderRadius: 8, color: '#ccc', padding: '6px 12px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
            ← Back
          </button>
          <div style={{ fontSize: 18, fontWeight: 500, color: profile?.isExcluded ? '#666' : '#fff', minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {customer.displayName}
          </div>
          <DownloadStatementButton customerId={customer.id} />
        </div>
        {/* Status badges row — wraps to next line naturally */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {isAdmin && profile ? (
            <select value={profile.customerStatus} onChange={(e) => handleCustomerStatusChange(e.target.value)}
              style={{ background: `${custStatusMeta.color}18`, border: `1px solid ${custStatusMeta.color}`, borderRadius: 8, color: custStatusMeta.color, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
              {CUSTOMER_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : profile && (
            <span style={{ background: `${custStatusMeta.color}18`, border: `1px solid ${custStatusMeta.color}`, borderRadius: 8, color: custStatusMeta.color, padding: '5px 10px', fontSize: 12 }}>
              {custStatusMeta.label}
            </span>
          )}
          {isArAdmin && profile ? (
            <select value={profile.collectionStatus} onChange={(e) => handleCollectionStatusChange(e.target.value)}
              style={{ background: `${collStatusMeta.color}18`, border: `1px solid ${collStatusMeta.color}`, borderRadius: 8, color: collStatusMeta.color, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
              {COLLECTION_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === 'none' ? 'No Collection Issue' : `${o.label}${o.priority > 0 ? ` (P${o.priority})` : ''}`}
                </option>
              ))}
            </select>
          ) : profile && profile.collectionStatus !== 'none' && (
            <span style={{ background: `${collStatusMeta.color}18`, border: `1px solid ${collStatusMeta.color}`, borderRadius: 8, color: collStatusMeta.color, padding: '5px 10px', fontSize: 12 }}>
              {collStatusMeta.label}
            </span>
          )}
          {isAdmin && (
            <button onClick={handleExcludeToggle} disabled={togglingExclude}
              style={{ background: profile?.isExcluded ? '#2a2a2a' : 'rgba(204,68,68,0.12)', border: `1px solid ${profile?.isExcluded ? '#333' : '#663333'}`, borderRadius: 8, color: profile?.isExcluded ? '#888' : '#cc4444', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
              {profile?.isExcluded ? 'Restore' : 'Exclude'}
            </button>
          )}
        </div>
      </div>

      {/* Aging cards row */}
      <div className="ar-aging-grid">
        <div style={{ background: profile?.isExcluded ? '#2a2a2a' : '#ff6b00', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: profile?.isExcluded ? '#555' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Total AR</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: profile?.isExcluded ? '#666' : '#fff' }}>{fmt(customer.totalAr)}</div>
        </div>
        {AGING_BUCKETS.map((b) => {
          const val = { Current: customer.current, '1-30': customer.d30, '31-60': customer.d60, '61-90': customer.d90, '>90': customer.d90plus }[b]
          return (
            <div key={b} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{b} days</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: val > 0 && !profile?.isExcluded ? BUCKET_COLORS[b] : '#444' }}>{fmt(val)}</div>
            </div>
          )
        })}
      </div>

      {/* Charts row */}
      <div className="ar-detail-grid">
        <SectionCard title="Aging Breakdown">
          <DonutChart
            data={agingChartData}
            colors={agingChartData.map((d) => BUCKET_COLORS[d.name] ?? '#888')}
            centerLabel={fmt(customer.totalAr)}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8 }}>
            {agingChartData.map((d) => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: BUCKET_COLORS[d.name] ?? '#888', flexShrink: 0 }} />
                <span style={{ color: '#888' }}>{d.name}</span>
                <span style={{ color: '#ccc' }}>{customer.totalAr > 0 ? ((d.value / customer.totalAr) * 100).toFixed(1) + '%' : '—'}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Branch Share">
          {profileLoading ? (
            <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: '64px 0' }}>Loading…</div>
          ) : (
            <>
              <DonutChart data={branchChartData} colors={BRANCH_PALETTE} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8 }}>
                {branchChartData.map((d, i) => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: BRANCH_PALETTE[i % BRANCH_PALETTE.length], flexShrink: 0 }} />
                    <span style={{ color: '#888' }}>{d.name}</span>
                    <span style={{ color: '#ccc' }}>{customer.totalAr > 0 ? ((d.value / customer.totalAr) * 100).toFixed(1) + '%' : '—'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>
      </div>

      {/* Profile sections grid */}
      <div className="ar-detail-grid">

        {/* Entity Links */}
        <SectionCard title="Entity Links"
          action={isAdmin ? (
            <button onClick={() => setShowMerge(true)}
              style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: '#ff6b00', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
              + Link customer
            </button>
          ) : undefined}>
          {profileLoading ? <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
            : (profile?.entityRefs ?? []).length === 0 ? <div style={{ fontSize: 12, color: '#555' }}>No entity refs found.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(profile?.entityRefs ?? []).map((ref, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#ff6b00', fontWeight: 500, minWidth: 32 }}>{ref.entityCode}</span>
                    <span style={{ fontSize: 12, color: '#888' }}>{ref.quickbooksName}</span>
                  </div>
                ))}
              </div>
            )}
        </SectionCard>

        {/* Project Managers */}
        <SectionCard title="Project Managers"
          action={canManagePMs && availablePmBranches.length > 0 ? (
            <select value="" onChange={(e) => { if (e.target.value) handleAssignPm(e.target.value) }}
              style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 6, color: '#ff6b00', padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>
              <option value="">+ Assign PM</option>
              {availablePmBranches.map((branch) => (
                <optgroup key={branch.id} label={branch.name}>
                  {branch.users.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : undefined}>
          {profileLoading ? <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
            : (profile?.pmAssignments ?? []).length === 0 ? <div style={{ fontSize: 12, color: '#555' }}>No PMs assigned.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(profile?.pmAssignments ?? []).map((pm) => (
                  <div key={pm.userId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#ccc' }}>{pm.displayName}</div>
                      <div style={{ fontSize: 11, color: '#555' }}>{pm.role.replace(/_/g, ' ')}</div>
                    </div>
                    {canManagePMs && (
                      <button onClick={() => handleRemovePm(pm.userId)}
                        style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
        </SectionCard>

        {/* AR Team Assignments — visible to all; manage controls for admin/ar_manager only */}
        {(() => {
          // Group available users by role for the dropdown
          const arManagers   = availableArTeamUsers.filter((u) => u.role === 'ar_manager')
          const arTeam       = availableArTeamUsers.filter((u) => u.role === 'ar_team')
          const officeTeam   = availableArTeamUsers.filter((u) => u.role === 'office_team')
          const hasAvailable = availableArTeamUsers.length > 0

          const roleBadge = (r: string) => {
            const label = r === 'ar_manager' ? 'Manager' : r === 'ar_team' ? 'AR Team' : r === 'office_team' ? 'Office' : r
            const color = r === 'ar_manager' ? '#ff6b00' : '#666666'
            return (
              <span style={{ fontSize: 10, color, background: 'rgba(255,255,255,0.06)', borderRadius: 3, padding: '1px 5px', fontWeight: 500 }}>
                {label}
              </span>
            )
          }

          return (
            <SectionCard title="AR Team"
              action={isArAdmin && hasAvailable ? (
                <select value="" onChange={(e) => { if (e.target.value) handleAssignAr(e.target.value) }}
                  style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 6, color: '#ff6b00', padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>
                  <option value="">+ Assign</option>
                  {arManagers.length > 0 && (
                    <optgroup label="AR Manager">
                      {arManagers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                    </optgroup>
                  )}
                  {arTeam.length > 0 && (
                    <optgroup label="AR Team">
                      {arTeam.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                    </optgroup>
                  )}
                  {officeTeam.length > 0 && (
                    <optgroup label="Office Team">
                      {officeTeam.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                    </optgroup>
                  )}
                </select>
              ) : undefined}>
              {arAssignments.length === 0 ? (
                <div style={{ fontSize: 12, color: '#555' }}>No team members assigned.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {arAssignments.map((a) => (
                    <div key={a.userId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: '#ccc' }}>{a.displayName}</span>
                        {roleBadge(a.role)}
                      </div>
                      {isArAdmin && (
                        <button onClick={() => handleRemoveAr(a.userId)}
                          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>×</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )
        })()}

        {/* Contacts */}
        <SectionCard title="Contacts"
          action={!showAddContact ? (
            <button onClick={() => setShowAddContact(true)}
              style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: '#ff6b00', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>+ Add</button>
          ) : undefined}>
          {showAddContact && <div style={{ marginBottom: 12 }}><ContactForm customerId={customer.id} onSaved={handleContactSaved} onCancel={() => setShowAddContact(false)} /></div>}
          {profileLoading ? <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
            : (profile?.contacts ?? []).length === 0 && !showAddContact ? <div style={{ fontSize: 12, color: '#555' }}>No contacts yet.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(profile?.contacts ?? []).map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, color: '#ccc', fontWeight: 500 }}>{c.name}</span>
                        {c.isPrimary && <span style={{ fontSize: 10, color: '#ff6b00', background: 'rgba(255,107,0,0.12)', borderRadius: 4, padding: '1px 6px' }}>Primary</span>}
                      </div>
                      {c.title && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{c.title}</div>}
                      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                        {c.email && <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: '#888', textDecoration: 'none' }}>{c.email}</a>}
                        {c.phone && <span style={{ fontSize: 11, color: '#888' }}>{c.phone}</span>}
                      </div>
                    </div>
                    {isArAdmin && (
                      <button onClick={() => handleDeleteContact(c.id)}
                        style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
        </SectionCard>

        {/* Collection Notes — write: admin/ar_manager/ar_team/executive; read-only: all other roles */}
        <SectionCard title="Collection Notes">
          {canWriteCollectionNotes && (
            <div style={{ marginBottom: 12 }}>
              <textarea placeholder="Add a collection note…" value={collectionNoteText} onChange={(e) => setCollectionNoteText(e.target.value)} rows={3}
                style={{ width: '100%', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button onClick={() => handleAddNote('collection')} disabled={addingCollectionNote || !collectionNoteText.trim()}
                  style={{ background: '#ff6b00', border: 'none', borderRadius: 6, color: '#fff', padding: '5px 14px', fontSize: 12, cursor: addingCollectionNote || !collectionNoteText.trim() ? 'default' : 'pointer', opacity: addingCollectionNote || !collectionNoteText.trim() ? 0.5 : 1 }}>
                  {addingCollectionNote ? 'Saving…' : 'Add Note'}
                </button>
              </div>
            </div>
          )}
          {profileLoading ? <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
            : (() => {
                const allCollection = (profile?.notes ?? []).filter((n) => n.noteType === 'collection')
                const shown = allCollection.slice(0, 5)
                const extra = allCollection.length - shown.length
                if (shown.length === 0) return <div style={{ fontSize: 12, color: '#555' }}>No collection notes yet.</div>
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {shown.map((n) => (
                      <div key={n.id} style={{ paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{n.content}</div>
                          {isArAdmin && (
                            <button onClick={() => handleDeleteNote(n.id)}
                              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>×</button>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{n.createdByName ?? 'Unknown'} · {fmtTs(n.createdAt)}</div>
                      </div>
                    ))}
                    {extra > 0 && (
                      <div style={{ fontSize: 11, color: '#444', textAlign: 'center', paddingTop: 2 }}>
                        {extra} older note{extra !== 1 ? 's' : ''} not shown
                      </div>
                    )}
                  </div>
                )
              })()}
        </SectionCard>

        {/* Operation Notes — write: admin/executive/district_manager/branch_manager/project_manager; read-only: ar_team/ar_manager */}
        <SectionCard title="Operation Notes">
          {canWriteOperationNotes && (
            <div style={{ marginBottom: 12 }}>
              <textarea placeholder="Add an operation note…" value={operationNoteText} onChange={(e) => setOperationNoteText(e.target.value)} rows={3}
                style={{ width: '100%', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button onClick={() => handleAddNote('operation')} disabled={addingOperationNote || !operationNoteText.trim()}
                  style={{ background: '#ff6b00', border: 'none', borderRadius: 6, color: '#fff', padding: '5px 14px', fontSize: 12, cursor: addingOperationNote || !operationNoteText.trim() ? 'default' : 'pointer', opacity: addingOperationNote || !operationNoteText.trim() ? 0.5 : 1 }}>
                  {addingOperationNote ? 'Saving…' : 'Add Note'}
                </button>
              </div>
            </div>
          )}
          {profileLoading ? <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
            : (() => {
                const allOperation = (profile?.notes ?? []).filter((n) => n.noteType === 'operation')
                const shown = allOperation.slice(0, 5)
                const extra = allOperation.length - shown.length
                if (shown.length === 0) return <div style={{ fontSize: 12, color: '#555' }}>No operation notes yet.</div>
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {shown.map((n) => (
                      <div key={n.id} style={{ paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{n.content}</div>
                          {isAdmin && (
                            <button onClick={() => handleDeleteNote(n.id)}
                              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>×</button>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{n.createdByName ?? 'Unknown'} · {fmtTs(n.createdAt)}</div>
                      </div>
                    ))}
                    {extra > 0 && (
                      <div style={{ fontSize: 11, color: '#444', textAlign: 'center', paddingTop: 2 }}>
                        {extra} older note{extra !== 1 ? 's' : ''} not shown
                      </div>
                    )}
                  </div>
                )
              })()}
        </SectionCard>
      </div>

      {/* Invoice table */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>Open Invoices</span>
          {invTotal > 0 && <span style={{ fontSize: 11, color: '#555' }}>{invTotal} total</span>}
        </div>
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                {['Invoice #', 'Entity', 'Branch', 'Job', 'PO #', 'Invoice Date', 'Due Date', 'Terms', 'Aging', 'Open Balance'].map((h) => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Open Balance' ? 'right' : 'left', fontSize: 11, color: '#666', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invLoading ? <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>Loading…</td></tr>
                : invoices.length === 0 ? <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>No invoices found</td></tr>
                : invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>{inv.invoice_number ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc' }}>{inv.entity_code}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                      {inv.branch?.name ?? <span style={{ color: '#555' }}>{inv.raw_class_code ?? '—'}</span>}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.job_name ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>{inv.po_number ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>{fmtDate(inv.invoice_date)}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>{fmtDate(inv.due_date)}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>{inv.terms ?? '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                      <span style={{ background: `${BUCKET_COLORS[inv.aging_bucket] ?? '#333'}22`, color: BUCKET_COLORS[inv.aging_bucket] ?? '#888', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{inv.aging_bucket}</span>
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#fff', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(inv.open_balance))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {invPageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid #2a2a2a' }}>
            <span style={{ fontSize: 12, color: '#666' }}>{invTotal} invoice{invTotal !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setInvPage((p) => Math.max(1, p - 1))} disabled={invPage === 1}
                style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: invPage === 1 ? '#444' : '#ccc', padding: '4px 10px', fontSize: 12, cursor: invPage === 1 ? 'default' : 'pointer' }}>‹</button>
              <span style={{ fontSize: 12, color: '#888', padding: '4px 8px' }}>{invPage} / {invPageCount}</span>
              <button onClick={() => setInvPage((p) => Math.min(invPageCount, p + 1))} disabled={invPage === invPageCount}
                style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: invPage === invPageCount ? '#444' : '#ccc', padding: '4px 10px', fontSize: 12, cursor: invPage === invPageCount ? 'default' : 'pointer' }}>›</button>
            </div>
          </div>
        )}
      </div>

      {/* Credits table — only rendered if there are any */}
      {(creditsLoading || credits.length > 0) && (
        <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>Credits</span>
            {credits.length > 0 && (
              <>
                <span style={{ fontSize: 11, color: '#555' }}>{credits.length} total</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#ff6b00', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(credits.reduce((s, c) => s + Math.abs(Number(c.open_balance)), 0))}
                </span>
              </>
            )}
          </div>
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                  {['Credit #', 'Entity', 'Branch', 'Job', 'PO #', 'Date', 'Credit Amount'].map((h) => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Credit Amount' ? 'right' : 'left', fontSize: 11, color: '#666', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {creditsLoading
                  ? <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>Loading…</td></tr>
                  : credits.map((cr) => (
                    <tr key={cr.id} style={{ borderBottom: '1px solid #222', background: 'rgba(255,107,0,0.03)' }}>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#ff6b00', whiteSpace: 'nowrap' }}>{cr.invoice_number ?? '—'}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc' }}>{cr.entity_code}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                        {cr.branch?.name ?? <span style={{ color: '#555' }}>{cr.raw_class_code ?? '—'}</span>}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cr.job_name ?? '—'}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>{cr.po_number ?? '—'}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>{fmtDate(cr.invoice_date)}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#ff6b00', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        ({fmt(Math.abs(Number(cr.open_balance)))})
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showMerge && profile && (
        <MergeModal customerId={customer.id} customerName={customer.displayName} onClose={() => setShowMerge(false)}
          onMerged={(name) => { setShowMerge(false); fetchProfile(); alert(`Merged "${name}" into ${customer.displayName}.`) }} />
      )}
    </div>
  )
}

// ── Download Statement Button ──────────────────────────────────────────────────

function DownloadStatementButton({ customerId }: { customerId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleDownload() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ar/customers/${customerId}/statement`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError((json as { error?: string }).error ?? 'Failed to generate statement')
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      a.download = match?.[1] ?? 'statement.pdf'
      a.href = url
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={handleDownload}
        disabled={loading}
        title="Download PDF Statement"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: loading ? '#2a2a2a' : '#ff6b00',
          border: 'none', borderRadius: 8,
          color: '#fff', padding: '6px 14px',
          fontSize: 12, fontWeight: 500,
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? 0.7 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {loading ? (
          <>
            <span style={{ fontSize: 13 }}>⏳</span>
            Generating…
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Statement
          </>
        )}
      </button>
      {error && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 20,
          background: '#2a2a2a', border: '1px solid #cc4444', borderRadius: 8,
          padding: '8px 12px', fontSize: 11, color: '#cc4444',
          whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {error}
          <button onClick={() => setError(null)}
            style={{ marginLeft: 8, background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11 }}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
