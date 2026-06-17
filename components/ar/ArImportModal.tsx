'use client'

import { useState, useRef, useEffect } from 'react'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

type EntityCode = 'TCS' | 'INC' | 'STS'

type State =
  | { status: 'idle' }
  | { status: 'loading'; label: string; progress: number }
  | { status: 'entity_mismatch'; detectedEntity: string; confidence: number }
  | { status: 'success'; invoiceCount: number; totalAr: number; newCustomers: number; crossLinked: number }
  | { status: 'error'; message: string }

function ProgressBar({ label, progress }: { label: string; progress: number }) {
  const [displayed, setDisplayed] = useState(progress)

  // Animate to new progress value instead of jumping
  useEffect(() => { setDisplayed(progress) }, [progress])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ width: '100%', height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${displayed}%`,
            background: '#ff6b00',
            borderRadius: 2,
            transition: 'width 0.35s ease-out',
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{Math.round(displayed)}%</div>
    </div>
  )
}

export default function ArImportModal({ onClose, onSuccess }: Props) {
  const [entity, setEntity]       = useState<EntityCode>('TCS')
  const [reportDate, setReportDate] = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [state, setState]         = useState<State>({ status: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (forceEntity = false) => {
    if (!file) return

    setState({ status: 'loading', label: 'Parsing file…', progress: 5 })

    const form = new FormData()
    form.append('file', file)
    form.append('entityCode', entity)
    if (reportDate) form.append('reportDate', reportDate)
    if (forceEntity) form.append('forceEntity', 'true')

    try {
      const res = await fetch('/api/admin/ar/import', { method: 'POST', body: form })

      // Non-stream error responses (400/401/403/413)
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('x-ndjson')) {
        const json = await res.json()
        setState({ status: 'error', message: json.error ?? 'Import failed' })
        return
      }

      if (!res.body) {
        setState({ status: 'error', message: 'Streaming not supported by this browser.' })
        return
      }

      // Read NDJSON stream
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let finalData: Record<string, unknown> | null = null

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop() ?? ''

        for (const line of parts) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as {
              type: string
              label?: string
              progress?: number
              data?: Record<string, unknown>
              error?: string
              detectedEntity?: string
              confidence?: number
            }
            if (event.type === 'step') {
              setState({
                status: 'loading',
                label: event.label ?? '',
                progress: event.progress ?? 0,
              })
            } else if (event.type === 'entity_mismatch') {
              setState({
                status: 'entity_mismatch',
                detectedEntity: event.detectedEntity as string,
                confidence: event.confidence as number,
              })
              return
            } else if (event.type === 'done') {
              finalData = event.data ?? null
              break outer
            } else if (event.type === 'error') {
              setState({ status: 'error', message: event.error ?? 'Import failed' })
              return
            }
          } catch {
            // ignore malformed lines
          }
        }
      }

      if (!finalData) {
        setState({ status: 'error', message: 'No response received from server.' })
        return
      }

      setState({
        status: 'success',
        invoiceCount: finalData.invoiceCount as number,
        totalAr: finalData.totalAr as number,
        newCustomers: finalData.newCustomers as number,
        crossLinked: finalData.crossLinked as number,
      })

      setTimeout(onSuccess, 1400)
    } catch {
      setState({ status: 'error', message: 'Network error — please try again' })
    }
  }

  const isLoading  = state.status === 'loading'
  const isDone     = state.status === 'success' || state.status === 'error'
  const isMismatch = state.status === 'entity_mismatch'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isLoading) onClose() }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 24,
        width: 420,
        maxWidth: '90vw',
      }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 20 }}>
          Import AR File
        </div>

        {/* Entity selector */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            Entity
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['TCS', 'INC', 'STS'] as EntityCode[]).map((e) => (
              <button
                key={e}
                onClick={() => !isLoading && setEntity(e)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: `1px solid ${entity === e ? '#ff6b00' : 'var(--border-emphasis)'}`,
                  background: entity === e ? 'rgba(255,107,0,0.12)' : 'var(--bg-secondary)',
                  color: entity === e ? '#ff6b00' : 'var(--text-muted)',
                  fontSize: 13,
                  fontWeight: entity === e ? 500 : 400,
                  cursor: isLoading ? 'default' : 'pointer',
                  opacity: isLoading ? 0.5 : 1,
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Report date */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            Report Date <span style={{ color: 'var(--text-faint)' }}>(optional — defaults to today)</span>
          </label>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            disabled={isLoading}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border-emphasis)', borderRadius: 8,
              color: 'var(--text-secondary)', padding: '7px 12px', fontSize: 13, width: '100%',
              outline: 'none', boxSizing: 'border-box',
              opacity: isLoading ? 0.5 : 1,
            }}
          />
        </div>

        {/* File picker */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            File (.xlsx, .xlsm)
          </label>
          <div
            onClick={() => !isLoading && inputRef.current?.click()}
            style={{
              background: 'var(--bg-secondary)',
              border: `1px dashed ${
                state.status === 'success' ? '#4caf50'
                : state.status === 'error' ? '#cc4444'
                : file ? '#ff6b00'
                : 'var(--text-faint)'
              }`,
              borderRadius: 8,
              padding: '14px 16px',
              textAlign: 'center',
              cursor: isLoading ? 'default' : 'pointer',
              color: file ? '#ff6b00' : 'var(--text-dim)',
              fontSize: 13,
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {file ? file.name : 'Click to select file'}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            style={{ display: 'none' }}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setState({ status: 'idle' })
            }}
          />
        </div>

        {/* Progress bar — shown while importing */}
        {state.status === 'loading' && (
          <div style={{ marginBottom: 16 }}>
            <ProgressBar label={state.label} progress={state.progress} />
          </div>
        )}

        {/* Entity mismatch warning */}
        {state.status === 'entity_mismatch' && (
          <div style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(204,68,68,0.08)',
            border: '1px solid #663333',
          }}>
            <div style={{ fontSize: 13, color: '#cc4444', fontWeight: 500, marginBottom: 6 }}>
              Wrong entity selected?
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {state.confidence}% of customers in this file match{' '}
              <span style={{ color: '#ff6b00', fontWeight: 500 }}>{state.detectedEntity}</span>{' '}
              records, but you selected{' '}
              <span style={{ color: '#ff6b00', fontWeight: 500 }}>{entity}</span>.
              Did you upload the wrong file?
            </div>
          </div>
        )}

        {/* Success summary */}
        {state.status === 'success' && (
          <div style={{
            marginBottom: 16,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(76,175,80,0.08)',
            border: '1px solid #2d5a2d',
          }}>
            <div style={{ fontSize: 12, color: '#4caf50', fontWeight: 500, marginBottom: 4 }}>
              ✓ Import complete
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              {state.invoiceCount} invoices · ${state.totalAr.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              {state.newCustomers > 0 && <> · {state.newCustomers} new customer{state.newCustomers !== 1 ? 's' : ''}</>}
              {state.crossLinked > 0 && <> · {state.crossLinked} linked across entities</>}
            </div>
          </div>
        )}

        {/* Error message */}
        {state.status === 'error' && (
          <div style={{
            marginBottom: 16,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(204,68,68,0.1)',
            border: '1px solid #663333',
            color: '#cc4444',
            fontSize: 12,
          }}>
            {state.message}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => isMismatch ? setState({ status: 'idle' }) : onClose()}
            disabled={isLoading}
            style={{
              background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 8,
              color: 'var(--text-muted)', padding: '8px 16px', fontSize: 13,
              cursor: isLoading ? 'default' : 'pointer',
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {isDone ? 'Close' : isMismatch ? 'Cancel' : 'Cancel'}
          </button>
          {isMismatch && (
            <button
              onClick={() => handleSubmit(true)}
              style={{
                background: '#663333',
                border: '1px solid #cc4444', borderRadius: 8,
                color: '#cc4444', padding: '8px 16px', fontSize: 13, fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Import Anyway
            </button>
          )}
          {!isDone && !isMismatch && (
            <button
              onClick={() => handleSubmit()}
              disabled={isLoading || !file}
              style={{
                background: '#ff6b00',
                border: 'none', borderRadius: 8,
                color: 'var(--text-primary)', padding: '8px 20px', fontSize: 13, fontWeight: 500,
                cursor: isLoading || !file ? 'default' : 'pointer',
                opacity: isLoading || !file ? 0.5 : 1,
              }}
            >
              {isLoading ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
