'use client'

import { useState, useRef } from 'react'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

type EntityCode = 'TCS' | 'INC' | 'STS'

export default function ArImportModal({ onClose, onSuccess }: Props) {
  const [entity, setEntity]       = useState<EntityCode>('TCS')
  const [reportDate, setReportDate] = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [status, setStatus]       = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    if (!file) { setMessage('Please select a file.'); return }

    setStatus('loading')
    setMessage('')

    const form = new FormData()
    form.append('file', file)
    form.append('entityCode', entity)
    if (reportDate) form.append('reportDate', reportDate)

    try {
      const res = await fetch('/api/admin/ar/import', { method: 'POST', body: form })
      const data = await res.json()

      if (!res.ok) {
        setStatus('error')
        setMessage(data.error ?? 'Import failed')
        return
      }

      setStatus('success')
      setMessage(
        `Imported ${data.invoiceCount} invoices · $${Number(data.totalAr).toLocaleString('en-US', { minimumFractionDigits: 2 })} total AR` +
        (data.newCustomers > 0 ? ` · ${data.newCustomers} new customer${data.newCustomers !== 1 ? 's' : ''}` : '') +
        (data.crossLinked > 0 ? ` · ${data.crossLinked} linked across entities` : '')
      )
      setTimeout(onSuccess, 1200)
    } catch {
      setStatus('error')
      setMessage('Network error — please try again')
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#1e1e1e',
        border: '1px solid #2a2a2a',
        borderRadius: 12,
        padding: 24,
        width: 420,
        maxWidth: '90vw',
      }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: '#fff', marginBottom: 20 }}>
          Import AR File
        </div>

        {/* Entity */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            Entity
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['TCS', 'INC', 'STS'] as EntityCode[]).map((e) => (
              <button
                key={e}
                onClick={() => setEntity(e)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: `1px solid ${entity === e ? '#ff6b00' : '#333'}`,
                  background: entity === e ? 'rgba(255,107,0,0.12)' : '#2a2a2a',
                  color: entity === e ? '#ff6b00' : '#888',
                  fontSize: 13,
                  fontWeight: entity === e ? 500 : 400,
                  cursor: 'pointer',
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Report Date */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            Report Date <span style={{ color: '#555' }}>(optional — defaults to today)</span>
          </label>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            style={{
              background: '#2a2a2a', border: '1px solid #333', borderRadius: 8,
              color: '#ccc', padding: '7px 12px', fontSize: 13, width: '100%',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* File */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            File (.xlsx)
          </label>
          <div
            onClick={() => inputRef.current?.click()}
            style={{
              background: '#2a2a2a',
              border: `1px dashed ${file ? '#ff6b00' : '#444'}`,
              borderRadius: 8,
              padding: '16px',
              textAlign: 'center',
              cursor: 'pointer',
              color: file ? '#ff6b00' : '#666',
              fontSize: 13,
            }}
          >
            {file ? file.name : 'Click to select file'}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* Status message */}
        {message && (
          <div style={{
            marginBottom: 16,
            padding: '8px 12px',
            borderRadius: 8,
            background: status === 'error' ? 'rgba(204,68,68,0.12)' : 'rgba(255,107,0,0.12)',
            color: status === 'error' ? '#cc4444' : '#ff6b00',
            fontSize: 12,
          }}>
            {message}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={status === 'loading'}
            style={{
              background: 'transparent', border: '1px solid #333', borderRadius: 8,
              color: '#888', padding: '8px 16px', fontSize: 13, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={status === 'loading' || status === 'success' || !file}
            style={{
              background: status === 'success' ? '#2a5a2a' : '#ff6b00',
              border: 'none', borderRadius: 8,
              color: '#fff', padding: '8px 20px', fontSize: 13, fontWeight: 500,
              cursor: status === 'loading' || !file ? 'default' : 'pointer',
              opacity: status === 'loading' || !file ? 0.6 : 1,
            }}
          >
            {status === 'loading' ? 'Importing…' : status === 'success' ? 'Done ✓' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
