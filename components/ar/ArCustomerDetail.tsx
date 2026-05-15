'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Contact { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean }
interface Note    { id: string; content: string; createdAt: string; createdByName: string | null }
interface PmAssignment { userId: string; displayName: string; role: string }
interface EntityRef { entityCode: string; quickbooksName: string }

interface CustomerProfile {
  id: string
  displayName: string
  isExcluded: boolean
  status: 'active' | 'collections' | 'on_hold' | 'closed'
  entityRefs: EntityRef[]
  contacts: Contact[]
  notes: Note[]
  pmAssignments: PmAssignment[]
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

interface SystemUser { id: string; displayName: string; role: string }
interface SearchResult { id: string; displayName: string; entityRefs: EntityRef[] }

interface Props {
  customer: CustomerSummary
  entity: string
  isAdmin: boolean
  onBack: () => void
  onRefresh: () => void
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '>90'] as const
const BUCKET_COLORS: Record<string, string> = {
  'Current': '#ff6b00', '1-30': '#cc9900', '31-60': '#cc6600', '61-90': '#cc4444', '>90': '#992222',
}
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:      { label: 'Active',      color: '#4caf50', bg: 'rgba(76,175,80,0.12)' },
  collections: { label: 'Collections', color: '#cc4444', bg: 'rgba(204,68,68,0.12)' },
  on_hold:     { label: 'On Hold',     color: '#cc9900', bg: 'rgba(204,153,0,0.12)'  },
  closed:      { label: 'Closed',      color: '#555',    bg: '#2a2a2a'               },
}

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

// ─── Merge modal ───────────────────────────────────────────────────────────────

function MergeModal({ customerId, customerName, onClose, onMerged }: {
  customerId: string
  customerName: string
  onClose: () => void
  onMerged: (mergedName: string) => void
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
      if (res.ok) {
        const data = await res.json()
        setResults(data.customers ?? [])
      }
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [q, customerId])

  const handleMerge = async () => {
    if (!selected) return
    setMerging(true)
    const res = await fetch(`/api/ar/customers/${customerId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceCustomerId: selected.id }),
    })
    if (res.ok) {
      const data = await res.json()
      onMerged(data.mergedName)
    }
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
            <input
              autoFocus
              type="text"
              placeholder="Search by name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: '100%', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
            />
            {searching && <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: 16 }}>Searching…</div>}
            {!searching && q.length >= 2 && results.length === 0 && (
              <div style={{ fontSize: 12, color: '#555', textAlign: 'center', padding: 16 }}>No customers found</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
              {results.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelected(r)}
                  style={{ background: '#2a2a2a', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', border: '1px solid #333' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#ff6b00')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#333')}
                >
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{r.displayName}</div>
                  {r.entityRefs.length > 0 && (
                    <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
                      {r.entityRefs.map((ref) => `${ref.entityCode}: ${ref.quickbooksName}`).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div>
            <div style={{ background: '#2a2a2a', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Merging into {customerName}:</div>
              <div style={{ fontSize: 14, color: '#ff6b00', fontWeight: 500 }}>{selected.displayName}</div>
              {selected.entityRefs.length > 0 && (
                <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                  {selected.entityRefs.map((ref) => `${ref.entityCode}: ${ref.quickbooksName}`).join(' · ')}
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#cc4444', marginBottom: 16 }}>
              This will permanently delete the selected customer record and reassign all their data. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setSelected(null)} disabled={merging}
                style={{ background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#888', padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>
                Back
              </button>
              <button onClick={handleMerge} disabled={merging}
                style={{ background: '#ff6b00', border: 'none', borderRadius: 8, color: '#fff', padding: '7px 20px', fontSize: 13, fontWeight: 500, cursor: merging ? 'default' : 'pointer', opacity: merging ? 0.6 : 1 }}>
                {merging ? 'Merging…' : 'Confirm Merge'}
              </button>
            </div>
          </div>
        )}

        {!selected && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#888', padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Contact form ──────────────────────────────────────────────────────────────

function ContactForm({ customerId, onSaved, onCancel }: { customerId: string; onSaved: (c: Contact) => void; onCancel: () => void }) {
  const [name, setName]     = useState('')
  const [title, setTitle]   = useState('')
  const [email, setEmail]   = useState('')
  const [phone, setPhone]   = useState('')
  const [primary, setPrimary] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    const res = await fetch(`/api/ar/customers/${customerId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, title, email, phone, isPrimary: primary }),
    })
    if (res.ok) {
      const data = await res.json()
      onSaved(data.contact)
    }
    setSaving(false)
  }

  const inputStyle = { background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '6px 10px', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box' as const }

  return (
    <div style={{ background: '#242424', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
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

export default function ArCustomerDetail({ customer, entity, isAdmin, onBack, onRefresh }: Props) {
  const [profile, setProfile]       = useState<CustomerProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)

  const [invoices, setInvoices]     = useState<Invoice[]>([])
  const [invTotal, setInvTotal]     = useState(0)
  const [invPage, setInvPage]       = useState(1)
  const [invPageCount, setInvPageCount] = useState(0)
  const [invLoading, setInvLoading] = useState(true)

  const [users, setUsers]           = useState<SystemUser[]>([])
  const [showMerge, setShowMerge]   = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [noteText, setNoteText]     = useState('')
  const [addingNote, setAddingNote] = useState(false)
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
    if (!isAdmin) return
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((d) => setUsers((d.users ?? []).map((u: { id: string; display_name?: string; displayName?: string; role: string }) => ({ id: u.id, displayName: u.display_name ?? u.displayName ?? '—', role: u.role }))))
  }, [isAdmin])

  const handleExcludeToggle = async () => {
    setTogglingExclude(true)
    await fetch(`/api/ar/customers/${customer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isExcluded: !profile?.isExcluded }),
    })
    setTogglingExclude(false)
    onRefresh()
  }

  const handleStatusChange = async (status: string) => {
    await fetch(`/api/ar/customers/${customer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setProfile((p) => p ? { ...p, status: status as CustomerProfile['status'] } : p)
  }

  const handleAddNote = async () => {
    if (!noteText.trim()) return
    setAddingNote(true)
    const res = await fetch(`/api/ar/customers/${customer.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: noteText.trim() }),
    })
    if (res.ok) {
      const data = await res.json()
      setProfile((p) => p ? { ...p, notes: [data.note, ...p.notes] } : p)
      setNoteText('')
    }
    setAddingNote(false)
  }

  const handleDeleteNote = async (noteId: string) => {
    await fetch(`/api/ar/customers/${customer.id}/notes/${noteId}`, { method: 'DELETE' })
    setProfile((p) => p ? { ...p, notes: p.notes.filter((n) => n.id !== noteId) } : p)
  }

  const handleContactSaved = (contact: Contact) => {
    setProfile((p) => p ? { ...p, contacts: [...p.contacts.filter((c) => !contact.isPrimary || !c.isPrimary), contact].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0)) } : p)
    setShowAddContact(false)
  }

  const handleDeleteContact = async (contactId: string) => {
    await fetch(`/api/ar/customers/${customer.id}/contacts/${contactId}`, { method: 'DELETE' })
    setProfile((p) => p ? { ...p, contacts: p.contacts.filter((c) => c.id !== contactId) } : p)
  }

  const handleAssignPm = async (userId: string) => {
    const res = await fetch(`/api/ar/customers/${customer.id}/pm-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (res.ok) {
      const data = await res.json()
      setProfile((p) => p ? { ...p, pmAssignments: [...p.pmAssignments, data.pm] } : p)
    }
  }

  const handleRemovePm = async (userId: string) => {
    await fetch(`/api/ar/customers/${customer.id}/pm-assignments/${userId}`, { method: 'DELETE' })
    setProfile((p) => p ? { ...p, pmAssignments: p.pmAssignments.filter((pm) => pm.userId !== userId) } : p)
  }

  const custAging: Record<string, number> = {
    'Current': customer.current, '1-30': customer.d30,
    '31-60': customer.d60, '61-90': customer.d90, '>90': customer.d90plus,
  }

  const assignedPmIds = new Set(profile?.pmAssignments.map((pm) => pm.userId) ?? [])
  const availableUsers = users.filter((u) => !assignedPmIds.has(u.id))
  const statusMeta = STATUS_META[profile?.status ?? 'active']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={onBack}
          style={{ background: '#2a2a2a', border: 'none', borderRadius: 8, color: '#ccc', padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
          ← Back
        </button>
        <div style={{ fontSize: 22, fontWeight: 500, color: profile?.isExcluded ? '#666' : '#fff', flex: 1 }}>
          {customer.displayName}
        </div>
        {/* Status */}
        {isAdmin && profile ? (
          <select
            value={profile.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            style={{ background: statusMeta.bg, border: `1px solid ${statusMeta.color}`, borderRadius: 8, color: statusMeta.color, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
          >
            <option value="active">Active</option>
            <option value="collections">Collections</option>
            <option value="on_hold">On Hold</option>
            <option value="closed">Closed</option>
          </select>
        ) : profile && (
          <span style={{ background: statusMeta.bg, border: `1px solid ${statusMeta.color}`, borderRadius: 8, color: statusMeta.color, padding: '5px 10px', fontSize: 12 }}>
            {statusMeta.label}
          </span>
        )}
        {isAdmin && (
          <button onClick={handleExcludeToggle} disabled={togglingExclude}
            style={{ background: profile?.isExcluded ? '#2a2a2a' : 'rgba(204,68,68,0.12)', border: `1px solid ${profile?.isExcluded ? '#333' : '#663333'}`, borderRadius: 8, color: profile?.isExcluded ? '#888' : '#cc4444', padding: '6px 14px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {profile?.isExcluded ? 'Restore to AR' : 'Exclude from AR'}
          </button>
        )}
      </div>

      {/* Aging cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        <div style={{ background: profile?.isExcluded ? '#2a2a2a' : '#ff6b00', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: profile?.isExcluded ? '#555' : 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Total AR</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: profile?.isExcluded ? '#666' : '#fff' }}>{fmt(customer.totalAr)}</div>
        </div>
        {AGING_BUCKETS.map((b) => (
          <div key={b} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{b} days</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: custAging[b] > 0 && !profile?.isExcluded ? BUCKET_COLORS[b] : '#444' }}>
              {fmt(custAging[b])}
            </div>
          </div>
        ))}
      </div>

      {/* Profile sections grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* Entity Links */}
        <SectionCard
          title="Entity Links"
          action={isAdmin ? (
            <button onClick={() => setShowMerge(true)}
              style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: '#ff6b00', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
              + Link customer
            </button>
          ) : undefined}
        >
          {profileLoading ? (
            <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
          ) : (profile?.entityRefs ?? []).length === 0 ? (
            <div style={{ fontSize: 12, color: '#555' }}>No entity refs found.</div>
          ) : (
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
        <SectionCard
          title="Project Managers"
          action={isAdmin && availableUsers.length > 0 ? (
            <select
              value=""
              onChange={(e) => { if (e.target.value) handleAssignPm(e.target.value) }}
              style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 6, color: '#ff6b00', padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
            >
              <option value="">+ Assign PM</option>
              {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          ) : undefined}
        >
          {profileLoading ? (
            <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
          ) : (profile?.pmAssignments ?? []).length === 0 ? (
            <div style={{ fontSize: 12, color: '#555' }}>No PMs assigned.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(profile?.pmAssignments ?? []).map((pm) => (
                <div key={pm.userId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: '#ccc' }}>{pm.displayName}</div>
                    <div style={{ fontSize: 11, color: '#555' }}>{pm.role.replace('_', ' ')}</div>
                  </div>
                  {isAdmin && (
                    <button onClick={() => handleRemovePm(pm.userId)}
                      style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Contacts */}
        <SectionCard
          title="Contacts"
          action={isAdmin && !showAddContact ? (
            <button onClick={() => setShowAddContact(true)}
              style={{ background: '#2a2a2a', border: 'none', borderRadius: 6, color: '#ff6b00', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
              + Add
            </button>
          ) : undefined}
        >
          {showAddContact && (
            <div style={{ marginBottom: 12 }}>
              <ContactForm customerId={customer.id} onSaved={handleContactSaved} onCancel={() => setShowAddContact(false)} />
            </div>
          )}
          {profileLoading ? (
            <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
          ) : (profile?.contacts ?? []).length === 0 && !showAddContact ? (
            <div style={{ fontSize: 12, color: '#555' }}>No contacts yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(profile?.contacts ?? []).map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, color: '#ccc', fontWeight: 500 }}>{c.name}</span>
                      {c.isPrimary && <span style={{ fontSize: 10, color: '#ff6b00', background: 'rgba(255,107,0,0.12)', borderRadius: 4, padding: '1px 6px' }}>Primary</span>}
                    </div>
                    {c.title && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{c.title}</div>}
                    <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                      {c.email && <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: '#888', textDecoration: 'none' }}>{c.email}</a>}
                      {c.phone && <span style={{ fontSize: 11, color: '#888' }}>{c.phone}</span>}
                    </div>
                  </div>
                  {isAdmin && (
                    <button onClick={() => handleDeleteContact(c.id)}
                      style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Notes */}
        <SectionCard title="Notes">
          {isAdmin && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                placeholder="Add a note…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                style={{ width: '100%', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#ccc', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button onClick={handleAddNote} disabled={addingNote || !noteText.trim()}
                  style={{ background: '#ff6b00', border: 'none', borderRadius: 6, color: '#fff', padding: '5px 14px', fontSize: 12, cursor: addingNote || !noteText.trim() ? 'default' : 'pointer', opacity: addingNote || !noteText.trim() ? 0.5 : 1 }}>
                  {addingNote ? 'Saving…' : 'Add Note'}
                </button>
              </div>
            </div>
          )}
          {profileLoading ? (
            <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
          ) : (profile?.notes ?? []).length === 0 ? (
            <div style={{ fontSize: 12, color: '#555' }}>No notes yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(profile?.notes ?? []).map((n) => (
                <div key={n.id} style={{ paddingBottom: 10, borderBottom: '1px solid #2a2a2a' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 12, color: '#ccc', lineHeight: 1.5 }}>{n.content}</div>
                    {isAdmin && (
                      <button onClick={() => handleDeleteNote(n.id)}
                        style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#cc4444')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}>
                        ×
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                    {n.createdByName ?? 'Unknown'} · {fmtTs(n.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Invoice table */}
      <div style={{ background: '#1e1e1e', borderRadius: 12, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>Open Invoices</span>
          {invTotal > 0 && <span style={{ fontSize: 11, color: '#555' }}>{invTotal} total</span>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                {['Invoice #', 'Entity', 'Branch', 'Job', 'PO #', 'Invoice Date', 'Due Date', 'Terms', 'Aging', 'Open Balance'].map((h) => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Open Balance' ? 'right' : 'left', fontSize: 11, color: '#666', fontWeight: 400, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invLoading ? (
                <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>Loading…</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>No invoices found</td></tr>
              ) : invoices.map((inv) => (
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
                    <span style={{ background: `${BUCKET_COLORS[inv.aging_bucket] ?? '#333'}22`, color: BUCKET_COLORS[inv.aging_bucket] ?? '#888', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
                      {inv.aging_bucket}
                    </span>
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: 12, color: '#fff', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(Number(inv.open_balance))}
                  </td>
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

      {showMerge && profile && (
        <MergeModal
          customerId={customer.id}
          customerName={customer.displayName}
          onClose={() => setShowMerge(false)}
          onMerged={(mergedName) => {
            setShowMerge(false)
            fetchProfile()
            alert(`Merged "${mergedName}" into ${customer.displayName}.`)
          }}
        />
      )}
    </div>
  )
}
