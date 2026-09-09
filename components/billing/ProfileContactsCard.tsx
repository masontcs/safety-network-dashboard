'use client'

import { useCallback, useEffect, useState } from 'react'
import Select from '@/components/billing/Select'
import Toggle from '@/components/billing/Toggle'

/**
 * Contacts for a billing profile, by function (AP, PM, general, …). Read for anyone who can see
 * the profile; add/edit/delete gated server-side by the 'customers' area (canManage from the API).
 */

interface Contact {
  id: string
  name: string
  role: string
  title: string | null
  email: string | null
  phone: string | null
  isInvoiceRecipient: boolean
}

const ROLES: { value: string; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'ap', label: 'Accounts Payable (AP)' },
  { value: 'pm', label: 'Project Manager (PM)' },
  { value: 'superintendent', label: 'Superintendent' },
  { value: 'safety', label: 'Safety' },
  { value: 'estimator', label: 'Estimator' },
  { value: 'scheduler', label: 'Scheduler' },
  { value: 'other', label: 'Other' },
]
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label ?? 'General'
const roleOrder = (r: string) => { const i = ROLES.findIndex((x) => x.value === r); return i < 0 ? ROLES.length : i }

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)',
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
}

type Draft = { name: string; role: string; title: string; email: string; phone: string; isInvoiceRecipient: boolean }
const emptyDraft = (): Draft => ({ name: '', role: 'general', title: '', email: '', phone: '', isInvoiceRecipient: false })

export default function ProfileContactsCard({ profileId }: { profileId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null) // null = not editing; 'new' = adding
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/billing/profiles/${profileId}/contacts`).then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error); setContacts(j.data.contacts); setCanManage(j.data.canManage); setErr(null) })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [profileId])
  useEffect(() => { load() }, [load])

  function startAdd() { setDraft(emptyDraft()); setEditingId('new') }
  function startEdit(c: Contact) {
    setDraft({ name: c.name, role: c.role, title: c.title ?? '', email: c.email ?? '', phone: c.phone ?? '', isInvoiceRecipient: c.isInvoiceRecipient })
    setEditingId(c.id)
  }
  function cancel() { setEditingId(null); setErr(null) }

  async function save() {
    if (busy || !draft.name.trim()) return
    setBusy(true); setErr(null)
    const isNew = editingId === 'new'
    const url = isNew ? `/api/billing/profiles/${profileId}/contacts` : `/api/billing/profiles/${profileId}/contacts/${editingId}`
    try {
      const res = await fetch(url, { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      const j = await res.json()
      if (!j.success) { setErr(j.error); return }
      setEditingId(null); load()
    } catch { setErr('Network error — please try again.') }
    finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!window.confirm('Remove this contact?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/billing/profiles/${profileId}/contacts/${id}`, { method: 'DELETE' })
      const j = await res.json()
      if (!j.success) setErr(j.error); else load()
    } catch { setErr('Could not remove the contact.') }
    finally { setBusy(false) }
  }

  const sorted = [...contacts].sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name))

  const form = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, border: '1px solid var(--border-emphasis)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div><label style={labelStyle}>Name</label><input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} placeholder="Jane Doe" /></div>
        <div><label style={labelStyle}>Role</label>
          <Select ariaLabel="Contact role" value={draft.role} onChange={(v) => setDraft({ ...draft, role: v })}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </div>
        <div><label style={labelStyle}>Title (optional)</label><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={inputStyle} placeholder="Accounts Payable Clerk" /></div>
        <div><label style={labelStyle}>Email</label><input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} style={inputStyle} placeholder="jane@acme.com" /></div>
        <div><label style={labelStyle}>Phone</label><input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} style={inputStyle} placeholder="(661) 555-0100" /></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Toggle ariaLabel="Send invoices to this contact" checked={draft.isInvoiceRecipient} onChange={(v) => setDraft({ ...draft, isInvoiceRecipient: v })} />
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Invoice recipient</span>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', padding: '8px 10px', background: 'var(--alert-danger-bg)', borderRadius: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary" style={{ padding: '7px 16px', opacity: busy || !draft.name.trim() ? 0.5 : 1 }} disabled={busy || !draft.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save contact'}</button>
        <button className="bx-btn ghost" onClick={cancel}>Cancel</button>
      </div>
    </div>
  )

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Contacts</div>
        {canManage && editingId === null && (
          <button className="bx-btn ghost sm" style={{ marginLeft: 'auto' }} onClick={startAdd}>+ Add contact</button>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        People for this profile by function — accounts payable, project manager, superintendent, and so on.
      </div>

      {editingId === 'new' && <div style={{ marginBottom: 16 }}>{form}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : sorted.length === 0 && editingId !== 'new' ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>
          No contacts yet.{canManage ? ' Add the customer’s AP, PM, and site contacts here.' : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((c) => editingId === c.id ? <div key={c.id}>{form}</div> : (
            <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', border: '1px solid var(--border-subtle, var(--border-emphasis))', borderRadius: 8 }}>
              <span className="tag t-gray" style={{ flex: 'none', marginTop: 1 }}>{roleLabel(c.role)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {c.name}{c.title ? <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> · {c.title}</span> : null}
                  {c.isInvoiceRecipient && <span className="tag t-green" style={{ marginLeft: 8 }}>Invoices</span>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
                  {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>}
                  {!c.email && !c.phone && <span>No email or phone</span>}
                </div>
              </div>
              {canManage && editingId === null && (
                <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                  <button className="bx-btn ghost sm" onClick={() => startEdit(c)}>Edit</button>
                  <button className="bx-iconbtn" title="Remove" onClick={() => remove(c.id)} disabled={busy}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
