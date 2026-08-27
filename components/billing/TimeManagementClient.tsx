'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBranch } from '@/components/billing/BranchContext'
import { useBroadcast } from '@/lib/realtime/useBroadcast'

/**
 * Time Management — the approver's surface. Times flow in from techs; here they're reviewed,
 * adjusted (admin edits happen HERE, never on the ticket, because they drive payroll), and
 * approved. Only approved batches become export-eligible. Also: per-diem weekly payout list,
 * and (admins) per-branch approver grants.
 */

type Tab = 'review' | 'perdiem' | 'approvers'

interface Entry { id: string; kind: 'ticket' | 'yard'; ticketId: string | null; ticketNumber: string | null; activity: string; startTime: string; endTime: string; hours: number; date: string }
interface Batch { key: string; technicianId: string; technicianName: string; branchId: string; date: string; entries: Entry[]; totalHours: number; status: 'submitted' | 'returned' | 'approved'; note: string | null; perDiem: boolean }
interface PerDiemRow { id: string; technicianId: string; technicianName: string; date: string; branchId: string | null; status: string; paidAt: string | null }
interface Grant { id: string; userId: string; userName: string; branchId: string }
interface Candidate { id: string; name: string }

const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const hhmm = (t: string) => t.slice(0, 5)

const statusPill: Record<string, { bg: string; fg: string; label: string }> = {
  submitted: { bg: 'var(--pill-pending-bg,#fff4e0)', fg: 'var(--pill-pending-fg,#8a5a00)', label: 'Needs review' },
  returned: { bg: 'var(--pill-overdue-bg,#fde8e8)', fg: 'var(--pill-overdue-fg,#a11)', label: 'Returned' },
  approved: { bg: 'var(--pill-paid-bg,#eaf7ec)', fg: 'var(--pill-paid-fg,#1a7a33)', label: 'Approved' },
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--border-emphasis)' }
const td: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--border-subtle, var(--border-emphasis))', color: 'var(--text-primary)', fontSize: 13 }

export default function TimeManagementClient() {
  const { branchId, branches } = useBranch()
  const [tab, setTab] = useState<Tab>('review')
  const [week, setWeek] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [toast, setToast] = useState<string | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200) }
  const branchName = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? 'Branch' : '—')

  // ── Review ────────────────────────────────────────────────────────────────
  const [batches, setBatches] = useState<Batch[]>([])
  const [canApprove, setCanApprove] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [returning, setReturning] = useState<string | null>(null)
  const [returnNote, setReturnNote] = useState('')
  const [edit, setEdit] = useState<{ id: string; start: string; end: string; date: string } | null>(null)
  const [exportDate, setExportDate] = useState<string>(() => new Date().toISOString().slice(0, 10))

  async function downloadExport() {
    if (!branchId) { flash('Pick a branch in the top bar to export.'); return }
    const code = branches.find((b) => b.id === branchId)?.code ?? 'branch'
    const res = await fetch(`/api/billing/time-management/export?branchId=${branchId}&branchCode=${encodeURIComponent(code)}&date=${exportDate}`)
    if (!res.ok) { const j = await res.json().catch(() => ({})); flash(j.error || 'Export failed'); return }
    const blob = await res.blob()
    const name = res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1] ?? `tsheets_${exportDate}.csv`
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    flash('Export downloaded.')
  }

  const loadReview = useCallback(() => {
    fetch(`/api/billing/time-management?week=${week}${branchId ? `&branchId=${branchId}` : ''}`)
      .then((r) => r.json()).then((j) => { if (j.success) { setBatches(j.data.batches); setCanApprove(j.data.canApprove) } }).catch(() => {})
  }, [week, branchId])

  // ── Per diem ──────────────────────────────────────────────────────────────
  const [perDiem, setPerDiem] = useState<PerDiemRow[]>([])
  const loadPerDiem = useCallback(() => {
    fetch(`/api/billing/per-diem?week=${week}`).then((r) => r.json()).then((j) => { if (j.success) setPerDiem(j.data.rows) }).catch(() => {})
  }, [week])

  // ── Approvers (admin) ───────────────────────────────────────────────────────
  const [grants, setGrants] = useState<Grant[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [approversAllowed, setApproversAllowed] = useState(true)
  const [newUser, setNewUser] = useState(''); const [newBranch, setNewBranch] = useState('')
  const loadApprovers = useCallback(() => {
    fetch('/api/billing/time-approvers').then((r) => r.json()).then((j) => {
      if (j.success) { setGrants(j.data.grants); setCandidates(j.data.candidates); setApproversAllowed(true) }
      else setApproversAllowed(false)
    }).catch(() => setApproversAllowed(false))
  }, [])

  useEffect(() => { if (tab === 'review') loadReview() }, [tab, loadReview])
  useEffect(() => { if (tab === 'perdiem') loadPerDiem() }, [tab, loadPerDiem])
  useEffect(() => { if (tab === 'approvers') loadApprovers() }, [tab, loadApprovers])
  useBroadcast('billing', 'changed', () => { if (tab === 'review') loadReview(); else if (tab === 'perdiem') loadPerDiem() })

  async function act(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    return res.json().catch(() => ({ success: false }))
  }

  async function approve(b: Batch) {
    const r = await act('/api/billing/time-management/approve', 'POST', { technicianId: b.technicianId, branchId: b.branchId, workDate: b.date, action: 'approve' })
    if (r.success) { flash('Approved.'); loadReview() } else flash(r.error || 'Failed')
  }
  async function doReturn(b: Batch) {
    if (!returnNote.trim()) { flash('Add a note so the tech knows what to fix.'); return }
    const r = await act('/api/billing/time-management/approve', 'POST', { technicianId: b.technicianId, branchId: b.branchId, workDate: b.date, action: 'return', note: returnNote })
    if (r.success) { flash('Returned to tech.'); setReturning(null); setReturnNote(''); loadReview() } else flash(r.error || 'Failed')
  }
  async function saveEntry(e: Entry) {
    if (!edit) return
    const r = await act('/api/billing/time-management/entry', 'PATCH', { kind: e.kind, id: e.id, startTime: edit.start, endTime: edit.end, workDate: edit.date || null })
    if (r.success) { flash('Time updated — batch re-opened for approval.'); setEdit(null); loadReview() } else flash(r.error || 'Failed')
  }
  async function deleteEntry(e: Entry) {
    const r = await act(`/api/billing/time-management/entry?kind=${e.kind}&id=${e.id}`, 'DELETE')
    if (r.success) { flash('Entry removed.'); loadReview() } else flash(r.error || 'Failed')
  }
  async function setPaid(row: PerDiemRow, status: 'paid' | 'pending') {
    const r = await act(`/api/billing/per-diem/${row.id}`, 'PATCH', { status })
    if (r.success) { setPerDiem((p) => p.map((x) => x.id === row.id ? { ...x, status } : x)) } else flash(r.error || 'Failed')
  }
  async function addGrant() {
    if (!newUser || !newBranch) { flash('Pick a user and a branch.'); return }
    const r = await act('/api/billing/time-approvers', 'POST', { userId: newUser, branchId: newBranch })
    if (r.success) { setNewUser(''); setNewBranch(''); loadApprovers(); flash('Approver added.') } else flash(r.error || 'Failed')
  }
  async function removeGrant(id: string) {
    const r = await act(`/api/billing/time-approvers?id=${id}`, 'DELETE')
    if (r.success) { setGrants((g) => g.filter((x) => x.id !== id)) } else flash(r.error || 'Failed')
  }

  const weekLabel = `${dayLabel(week && batches.length ? batches[0].date : week)}`
  const tabBtn = (t: Tab, label: string) => (
    <button onClick={() => setTab(t)} className={`bx-btn ${tab === t ? 'accent' : 'ghost'} sm`}>{label}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="bx-h1">Time Management</h1>
          <div className="bx-sub">Review and approve times before they export. Approved times feed payroll and the TSheets export.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="bx-btn ghost" onClick={() => setWeek(addDays(week, -7))}>‹ Prev</button>
          <button className="bx-btn ghost" onClick={() => setWeek(new Date().toISOString().slice(0, 10))}>This week</button>
          <button className="bx-btn ghost" onClick={() => setWeek(addDays(week, 7))}>Next ›</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '14px 0' }}>
        {tabBtn('review', 'Review')}
        {tabBtn('perdiem', 'Per diem')}
        {tabBtn('approvers', 'Approvers')}
      </div>

      {tab === 'review' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {canApprove && (
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>TSheets export</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{branchId ? branches.find((b) => b.id === branchId)?.name : 'Select a branch in the top bar'}</span>
              <input type="date" value={exportDate} onChange={(e) => setExportDate(e.target.value)} style={{ marginLeft: 'auto', padding: '6px 9px', border: '1px solid var(--border-emphasis)', borderRadius: 6, fontSize: 13 }} />
              <button className="bx-btn accent sm" onClick={downloadExport} disabled={!branchId} title={branchId ? '' : 'Pick a branch first'}>Download day</button>
            </div>
          )}
          {!canApprove ? (
            <div className="card"><div className="bx-note amber">You aren&apos;t set up to approve any branch. Ask an admin to grant you approver access (Approvers tab).</div></div>
          ) : batches.length === 0 ? (
            <div className="card"><div className="bx-sub">No times for this week in your branches.</div></div>
          ) : batches.map((b) => {
            const open = expanded.has(b.key)
            const pill = statusPill[b.status]
            return (
              <div key={b.key} className="card" style={{ padding: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}
                  onClick={() => setExpanded((s) => { const n = new Set(s); n.has(b.key) ? n.delete(b.key) : n.add(b.key); return n })}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', width: 70 }}>{open ? '▾' : '▸'} {dayLabel(b.date)}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{b.technicianName}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{branchName(b.branchId)}</span>
                  {b.perDiem && <span style={{ fontSize: 11, fontWeight: 700, color: '#1a7a33' }}>PER DIEM</span>}
                  <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{b.totalHours.toFixed(2)} h</span>
                  <span style={{ fontSize: 11, fontWeight: 700, background: pill.bg, color: pill.fg, padding: '3px 9px', borderRadius: 999 }}>{pill.label}</span>
                </div>

                {open && (
                  <div style={{ borderTop: '1px solid var(--border-subtle,var(--border-emphasis))', padding: '4px 8px 12px' }}>
                    {b.status === 'returned' && b.note && <div className="bx-note amber" style={{ margin: '8px 6px' }}>Returned: {b.note}</div>}
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Activity', 'Where', 'Start', 'End', 'Hours', ''].map((h) => <th key={h} style={{ ...th, textAlign: h === 'Hours' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {b.entries.map((e) => {
                          const editing = edit?.id === e.id
                          return (
                            <tr key={e.id}>
                              <td style={td}>{e.activity}</td>
                              <td style={{ ...td, color: 'var(--text-muted)' }}>{e.kind === 'yard' ? 'Yard' : e.ticketNumber}</td>
                              {editing ? (<>
                                <td style={td}><input type="time" value={edit.start} onChange={(ev) => setEdit({ ...edit, start: ev.target.value })} /></td>
                                <td style={td}><input type="time" value={edit.end} onChange={(ev) => setEdit({ ...edit, end: ev.target.value })} /></td>
                                <td style={{ ...td, textAlign: 'right' }}><input type="date" value={edit.date} onChange={(ev) => setEdit({ ...edit, date: ev.target.value })} style={{ width: 140 }} /></td>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                  <button className="bx-btn accent sm" onClick={() => saveEntry(e)}>Save</button>{' '}
                                  <button className="bx-btn ghost sm" onClick={() => setEdit(null)}>Cancel</button>
                                </td>
                              </>) : (<>
                                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{hhmm(e.startTime)}</td>
                                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{hhmm(e.endTime)}{e.date !== b.date ? ` (${dayLabel(e.date)})` : ''}</td>
                                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.hours.toFixed(2)}</td>
                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                  <button className="bx-linkbtn" onClick={() => setEdit({ id: e.id, start: hhmm(e.startTime), end: hhmm(e.endTime), date: e.date })} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>edit</button>{' · '}
                                  <button className="bx-linkbtn" onClick={() => deleteEntry(e)} style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>delete</button>
                                </td>
                              </>)}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>

                    {returning === b.key ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 6px 0' }}>
                        <input value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="What should the tech fix?" style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border-emphasis)', borderRadius: 6, fontSize: 13 }} />
                        <button className="bx-btn accent sm" onClick={() => doReturn(b)}>Send back</button>
                        <button className="bx-btn ghost sm" onClick={() => { setReturning(null); setReturnNote('') }}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, padding: '10px 6px 0' }}>
                        {b.status !== 'approved' && <button className="bx-btn accent sm" onClick={() => approve(b)}>Approve</button>}
                        {b.status === 'approved' && <button className="bx-btn ghost sm" onClick={() => approve(b)} disabled>Approved ✓</button>}
                        <button className="bx-btn ghost sm" onClick={() => { setReturning(b.key); setReturnNote('') }}>Return to adjust</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'perdiem' && (
        <div className="card">
          {perDiem.length === 0 ? <div className="bx-sub">No per diems this week.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Date', 'Technician', 'Branch', 'Status', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {perDiem.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{dayLabel(r.date)}</td>
                    <td style={td}>{r.technicianName}</td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>{branchName(r.branchId)}</td>
                    <td style={td}><span style={{ fontSize: 11, fontWeight: 700, color: r.status === 'paid' ? '#1a7a33' : 'var(--text-muted)' }}>{r.status.toUpperCase()}</span></td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.status === 'paid'
                        ? <button className="bx-btn ghost sm" onClick={() => setPaid(r, 'pending')}>Mark unpaid</button>
                        : <button className="bx-btn accent sm" onClick={() => setPaid(r, 'paid')}>Mark paid</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'approvers' && (
        <div className="card">
          {!approversAllowed ? <div className="bx-note amber">Only admins can manage approver access.</div> : (<>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14, flexWrap: 'wrap' }}>
              <div><label className="bx-lbl">User</label>
                <select className="bx-f bx-select" value={newUser} onChange={(e) => setNewUser(e.target.value)}>
                  <option value="">Select…</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className="bx-lbl">Branch</label>
                <select className="bx-f bx-select" value={newBranch} onChange={(e) => setNewBranch(e.target.value)}>
                  <option value="">Select…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></div>
              <button className="bx-btn accent" onClick={addGrant}>Add approver</button>
            </div>
            {grants.length === 0 ? <div className="bx-sub">No approvers yet. Everyone (admins included) needs a per-branch grant to approve.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['User', 'Branch', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {grants.map((g) => (
                    <tr key={g.id}>
                      <td style={td}>{g.userName}</td>
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{branchName(g.branchId)}</td>
                      <td style={{ ...td, textAlign: 'right' }}><button className="bx-btn ghost sm" onClick={() => removeGrant(g.id)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>)}
        </div>
      )}

      {toast && <div className="bx-toast">{toast}</div>}
    </div>
  )
}
