'use client'

import { useState, useEffect, useCallback } from 'react'
import Toggle from '@/components/billing/Toggle'

/**
 * Settings for the QuickBooks Desktop .iif invoice export. Everything the generator uses that
 * a bookkeeper might change without a deploy: the A/R + tax accounts, the per-kind revenue
 * account/item/memo buckets, the per-branch class, default net terms, and the name option.
 * Admin-only to save (the values map straight into your QuickBooks chart of accounts).
 */

interface KindMap { [k: string]: { account: string; item: string; memo: string } }
interface Branch { id: string; name: string; active: boolean; revenue: boolean }
interface Config {
  arAccount: string; taxAccount: string; taxZeroMemo: string; taxExtra: string
  defaultNetDays: number; nameIncludesJob: boolean; kindMap: KindMap; branchClass: Record<string, string>
}

const KIND_ROWS: { key: string; label: string }[] = [
  { key: 'rental', label: 'Equipment / rental lines' },
  { key: 'labor', label: 'Labor lines' },
  { key: 'other', label: 'Everything else (sale, lump sum, misc, adjustments)' },
]

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }
const inp: React.CSSProperties = { width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '6px 8px' }
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' }

export default function QuickBooksExportClient() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/billing/qb-export/settings').then((r) => r.json()).then((j) => {
      if (!j.success) throw new Error(j.error)
      setCfg(j.data.config); setBranches(j.data.branches); setCanManage(j.data.canManage); setErr(null)
    }).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  function patch(p: Partial<Config>) { setCfg((c) => c ? { ...c, ...p } : c); setMsg(null) }
  function setKind(key: string, field: 'account' | 'item' | 'memo', v: string) {
    setCfg((c) => {
      if (!c) return c
      const cur = c.kindMap[key] ?? { account: '', item: '', memo: '' }
      return { ...c, kindMap: { ...c.kindMap, [key]: { ...cur, [field]: v } } }
    }); setMsg(null)
  }
  function setClass(branchId: string, v: string) {
    setCfg((c) => c ? { ...c, branchClass: { ...c.branchClass, [branchId]: v } } : c); setMsg(null)
  }

  async function save() {
    if (!cfg || saving) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/billing/qb-export/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })
      const j = await res.json()
      if (!j.success) { setErr(j.error); return }
      setMsg('Saved.'); setTimeout(() => setMsg(null), 3000)
    } catch { setErr('Network error — please try again.') } finally { setSaving(false) }
  }

  if (loading || !cfg) return <div className="card" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>

  const branchesSorted = [...branches].sort((a, b) => Number(b.revenue) - Number(a.revenue) || a.name.localeCompare(b.name))

  return (
    <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>QuickBooks Export</h1>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
          How invoices map into your QuickBooks .iif file. {canManage ? 'Changes take effect on the next export.' : 'Read-only — ask an admin to change these.'}
        </div>
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--alert-danger-fg)', background: 'var(--alert-danger-bg)', borderRadius: 6, padding: '8px 10px' }}>{err}</div>}

      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Accounts</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <div><label style={lbl}>A/R account</label><input style={inp} value={cfg.arAccount} disabled={!canManage} onChange={(e) => patch({ arAccount: e.target.value })} /></div>
          <div><label style={lbl}>Sales tax account</label><input style={inp} value={cfg.taxAccount} disabled={!canManage} onChange={(e) => patch({ taxAccount: e.target.value })} /></div>
          <div><label style={lbl}>Zero-tax memo</label><input style={inp} value={cfg.taxZeroMemo} disabled={!canManage} onChange={(e) => patch({ taxZeroMemo: e.target.value })} /></div>
          <div><label style={lbl}>Tax "extra" field</label><input style={inp} value={cfg.taxExtra} disabled={!canManage} onChange={(e) => patch({ taxExtra: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', gap: '14px 32px', marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ width: 160 }}><label style={lbl}>Default net days</label><input style={inp} value={cfg.defaultNetDays} disabled={!canManage} onChange={(e) => patch({ defaultNetDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></div>
          <Toggle label="Append job as :sub-customer" disabled={!canManage} checked={cfg.nameIncludesJob} onChange={(v) => patch({ nameIncludesJob: v })} />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8 }}>Due date = invoice date + the profile/customer payment term (falls back to default net days). Customer name comes from each profile&apos;s QuickBooks name.</div>
      </div>

      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Revenue mapping</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Each invoice line posts to one of these buckets by kind.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ ...th, width: '30%' }}>Lines</th><th style={th}>Revenue account</th><th style={{ ...th, width: 170 }}>Item</th><th style={{ ...th, width: 170 }}>Memo</th></tr></thead>
          <tbody>
            {KIND_ROWS.map(({ key, label }) => {
              const m = cfg.kindMap[key] ?? { account: '', item: '', memo: '' }
              return (
                <tr key={key}>
                  <td style={{ ...td, fontSize: 12.5, color: 'var(--text-secondary)' }}>{label}</td>
                  <td style={td}><input style={inp} value={m.account} disabled={!canManage} onChange={(e) => setKind(key, 'account', e.target.value)} /></td>
                  <td style={td}><input style={inp} value={m.item} disabled={!canManage} onChange={(e) => setKind(key, 'item', e.target.value)} /></td>
                  <td style={td}><input style={inp} value={m.memo} disabled={!canManage} onChange={(e) => setKind(key, 'memo', e.target.value)} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Branch → QuickBooks class</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>The class stamped on each revenue line, by the invoice&apos;s branch.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {branchesSorted.map((b) => (
            <div key={b.id}>
              <label style={lbl}>{b.name}{!b.revenue ? ' (non-revenue)' : ''}{!b.active ? ' · inactive' : ''}</label>
              <input style={inp} value={cfg.branchClass[b.id] ?? ''} disabled={!canManage} placeholder=":TCS-XX" onChange={(e) => setClass(b.id, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={save} disabled={saving} className="btn-primary" style={{ padding: '8px 22px', opacity: saving ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Save settings'}</button>
          {msg && <span style={{ fontSize: 12.5, color: 'var(--alert-success-fg)' }}>{msg}</span>}
        </div>
      )}
    </div>
  )
}
