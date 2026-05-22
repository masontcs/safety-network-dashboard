'use client'

import React, { useState, useEffect, useCallback } from 'react'
// recharts removed — charts replaced with inline bar strips
import type { Role } from '@/lib/supabase/database.types'
import { createBrowserClient } from '@/lib/supabase/client'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Contact { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }
interface Note    {
  id: string; content: string; noteType: 'collection' | 'operation'; createdAt: string; createdByName: string | null
  createdBy: string | null; editedAt: string | null
  communicationType: string | null; contactName: string | null; outcome: string | null; isPinned: boolean
}
interface InvoiceNote {
  id: string; content: string; createdAt: string; createdByName: string | null
}
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
  collectionPhase: string
  contactFrequency: string | null
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
  invoice_status: string | null
  branch: { id: string; name: string } | null
}

const INVOICE_STATUS_OPTIONS = [
  { value: 'disputed',        label: 'Disputed',         color: '#cc4444' },
  { value: 'short_pay',       label: 'Short Pay',        color: '#cc6600' },
  { value: 'payment_pending', label: 'Payment Pending',  color: '#cc9900' },
  { value: 'lien_filed',      label: 'Lien Filed',       color: '#cc4444' },
  { value: 'in_legal',        label: 'In Legal',         color: '#992222' },
  { value: 'write_off',       label: 'Write-Off',        color: '#555555' },
]
function getInvStatusMeta(v: string) {
  return INVOICE_STATUS_OPTIONS.find((o) => o.value === v) ?? null
}

interface CustomerSummary {
  id: string; displayName: string; isExcluded: boolean
  current: number; d30: number; d60: number; d90: number; d90plus: number; totalAr: number; invoiceCount: number
}


interface SearchResult { id: string; displayName: string; entityRefs: EntityRef[] }

interface Branch { id: string; name: string }

interface Props {
  customer: CustomerSummary
  entity: string
  role: Role
  branches: Branch[]
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

const COLLECTION_PHASE_OPTIONS = [
  { value: 'collection_team',  label: 'Collection Team',  color: '#888888' },
  { value: 'branch_manager',   label: 'Branch Manager',   color: '#cc9900' },
  { value: 'vp_high_level',    label: 'VP / High Level',  color: '#ff6b00' },
  { value: 'do_not_contact',   label: 'Do Not Contact',   color: '#cc4444' },
  { value: 'pending_write_off', label: 'Pending Write-Off', color: '#555555' },
]

const CONTACT_FREQUENCY_OPTIONS = [
  { value: 'weekly',        label: 'Weekly'         },
  { value: 'bi_weekly',     label: 'Bi-Weekly'      },
  { value: 'monthly',       label: 'Monthly'        },
  { value: 'portal',        label: 'Portal'         },
  { value: 'paid_when_paid', label: 'Paid When Paid' },
  { value: 'do_not_call',   label: 'Do Not Call'    },
]

const COMMUNICATION_TYPE_OPTIONS = [
  { value: 'email',      label: 'Email'      },
  { value: 'phone_call', label: 'Phone Call' },
  { value: 'text',       label: 'Text'       },
  { value: 'in_person',  label: 'In Person'  },
  { value: 'portal',     label: 'Portal'     },
]

const OUTCOME_OPTIONS = [
  { value: 'positive',        label: 'Positive',         color: '#4caf50' },
  { value: 'needs_follow_up', label: 'Needs Follow-Up',  color: '#cc9900' },
  { value: 'promise_to_pay',  label: 'Promise to Pay',   color: '#ff6b00' },
  { value: 'no_answer',       label: 'No Answer',        color: '#555555' },
  { value: 'unproductive',    label: 'Unproductive',     color: '#666666' },
  { value: 'roadblock',       label: 'Roadblock',        color: '#cc4444' },
  { value: 'escalated',       label: 'Escalated',        color: '#cc4444' },
]

function getCustomerStatusMeta(v: string) {
  return CUSTOMER_STATUS_OPTIONS.find((o) => o.value === v) ?? CUSTOMER_STATUS_OPTIONS[0]
}
function getCollectionStatusMeta(v: string) {
  return COLLECTION_STATUS_OPTIONS.find((o) => o.value === v) ?? COLLECTION_STATUS_OPTIONS[0]
}
function getCollectionPhaseMeta(v: string) {
  return COLLECTION_PHASE_OPTIONS.find((o) => o.value === v) ?? COLLECTION_PHASE_OPTIONS[0]
}
function getOutcomeMeta(v: string) {
  return OUTCOME_OPTIONS.find((o) => o.value === v) ?? null
}
function getCommTypeLabel(v: string) {
  return COMMUNICATION_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v
}
function getFrequencyLabel(v: string) {
  return CONTACT_FREQUENCY_OPTIONS.find((o) => o.value === v)?.label ?? v
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

// Lightweight section header used inside the sidebar card (no chrome, just a label)
function SidebarSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: '#555', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
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

export default function ArCustomerDetail({ customer, entity, role, branches, onBack, onRefresh }: Props) {
  const isAdmin            = role === 'admin'
  const isArAdmin          = role === 'admin' || role === 'ar_manager'
  // AR team/manager + executive + admin can change all customer statuses and mark as excluded
  const canManageStatuses  = role === 'admin' || role === 'executive' || role === 'ar_manager' || role === 'ar_team'
  const canManagePMs       = role === 'admin' || role === 'executive' || role === 'district_manager' || role === 'branch_manager'

  // All roles see both note sections; write access differs
  const canWriteCollectionNotes = isAdmin || role === 'ar_manager' || role === 'ar_team' || role === 'office_team' || role === 'executive'
  const canWriteOperationNotes  = isAdmin || role === 'executive' || role === 'district_manager' || role === 'branch_manager' || role === 'project_manager' || role === 'sales'

  const [profile, setProfile]           = useState<CustomerProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [invoices, setInvoices]         = useState<Invoice[]>([])
  const [invTotal, setInvTotal]         = useState(0)
  const [invPage, setInvPage]           = useState(1)
  const [invPageCount, setInvPageCount] = useState(0)
  const [invLoading, setInvLoading]     = useState(true)
  const [invBranchId, setInvBranchId]   = useState('')
  const [invBranchOptions, setInvBranchOptions] = useState<{ id: string; name: string }[]>([])
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
  // Collection note form extras
  const [collCommType, setCollCommType]   = useState('')
  const [collContactName, setCollContactName] = useState('')
  const [collOutcome, setCollOutcome]     = useState('')
  // Operation note form extras
  const [opCommType, setOpCommType]       = useState('')
  const [opContactName, setOpContactName] = useState('')
  const [opOutcome, setOpOutcome]         = useState('')

  // Current logged-in user ID (for note ownership checks)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  useEffect(() => {
    createBrowserClient().auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null))
  }, [])

  // Note inline editing state
  const [editingNoteId, setEditingNoteId]         = useState<string | null>(null)
  const [editingNoteContent, setEditingNoteContent] = useState('')
  const [savingNoteEdit, setSavingNoteEdit]         = useState(false)

  // Invoice notes expansion
  const [expandedInvId, setExpandedInvId]   = useState<string | null>(null)
  const [invNotes, setInvNotes]             = useState<Record<string, InvoiceNote[]>>({})
  const [invNotesLoading, setInvNotesLoading] = useState<Record<string, boolean>>({})
  const [invNoteText, setInvNoteText]       = useState('')
  const [addingInvNote, setAddingInvNote]   = useState(false)

  // Invoice date override editing
  const [editingDateInvId, setEditingDateInvId] = useState<string | null>(null)
  const [editingDateValue, setEditingDateValue]  = useState('')
  const [savingDate, setSavingDate]              = useState(false)

  const handleSaveInvoiceDate = async (inv: Invoice) => {
    if (!editingDateValue) return
    setSavingDate(true)
    try {
      const res = await fetch(`/api/ar/invoices/${inv.id}/date`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: editingDateValue }),
      })
      if (res.ok) {
        // Update local state immediately
        setInvoices((prev) =>
          prev.map((i) => i.id === inv.id ? { ...i, invoice_date: editingDateValue } : i)
        )
        setEditingDateInvId(null)
        setEditingDateValue('')
      }
    } finally {
      setSavingDate(false)
    }
  }

  const fetchProfile = useCallback(async () => {
    setProfileLoading(true)
    const res = await fetch(`/api/ar/customers/${customer.id}`)
    if (res.ok) setProfile((await res.json()).customer)
    setProfileLoading(false)
  }, [customer.id])

  useEffect(() => { fetchProfile() }, [fetchProfile])

  // Reset page when branch filter changes
  useEffect(() => { setInvPage(1) }, [invBranchId])

  useEffect(() => {
    setInvLoading(true)
    const p = new URLSearchParams({ customerId: customer.id, page: String(invPage) })
    if (entity)      p.set('entity', entity)
    if (invBranchId) p.set('branchId', invBranchId)
    fetch(`/api/ar/invoices?${p}`)
      .then((r) => r.json())
      .then((d) => {
        setInvoices(d.invoices ?? [])
        setInvTotal(d.total ?? 0)
        setInvPageCount(d.pageCount ?? 0)
        // branchOptions is returned on every fetch but only populated server-side
        // when customerId is set; update only when unfiltered so the list stays complete
        if (!invBranchId && Array.isArray(d.branchOptions)) setInvBranchOptions(d.branchOptions)
      })
      .finally(() => setInvLoading(false))
  }, [customer.id, entity, invPage, invBranchId])

  useEffect(() => {
    setCreditsLoading(true)
    const p = new URLSearchParams({ customerId: customer.id, rowType: 'credit_memo' })
    if (entity)      p.set('entity', entity)
    if (invBranchId) p.set('branchId', invBranchId)
    fetch(`/api/ar/invoices?${p}`)
      .then((r) => r.json())
      .then((d) => setCredits(d.invoices ?? []))
      .finally(() => setCreditsLoading(false))
  }, [customer.id, entity, invBranchId])

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

  // ── Realtime subscriptions ──────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createBrowserClient()

    const channel = supabase
      .channel(`ar-customer-${customer.id}`)

      // ── New collection note from another user ──────────────────────────────
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'ar_customer_notes',
        filter: `customer_id=eq.${customer.id}`,
      }, async (payload) => {
        const row = payload.new as Record<string, unknown>
        // Skip notes that were added by this session (already in state via optimistic update)
        setProfile((p) => {
          if (!p || p.notes.some((n) => n.id === row.id)) return p
          return p // will be updated after author lookup below
        })
        let createdByName: string | null = null
        if (row.created_by) {
          const { data } = await supabase
            .from('user_profiles')
            .select('display_name')
            .eq('id', row.created_by as string)
            .single()
          createdByName = (data as { display_name: string } | null)?.display_name ?? null
        }
        setProfile((p) => {
          if (!p || p.notes.some((n) => n.id === row.id)) return p
          const note: Note = {
            id:                row.id as string,
            content:           row.content as string,
            noteType:          (row.note_type as 'collection' | 'operation') ?? 'collection',
            createdAt:         row.created_at as string,
            editedAt:          (row.edited_at as string | null) ?? null,
            createdBy:         (row.created_by as string | null) ?? null,
            createdByName,
            communicationType: (row.communication_type as string | null) ?? null,
            contactName:       (row.contact_name as string | null) ?? null,
            outcome:           (row.outcome as string | null) ?? null,
            isPinned:          !!(row.is_pinned),
          }
          return { ...p, notes: [note, ...p.notes] }
        })
      })

      // ── Note updated (pin/unpin or content edit) by another user ─────────
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'ar_customer_notes',
        filter: `customer_id=eq.${customer.id}`,
      }, (payload) => {
        const row = payload.new as Record<string, unknown>
        setProfile((p) => p ? {
          ...p,
          notes: p.notes.map((n) => n.id === row.id ? {
            ...n,
            isPinned: !!row.is_pinned,
            content:  (row.content as string) ?? n.content,
            editedAt: (row.edited_at as string | null) ?? n.editedAt,
          } : n),
        } : p)
      })

      // ── Note deleted by another user ───────────────────────────────────────
      .on('postgres_changes', {
        event:  'DELETE',
        schema: 'public',
        table:  'ar_customer_notes',
        filter: `customer_id=eq.${customer.id}`,
      }, (payload) => {
        const row = payload.old as Record<string, unknown>
        setProfile((p) => p ? { ...p, notes: p.notes.filter((n) => n.id !== row.id) } : p)
      })

      // ── Customer status / phase / frequency updated by another user ────────
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'ar_customers',
        filter: `id=eq.${customer.id}`,
      }, (payload) => {
        const row = payload.new as Record<string, unknown>
        setProfile((p) => p ? {
          ...p,
          customerStatus:   (row.customer_status   as string) ?? p.customerStatus,
          collectionStatus: (row.collection_status as string) ?? p.collectionStatus,
          collectionPhase:  (row.collection_phase  as string) ?? p.collectionPhase,
          contactFrequency: (row.contact_frequency as string | null) ?? p.contactFrequency,
          isExcluded:       typeof row.is_excluded === 'boolean' ? row.is_excluded : p.isExcluded,
        } : p)
      })

      // ── AR team assignment changed by another user ─────────────────────────
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  'ar_customer_assignments',
        filter: `customer_id=eq.${customer.id}`,
      }, () => {
        fetch(`/api/ar/customers/${customer.id}/ar-assignments`)
          .then((r) => r.json())
          .then((d) => setArAssignments(d.assignments ?? []))
      })

      .subscribe()

    return () => { supabase.removeChannel(channel) }
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

  const handleCollectionPhaseChange = async (v: string) => {
    await patchCustomer({ collectionPhase: v })
    setProfile((p) => p ? { ...p, collectionPhase: v } : p)
  }

  const handleContactFrequencyChange = async (v: string) => {
    const val = v || null
    await patchCustomer({ contactFrequency: val })
    setProfile((p) => p ? { ...p, contactFrequency: val } : p)
  }

  const handleAddNote = async (noteType: 'collection' | 'operation') => {
    const text = noteType === 'collection' ? collectionNoteText : operationNoteText
    if (!text.trim()) return
    if (noteType === 'collection') setAddingCollectionNote(true)
    else setAddingOperationNote(true)
    const res = await fetch(`/api/ar/customers/${customer.id}/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text.trim(),
        noteType,
        communicationType: noteType === 'collection' ? (collCommType || null) : (opCommType || null),
        contactName:       noteType === 'collection' ? (collContactName.trim() || null) : (opContactName.trim() || null),
        outcome:           noteType === 'collection' ? (collOutcome || null) : (opOutcome || null),
      }),
    })
    if (res.ok) {
      const { note } = await res.json()
      const noteWithPin = { ...note, isPinned: note.isPinned ?? false }
      // Realtime may have already inserted this note — deduplicate
      setProfile((p) => {
        if (!p) return p
        if (p.notes.some((n) => n.id === noteWithPin.id)) return p
        return { ...p, notes: [noteWithPin, ...p.notes] }
      })
      if (noteType === 'collection') {
        setCollectionNoteText('')
        setCollCommType('')
        setCollContactName('')
        setCollOutcome('')
      } else {
        setOperationNoteText('')
        setOpCommType('')
        setOpContactName('')
        setOpOutcome('')
      }
    }
    if (noteType === 'collection') setAddingCollectionNote(false)
    else setAddingOperationNote(false)
  }

  const handleEditNote = async (noteId: string) => {
    const content = editingNoteContent.trim()
    if (!content) return
    setSavingNoteEdit(true)
    const res = await fetch(`/api/ar/customers/${customer.id}/notes/${noteId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (res.ok) {
      const { editedAt } = await res.json()
      setProfile((p) => p ? {
        ...p,
        notes: p.notes.map((n) => n.id === noteId ? { ...n, content, editedAt: editedAt ?? new Date().toISOString() } : n),
      } : p)
      setEditingNoteId(null)
    }
    setSavingNoteEdit(false)
  }

  const handleDeleteNote = async (noteId: string) => {
    await fetch(`/api/ar/customers/${customer.id}/notes/${noteId}`, { method: 'DELETE' })
    setProfile((p) => p ? { ...p, notes: p.notes.filter((n) => n.id !== noteId) } : p)
  }

  const handlePinNote = async (noteId: string, pin: boolean) => {
    await fetch(`/api/ar/customers/${customer.id}/notes/${noteId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPinned: pin }),
    })
    setProfile((p) => p ? { ...p, notes: p.notes.map((n) => n.id === noteId ? { ...n, isPinned: pin } : n) } : p)
  }

  const loadInvNotes = async (invoiceId: string) => {
    setInvNotesLoading((p) => ({ ...p, [invoiceId]: true }))
    const res = await fetch(`/api/ar/invoices/${invoiceId}/notes`)
    if (res.ok) {
      const { notes } = await res.json()
      setInvNotes((p) => ({ ...p, [invoiceId]: notes }))
    }
    setInvNotesLoading((p) => ({ ...p, [invoiceId]: false }))
  }

  const handleToggleInv = (invoiceId: string) => {
    if (expandedInvId === invoiceId) {
      setExpandedInvId(null)
    } else {
      setExpandedInvId(invoiceId)
      setInvNoteText('')
      if (!invNotes[invoiceId]) loadInvNotes(invoiceId)
    }
  }

  const handleInvStatusChange = async (invoiceId: string, status: string) => {
    await fetch(`/api/ar/invoices/${invoiceId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceStatus: status || null }),
    })
    setInvoices((prev) => prev.map((inv) => inv.id === invoiceId ? { ...inv, invoice_status: status || null } : inv))
  }

  const handleAddInvNote = async (invoiceId: string) => {
    if (!invNoteText.trim()) return
    setAddingInvNote(true)
    const res = await fetch(`/api/ar/invoices/${invoiceId}/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: invNoteText.trim() }),
    })
    if (res.ok) {
      const { note } = await res.json()
      setInvNotes((p) => ({ ...p, [invoiceId]: [note, ...(p[invoiceId] ?? [])] }))
      setInvNoteText('')
    }
    setAddingInvNote(false)
  }

  const handleDeleteInvNote = async (invoiceId: string, noteId: string) => {
    await fetch(`/api/ar/invoices/${invoiceId}/notes/${noteId}`, { method: 'DELETE' })
    setInvNotes((p) => ({ ...p, [invoiceId]: (p[invoiceId] ?? []).filter((n) => n.id !== noteId) }))
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

  const assignedArIds        = new Set(arAssignments.map((a) => a.userId))
  const availableArTeamUsers = arTeamUsers.filter((u) => !assignedArIds.has(u.id))

  // AR Team dropdown groups
  const arManagers    = availableArTeamUsers.filter((u) => u.role === 'ar_manager')
  const arTeamMembers = availableArTeamUsers.filter((u) => u.role === 'ar_team')
  const officeTeam    = availableArTeamUsers.filter((u) => u.role === 'office_team')
  const hasAvailableAr = availableArTeamUsers.length > 0

  const roleBadge = (r: string) => {
    const label = r === 'ar_manager' ? 'Manager' : r === 'ar_team' ? 'AR Team' : r === 'office_team' ? 'Office' : r
    const color = r === 'ar_manager' ? '#ff6b00' : '#666666'
    return (
      <span style={{ fontSize: 10, color, background: 'rgba(255,255,255,0.06)', borderRadius: 3, padding: '1px 5px', fontWeight: 500 }}>
        {label}
      </span>
    )
  }

  const custStatusMeta  = getCustomerStatusMeta(profile?.customerStatus ?? 'active')
  const collStatusMeta  = getCollectionStatusMeta(profile?.collectionStatus ?? 'none')
  const collPhaseMeta   = getCollectionPhaseMeta(profile?.collectionPhase ?? 'collection_team')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── HERO HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ background: '#1a1a1a', borderRadius: 12, border: '1px solid #2a2a2a', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Row 1: Back / Name / Excluded badge / Download */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack}
            style={{ background: '#2a2a2a', border: 'none', borderRadius: 8, color: '#ccc', padding: '6px 12px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
            ← Back
          </button>
          <div style={{ flex: 1, fontSize: 20, fontWeight: 500, color: profile?.isExcluded ? '#666' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {customer.displayName}
          </div>
          {profile?.isExcluded && (
            <span style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 6, color: '#555', padding: '3px 10px', fontSize: 11, flexShrink: 0 }}>
              Excluded
            </span>
          )}
          <DownloadStatementButton customerId={customer.id} />
        </div>

        {/* Row 2: Status controls — flowing, no heavy box */}
        {profile && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'flex-end' }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Account</span>
              {canManageStatuses ? (
                <select value={profile.customerStatus} onChange={(e) => handleCustomerStatusChange(e.target.value)}
                  style={{ background: `${custStatusMeta.color}18`, border: `1px solid ${custStatusMeta.color}`, borderRadius: 7, color: custStatusMeta.color, padding: '4px 9px', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                  {CUSTOMER_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <span style={{ background: `${custStatusMeta.color}18`, border: `1px solid ${custStatusMeta.color}`, borderRadius: 7, color: custStatusMeta.color, padding: '4px 9px', fontSize: 12 }}>
                  {custStatusMeta.label}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Collection Issue</span>
              {canManageStatuses ? (
                <select value={profile.collectionStatus} onChange={(e) => handleCollectionStatusChange(e.target.value)}
                  style={{ background: `${collStatusMeta.color}18`, border: `1px solid ${collStatusMeta.color}`, borderRadius: 7, color: collStatusMeta.color, padding: '4px 9px', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                  {COLLECTION_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value === 'none' ? 'No Issue' : `${o.label}${o.priority > 0 ? ` · P${o.priority}` : ''}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ background: `${collStatusMeta.color}18`, border: `1px solid ${collStatusMeta.color}`, borderRadius: 7, color: collStatusMeta.color, padding: '4px 9px', fontSize: 12 }}>
                  {profile.collectionStatus === 'none' ? 'No Issue' : collStatusMeta.label}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Escalation</span>
              {canManageStatuses ? (
                <select value={profile.collectionPhase} onChange={(e) => handleCollectionPhaseChange(e.target.value)}
                  style={{ background: `${collPhaseMeta.color}18`, border: `1px solid ${collPhaseMeta.color}55`, borderRadius: 7, color: collPhaseMeta.color, padding: '4px 9px', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                  {COLLECTION_PHASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <span style={{ background: `${collPhaseMeta.color}18`, border: `1px solid ${collPhaseMeta.color}55`, borderRadius: 7, color: collPhaseMeta.color, padding: '4px 9px', fontSize: 12 }}>
                  {collPhaseMeta.label}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Contact Freq.</span>
              {canManageStatuses ? (
                <select value={profile.contactFrequency ?? ''} onChange={(e) => handleContactFrequencyChange(e.target.value)}
                  style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 7, color: profile.contactFrequency ? '#cccccc' : '#555', padding: '4px 9px', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                  <option value=''>Not Set</option>
                  {CONTACT_FREQUENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <span style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 7, color: '#888', padding: '4px 9px', fontSize: 12 }}>
                  {profile.contactFrequency ? getFrequencyLabel(profile.contactFrequency) : 'Not Set'}
                </span>
              )}
            </div>

            {canManageStatuses && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Visibility</span>
                <button onClick={handleExcludeToggle} disabled={togglingExclude}
                  style={{ background: profile.isExcluded ? '#2a2a2a' : 'rgba(204,68,68,0.12)', border: `1px solid ${profile.isExcluded ? '#333' : '#663333'}`, borderRadius: 7, color: profile.isExcluded ? '#888' : '#cc4444', padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>
                  {profile.isExcluded ? 'Restore' : 'Exclude'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── ANALYTICS STRIP ─────────────────────────────────────────────────── */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* Total AR — hero number */}
          <div style={{ flexShrink: 0, minWidth: 110 }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Total AR</div>
            <div style={{ fontSize: 28, fontWeight: 600, color: profile?.isExcluded ? '#555' : '#ff6b00', lineHeight: 1 }}>{fmt(customer.totalAr)}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 5 }}>{customer.invoiceCount} invoice{customer.invoiceCount !== 1 ? 's' : ''}</div>
          </div>

          <div style={{ width: 1, alignSelf: 'stretch', background: '#2a2a2a', flexShrink: 0 }} />

          {/* Aging breakdown — numbers + bar */}
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
              {AGING_BUCKETS.map((b) => {
                const val = { Current: customer.current, '1-30': customer.d30, '31-60': customer.d60, '61-90': customer.d90, '>90': customer.d90plus }[b]
                return (
                  <div key={b}>
                    <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{b}</div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: (val ?? 0) > 0 && !profile?.isExcluded ? BUCKET_COLORS[b] : '#333' }}>{fmt(val ?? 0)}</div>
                  </div>
                )
              })}
            </div>
            {/* Horizontal aging bar */}
            {customer.totalAr > 0 && (
              <div style={{ height: 5, borderRadius: 3, display: 'flex', overflow: 'hidden', gap: 1 }}>
                {AGING_BUCKETS.map((b) => {
                  const val = { Current: customer.current, '1-30': customer.d30, '31-60': customer.d60, '61-90': customer.d90, '>90': customer.d90plus }[b] ?? 0
                  if (val <= 0) return null
                  return <div key={b} style={{ flex: val / customer.totalAr, background: profile?.isExcluded ? '#2a2a2a' : BUCKET_COLORS[b] }} />
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main content: 2-column asymmetric layout ───────────────────────── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* Left column — Notes (wider) */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Collection Notes — write: admin/ar_manager/ar_team/executive; read-only: all other roles */}
        <SectionCard title="Collection Notes">
          {canWriteCollectionNotes && (
            <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Row 1: comm type + contact name */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>How Contacted</span>
                  <select value={collCommType} onChange={(e) => setCollCommType(e.target.value)}
                    style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: collCommType ? '#ccc' : '#555', padding: '6px 10px', fontSize: 12, outline: 'none' }}>
                    <option value=''>Not specified</option>
                    {COMMUNICATION_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Name</span>
                  <input
                    placeholder='Who did you speak with?'
                    value={collContactName}
                    onChange={(e) => setCollContactName(e.target.value)}
                    style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '6px 10px', fontSize: 12, outline: 'none' }}
                  />
                </div>
              </div>
              {/* Row 2: outcome */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outcome</span>
                <select value={collOutcome} onChange={(e) => setCollOutcome(e.target.value)}
                  style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: collOutcome ? (getOutcomeMeta(collOutcome)?.color ?? '#ccc') : '#555', padding: '6px 10px', fontSize: 12, outline: 'none' }}>
                  <option value=''>Select outcome…</option>
                  {OUTCOME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {/* Row 3: note text */}
              <textarea placeholder="Add a collection note…" value={collectionNoteText} onChange={(e) => setCollectionNoteText(e.target.value)} rows={3}
                style={{ width: '100%', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
                const pinned   = allCollection.filter((n) => n.isPinned)
                const unpinned = allCollection.filter((n) => !n.isPinned)
                const shown    = unpinned.slice(0, 5)
                const extra    = unpinned.length - shown.length

                const NoteRow = ({ n, isPinnedSection }: { n: typeof allCollection[0]; isPinnedSection: boolean }) => {
                  const outcomeMeta = n.outcome ? getOutcomeMeta(n.outcome) : null
                  const isEditing   = editingNoteId === n.id
                  const isOwnNote   = !!currentUserId && n.createdBy === currentUserId
                  return (
                    <div key={n.id} style={{ paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <textarea
                            autoFocus
                            value={editingNoteContent}
                            onChange={(e) => setEditingNoteContent(e.target.value)}
                            rows={3}
                            style={{ width: '100%', background: '#2a2a2a', border: '1px solid #ff6b00', borderRadius: 8, color: '#ccc', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                          />
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button onClick={() => setEditingNoteId(null)} style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                            <button onClick={() => handleEditNote(n.id)} disabled={savingNoteEdit || !editingNoteContent.trim()}
                              style={{ background: '#ff6b00', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 12px', fontSize: 12, cursor: savingNoteEdit ? 'default' : 'pointer', opacity: savingNoteEdit || !editingNoteContent.trim() ? 0.6 : 1 }}>
                              {savingNoteEdit ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ flex: 1, fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{n.content}</div>
                            {isOwnNote && (
                              <button
                                onClick={() => { setEditingNoteId(n.id); setEditingNoteContent(n.content) }}
                                title="Edit note"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px', flexShrink: 0, color: '#444' }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b00')}
                                onMouseLeave={(e) => (e.currentTarget.style.color = '#444')}>✎</button>
                            )}
                            {isArAdmin && (
                              <>
                                <button
                                  onClick={() => handlePinNote(n.id, !n.isPinned)}
                                  title={n.isPinned ? 'Unpin note' : 'Pin note to top'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0, color: isPinnedSection ? '#ff6b00' : '#444', transition: 'color 0.15s' }}
                                  onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b00')}
                                  onMouseLeave={(e) => (e.currentTarget.style.color = isPinnedSection ? '#ff6b00' : '#444')}>
                                  📌
                                </button>
                                <button onClick={() => handleDeleteNote(n.id)}
                                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
                                  onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                                  onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>×</button>
                              </>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5 }}>
                            {outcomeMeta && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: outcomeMeta.color, background: `${outcomeMeta.color}18`, borderRadius: 4, padding: '1px 6px' }}>
                                {outcomeMeta.label}
                              </span>
                            )}
                            {n.communicationType && (
                              <span style={{ fontSize: 10, color: '#666', background: '#2a2a2a', borderRadius: 4, padding: '1px 6px' }}>
                                {getCommTypeLabel(n.communicationType)}
                              </span>
                            )}
                            {n.contactName && <span style={{ fontSize: 10, color: '#555' }}>w/ {n.contactName}</span>}
                            <span style={{ fontSize: 11, color: '#555', marginLeft: 'auto' }}>
                              {n.createdByName ?? 'Unknown'} · {fmtTs(n.createdAt)}
                              {n.editedAt && <span style={{ color: '#444', fontStyle: 'italic' }}> · edited</span>}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )
                }

                if (allCollection.length === 0) return <div style={{ fontSize: 12, color: '#555' }}>No collection notes yet.</div>
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {/* ── Pinned notes block ── */}
                    {pinned.length > 0 && (
                      <div style={{ background: 'rgba(255,107,0,0.06)', border: '1px solid rgba(255,107,0,0.2)', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                          <span style={{ fontSize: 11, color: '#ff6b00', fontWeight: 500 }}>📌 Pinned</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {pinned.map((n) => <NoteRow key={n.id} n={n} isPinnedSection />)}
                        </div>
                      </div>
                    )}
                    {/* ── Recent notes ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {shown.map((n) => <NoteRow key={n.id} n={n} isPinnedSection={false} />)}
                    </div>
                    {extra > 0 && (
                      <div style={{ fontSize: 11, color: '#444', textAlign: 'center', paddingTop: 8 }}>
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
            <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Row 1: comm type + contact name */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>How Contacted</span>
                  <select value={opCommType} onChange={(e) => setOpCommType(e.target.value)}
                    style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: opCommType ? '#ccc' : '#555', padding: '6px 10px', fontSize: 12, outline: 'none' }}>
                    <option value=''>Not specified</option>
                    {COMMUNICATION_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Name</span>
                  <input
                    placeholder='Who did you speak with?'
                    value={opContactName}
                    onChange={(e) => setOpContactName(e.target.value)}
                    style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '6px 10px', fontSize: 12, outline: 'none' }}
                  />
                </div>
              </div>
              {/* Row 2: outcome */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outcome</span>
                <select value={opOutcome} onChange={(e) => setOpOutcome(e.target.value)}
                  style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: opOutcome ? (getOutcomeMeta(opOutcome)?.color ?? '#ccc') : '#555', padding: '6px 10px', fontSize: 12, outline: 'none' }}>
                  <option value=''>Select outcome…</option>
                  {OUTCOME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {/* Row 3: note text */}
              <textarea placeholder="Add an operation note…" value={operationNoteText} onChange={(e) => setOperationNoteText(e.target.value)} rows={3}
                style={{ width: '100%', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
                    {shown.map((n) => {
                      const outcomeMeta = n.outcome ? getOutcomeMeta(n.outcome) : null
                      const isEditing   = editingNoteId === n.id
                      const isOwnNote   = !!currentUserId && n.createdBy === currentUserId
                      return (
                        <div key={n.id} style={{ paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <textarea
                                autoFocus
                                value={editingNoteContent}
                                onChange={(e) => setEditingNoteContent(e.target.value)}
                                rows={3}
                                style={{ width: '100%', background: '#2a2a2a', border: '1px solid #ff6b00', borderRadius: 8, color: '#ccc', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                              />
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button onClick={() => setEditingNoteId(null)} style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                                <button onClick={() => handleEditNote(n.id)} disabled={savingNoteEdit || !editingNoteContent.trim()}
                                  style={{ background: '#ff6b00', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 12px', fontSize: 12, cursor: savingNoteEdit ? 'default' : 'pointer', opacity: savingNoteEdit || !editingNoteContent.trim() ? 0.6 : 1 }}>
                                  {savingNoteEdit ? 'Saving…' : 'Save'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ flex: 1, fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{n.content}</div>
                                {isOwnNote && (
                                  <button
                                    onClick={() => { setEditingNoteId(n.id); setEditingNoteContent(n.content) }}
                                    title="Edit note"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '2px 4px', flexShrink: 0, color: '#444' }}
                                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b00')}
                                    onMouseLeave={(e) => (e.currentTarget.style.color = '#444')}>✎</button>
                                )}
                                {isAdmin && (
                                  <button onClick={() => handleDeleteNote(n.id)}
                                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
                                    onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                                    onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>×</button>
                                )}
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5 }}>
                                {outcomeMeta && (
                                  <span style={{ fontSize: 10, fontWeight: 600, color: outcomeMeta.color, background: `${outcomeMeta.color}18`, borderRadius: 4, padding: '1px 6px' }}>
                                    {outcomeMeta.label}
                                  </span>
                                )}
                                {n.communicationType && (
                                  <span style={{ fontSize: 10, color: '#666', background: '#2a2a2a', borderRadius: 4, padding: '1px 6px' }}>
                                    {getCommTypeLabel(n.communicationType)}
                                  </span>
                                )}
                                {n.contactName && <span style={{ fontSize: 10, color: '#555' }}>w/ {n.contactName}</span>}
                                <span style={{ fontSize: 11, color: '#555', marginLeft: 'auto' }}>
                                  {n.createdByName ?? 'Unknown'} · {fmtTs(n.createdAt)}
                                  {n.editedAt && <span style={{ color: '#444', fontStyle: 'italic' }}> · edited</span>}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                    {extra > 0 && (
                      <div style={{ fontSize: 11, color: '#444', textAlign: 'center', paddingTop: 2 }}>
                        {extra} older note{extra !== 1 ? 's' : ''} not shown
                      </div>
                    )}
                  </div>
                )
              })()}
        </SectionCard>

        </div>{/* end left column */}

        {/* Right column — Details sidebar */}
        <div style={{ width: 290, flexShrink: 0 }}>
          <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', padding: 16, display: 'flex', flexDirection: 'column' }}>

            {/* Entity Links */}
            <SidebarSection title="Entity Links"
              action={isAdmin ? (
                <button onClick={() => setShowMerge(true)}
                  style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                  + Link
                </button>
              ) : undefined}>
              {profileLoading ? <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
                : (profile?.entityRefs ?? []).length === 0 ? <div style={{ fontSize: 12, color: '#555' }}>No entity refs found.</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {(profile?.entityRefs ?? []).map((ref, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 11, color: '#ff6b00', fontWeight: 500, minWidth: 32 }}>{ref.entityCode}</span>
                        <span style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ref.quickbooksName}</span>
                      </div>
                    ))}
                  </div>
                )}
            </SidebarSection>

            <div style={{ height: 1, background: '#2a2a2a', margin: '14px 0' }} />

            {/* Contacts */}
            <SidebarSection title="Contacts"
              action={!showAddContact ? (
                <button onClick={() => setShowAddContact(true)}
                  style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 11, cursor: 'pointer', padding: 0 }}>+ Add</button>
              ) : undefined}>
              {showAddContact && <div style={{ marginBottom: 10 }}><ContactForm customerId={customer.id} onSaved={handleContactSaved} onCancel={() => setShowAddContact(false)} /></div>}
              {profileLoading ? <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
                : (profile?.contacts ?? []).length === 0 && !showAddContact ? <div style={{ fontSize: 12, color: '#555' }}>No contacts yet.</div>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(profile?.contacts ?? []).map((c) => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500 }}>{c.name}</span>
                            {c.isPrimary && <span style={{ fontSize: 9, color: '#ff6b00', background: 'rgba(255,107,0,0.12)', borderRadius: 3, padding: '1px 5px' }}>Primary</span>}
                          </div>
                          {c.title && <div style={{ fontSize: 11, color: '#555', marginTop: 1 }}>{c.title}</div>}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 3 }}>
                            {c.email && <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: '#777', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</a>}
                            {c.phone && <span style={{ fontSize: 11, color: '#777' }}>{c.phone}</span>}
                          </div>
                        </div>
                        {isArAdmin && (
                          <button onClick={() => handleDeleteContact(c.id)}
                            style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14, padding: '1px 3px', flexShrink: 0 }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#444')}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </SidebarSection>

            <div style={{ height: 1, background: '#2a2a2a', margin: '14px 0' }} />

            {/* Project Managers */}
            <SidebarSection title="Project Managers"
              action={canManagePMs && availablePmBranches.length > 0 ? (
                <select value="" onChange={(e) => { if (e.target.value) handleAssignPm(e.target.value) }}
                  style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 5, color: '#ff6b00', padding: '2px 6px', fontSize: 10, cursor: 'pointer', outline: 'none' }}>
                  <option value="">+ Assign</option>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {(profile?.pmAssignments ?? []).map((pm) => (
                      <div key={pm.userId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: '#ccc' }}>{pm.displayName}</div>
                          <div style={{ fontSize: 10, color: '#555' }}>{pm.role.replace(/_/g, ' ')}</div>
                        </div>
                        {canManagePMs && (
                          <button onClick={() => handleRemovePm(pm.userId)}
                            style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14, padding: '1px 3px' }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#444')}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </SidebarSection>

            <div style={{ height: 1, background: '#2a2a2a', margin: '14px 0' }} />

            {/* AR Team */}
            <SidebarSection title="AR Team"
              action={isArAdmin && hasAvailableAr ? (
                <select value="" onChange={(e) => { if (e.target.value) handleAssignAr(e.target.value) }}
                  style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 5, color: '#ff6b00', padding: '2px 6px', fontSize: 10, cursor: 'pointer', outline: 'none' }}>
                  <option value="">+ Assign</option>
                  {arManagers.length > 0 && (
                    <optgroup label="AR Manager">
                      {arManagers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                    </optgroup>
                  )}
                  {arTeamMembers.length > 0 && (
                    <optgroup label="AR Team">
                      {arTeamMembers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {arAssignments.map((a) => (
                    <div key={a.userId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.displayName}</span>
                        {roleBadge(a.role)}
                      </div>
                      {isArAdmin && (
                        <button onClick={() => handleRemoveAr(a.userId)}
                          style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14, padding: '1px 3px', flexShrink: 0 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '#444')}>×</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SidebarSection>

            {/* Branch Breakdown — only when multiple branches */}
            {(profile?.branchBreakdown?.length ?? 0) > 0 && (
              <>
                <div style={{ height: 1, background: '#2a2a2a', margin: '14px 0' }} />
                <SidebarSection title="By Branch">
                  {(() => {
                    const total = (profile?.branchBreakdown ?? []).reduce((s, b) => s + b.total, 0)
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(profile?.branchBreakdown ?? []).map((b, i) => (
                          <div key={b.name}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                              <span style={{ fontSize: 11, color: '#888' }}>{b.name}</span>
                              <span style={{ fontSize: 11, color: '#ccc', fontVariantNumeric: 'tabular-nums' }}>{fmt(b.total)}</span>
                            </div>
                            <div style={{ height: 3, borderRadius: 2, background: '#2a2a2a', overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 2, background: BRANCH_PALETTE[i % BRANCH_PALETTE.length], width: `${total > 0 ? (b.total / total) * 100 : 0}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </SidebarSection>
              </>
            )}

          </div>
        </div>{/* end right column */}

      </div>{/* end 2-column layout */}

      {/* Invoice table */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>Open Invoices</span>
          {invTotal > 0 && <span style={{ fontSize: 11, color: '#555' }}>{invTotal} total</span>}
          <span style={{ fontSize: 11, color: '#444' }}>· click row for notes &amp; flags</span>
          <div style={{ flex: 1 }} />
          {invBranchOptions.length > 1 && (
            <select
              value={invBranchId}
              onChange={(e) => setInvBranchId(e.target.value)}
              style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 7, color: invBranchId ? '#ccc' : '#666', padding: '4px 10px', fontSize: 12, cursor: 'pointer', outline: 'none' }}
            >
              <option value=''>All Branches</option>
              {invBranchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                <th style={{ width: 32, padding: '9px 8px 9px 12px' }} />
                {['Invoice #', 'Entity', 'Branch', 'Job', 'PO #', 'Invoice Date', 'Due Date', 'Terms', 'Status', 'Aging', 'Open Balance'].map((h) => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Open Balance' ? 'right' : 'left', fontSize: 11, color: '#666', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invLoading ? <tr><td colSpan={12} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>Loading…</td></tr>
                : invoices.length === 0 ? <tr><td colSpan={12} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>No invoices found</td></tr>
                : invoices.map((inv) => {
                  const isExpanded   = expandedInvId === inv.id
                  const invStatusMeta = inv.invoice_status ? getInvStatusMeta(inv.invoice_status) : null
                  const loadedNotes  = invNotes[inv.id]
                  const noteCount    = loadedNotes?.length ?? 0

                  return (
                    <React.Fragment key={inv.id}>
                      <tr
                        style={{ borderBottom: isExpanded ? 'none' : '1px solid #222', cursor: 'pointer', background: isExpanded ? '#1a1a1a' : 'transparent' }}
                        onClick={() => handleToggleInv(inv.id)}>
                        {/* Chevron */}
                        <td style={{ padding: '9px 8px 9px 12px', fontSize: 11, color: '#444' }}>
                          <span style={{ display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', userSelect: 'none' }}>▶</span>
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            {inv.invoice_number ?? '—'}
                            {noteCount > 0 && (
                              <span style={{ background: '#ff6b00', color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '1px 5px', lineHeight: 1.4 }}>{noteCount}</span>
                            )}
                          </span>
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc' }}>{inv.entity_code}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>
                          {inv.branch?.name ?? <span style={{ color: '#555' }}>{inv.raw_class_code ?? '—'}</span>}
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.job_name ?? '—'}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>{inv.po_number ?? '—'}</td>
                        {/* Invoice Date — editable by ar_admin roles */}
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
                          {isArAdmin && inv.invoice_number && editingDateInvId === inv.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                type="date"
                                defaultValue={inv.invoice_date ?? ''}
                                onChange={(e) => setEditingDateValue(e.target.value)}
                                autoFocus
                                style={{
                                  background: '#2a2a2a', border: '1px solid #ff6b00',
                                  borderRadius: 6, color: '#fff', padding: '3px 7px',
                                  fontSize: 11, outline: 'none', width: 130,
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveInvoiceDate(inv)
                                  if (e.key === 'Escape') { setEditingDateInvId(null); setEditingDateValue('') }
                                }}
                              />
                              <button
                                onClick={() => handleSaveInvoiceDate(inv)}
                                disabled={savingDate || !editingDateValue}
                                style={{ background: '#ff6b00', border: 'none', borderRadius: 4, color: '#fff', padding: '3px 8px', fontSize: 11, cursor: 'pointer', opacity: savingDate ? 0.5 : 1 }}
                              >
                                {savingDate ? '…' : '✓'}
                              </button>
                              <button
                                onClick={() => { setEditingDateInvId(null); setEditingDateValue('') }}
                                style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 4, color: '#888', padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <span
                              onClick={() => {
                                if (isArAdmin && inv.invoice_number) {
                                  setEditingDateInvId(inv.id)
                                  setEditingDateValue(inv.invoice_date ?? '')
                                }
                              }}
                              title={isArAdmin && inv.invoice_number ? 'Click to override invoice date' : undefined}
                              style={{
                                cursor: isArAdmin && inv.invoice_number ? 'pointer' : 'default',
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                              }}
                            >
                              {fmtDate(inv.invoice_date)}
                              {isArAdmin && inv.invoice_number && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth={2} style={{ flexShrink: 0, opacity: 0.6 }}>
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              )}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#ccc', whiteSpace: 'nowrap' }}>{fmtDate(inv.due_date)}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#888' }}>{inv.terms ?? '—'}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {invStatusMeta ? (
                            <span style={{ background: `${invStatusMeta.color}22`, color: invStatusMeta.color, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                              {invStatusMeta.label}
                            </span>
                          ) : <span style={{ color: '#444' }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                          <span style={{ background: `${BUCKET_COLORS[inv.aging_bucket] ?? '#333'}22`, color: BUCKET_COLORS[inv.aging_bucket] ?? '#888', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>{inv.aging_bucket}</span>
                        </td>
                        <td style={{ padding: '9px 12px', fontSize: 12, color: '#fff', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(inv.open_balance))}</td>
                      </tr>

                      {/* ── Expanded invoice panel ── */}
                      {isExpanded && (
                        <tr key={`${inv.id}-expand`} style={{ borderBottom: '1px solid #222' }}>
                          <td colSpan={12} style={{ padding: 0 }}>
                            <div style={{ background: '#161616', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
                              onClick={(e) => e.stopPropagation()}>

                              {/* Invoice status row */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Invoice Flag</span>
                                {isArAdmin ? (
                                  <select
                                    value={inv.invoice_status ?? ''}
                                    onChange={(e) => handleInvStatusChange(inv.id, e.target.value)}
                                    style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 7, color: invStatusMeta ? invStatusMeta.color : '#555', padding: '5px 10px', fontSize: 12, outline: 'none', cursor: 'pointer' }}>
                                    <option value=''>No Flag</option>
                                    {INVOICE_STATUS_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span style={{ fontSize: 12, color: invStatusMeta ? invStatusMeta.color : '#444' }}>
                                    {invStatusMeta ? invStatusMeta.label : 'No flag'}
                                  </span>
                                )}
                              </div>

                              {/* Notes */}
                              <div>
                                <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Invoice Notes</div>
                                {invNotesLoading[inv.id] && <div style={{ fontSize: 12, color: '#555' }}>Loading notes…</div>}
                                {!invNotesLoading[inv.id] && (
                                  <>
                                    {(invNotes[inv.id] ?? []).length === 0 && (
                                      <div style={{ fontSize: 12, color: '#555', marginBottom: isArAdmin ? 10 : 0 }}>No notes for this invoice.</div>
                                    )}
                                    {(invNotes[inv.id] ?? []).map((note) => (
                                      <div key={note.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #222' }}>
                                        <div style={{ flex: 1 }}>
                                          <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{note.content}</div>
                                          <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>{note.createdByName ?? 'Unknown'} · {fmtTs(note.createdAt)}</div>
                                        </div>
                                        {isArAdmin && (
                                          <button onClick={() => handleDeleteInvNote(inv.id, note.id)}
                                            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, padding: '2px 4px', flexShrink: 0 }}
                                            onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                                            onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>×</button>
                                        )}
                                      </div>
                                    ))}
                                    {isArAdmin && (
                                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                        <input
                                          placeholder="Add a note about this invoice…"
                                          value={invNoteText}
                                          onChange={(e) => setInvNoteText(e.target.value)}
                                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddInvNote(inv.id) } }}
                                          style={{ flex: 1, background: '#2a2a2a', border: '1px solid #333', borderRadius: 7, color: '#ccc', padding: '6px 10px', fontSize: 12, outline: 'none' }}
                                        />
                                        <button
                                          onClick={() => handleAddInvNote(inv.id)}
                                          disabled={addingInvNote || !invNoteText.trim()}
                                          style={{ background: '#ff6b00', border: 'none', borderRadius: 7, color: '#fff', padding: '6px 14px', fontSize: 12, cursor: addingInvNote || !invNoteText.trim() ? 'default' : 'pointer', opacity: addingInvNote || !invNoteText.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                                          {addingInvNote ? '…' : 'Add'}
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
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
