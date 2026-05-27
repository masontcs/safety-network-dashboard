'use client'

import { useState, useRef, useEffect } from 'react'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

type EntityCode = 'TCS' | 'INC' | 'STS'

type ImportState =
  | { status: 'idle' }
  | { status: 'loading'; label: string; progress: number }
  | {
      status: 'success'
      paymentCount: number
      matched: number
      unmatched: number
      unmatchedNames: string[]
      skipped: number
      dateFrom: string
      dateTo: string
    }
  | { status: 'error'; message: string }

function ProgressBar({ label, progress }: { label: string; progress: number }) {
  const [displayed, setDisplayed] = useState(progress)
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

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ArPaymentImportModal({ onClose, onSuccess }: Props) {
  const [entity, setEntity]   = useState<EntityCode>('TCS')
  const [file, setFile]       = useState<File | null>(null)
  const [state, setState]     = useState<ImportState>({ status: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    if (!file) return

    setState({ status: 'loading', label: 'Parsing file…', progress: 5 })

    const form = new FormData()
    form.append('file', file)
    form.append('entityCode', entity)

    try {
      const res = await fetch('/api/admin/ar/payments/import', { method: 'POST', body: form })

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
            }
            if (event.type === 'step') {
              setState({ status: 'loading', label: event.label ?? '', progress: event.progress ?? 0 })
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
        status:         'success',
        paymentCount:   finalData.paymentCount as number,
        matched:        finalData.matched as number,
        unmatched:      finalData.unmatched as number,
        unmatchedNames: (finalData.unmatchedNames as string[]) ?? [],
        skipped:        finalData.skipped as number,
        dateFrom:       finalData.dateFrom as string,
        dateTo:         finalData.dateTo as string,
      })
      // Do not auto-close — user needs to read the results
    } catch {
      setState({ status: 'error', message: 'Network error — please try again' })
    }
  }

  const isLoading = state.status === 'loading'
  const isDone    = state.status === 'success' || state.status === 'error'

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
        width: 440,
        maxWidth: '90vw',
      }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
          Import Payments
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 20 }}>
          QuickBooks Transaction List by Customer export (.xlsx)
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
                  border: `1px solid ${entity === e ? '#ff6b00' : '#333'}`,
                  background: entity === e ? 'rgba(255,107,0,0.12)' : '#2a2a2a',
                  color: entity === e ? '#ff6b00' : '#888',
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
                : state.status === 'error'   ? '#cc4444'
                : file ? '#ff6b00'
                : '#444'
              }`,
              borderRadius: 8,
              padding: '14px 16px',
              textAlign: 'center',
              cursor: isLoading ? 'default' : 'pointer',
              color: file ? '#ff6b00' : '#666',
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

        {/* Progress bar */}
        {state.status === 'loading' && (
          <div style={{ marginBottom: 16 }}>
            <ProgressBar label={state.label} progress={state.progress} />
          </div>
        )}

        {/* Success summary */}
        {state.status === 'success' && (
          <div style={{ marginBottom: 16 }}>
            {/* Main stats */}
            <div style={{
              padding: '12px 14px',
              borderRadius: state.unmatched > 0 ? '8px 8px 0 0' : 8,
              background: 'rgba(76,175,80,0.08)',
              border: '1px solid #2d5a2d',
              borderBottom: state.unmatched > 0 ? 'none' : '1px solid #2d5a2d',
            }}>
              <div style={{ fontSize: 12, color: '#4caf50', fontWeight: 500, marginBottom: 8 }}>
                ✓ Import complete
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                {([
                  ['Payments found',       state.paymentCount],
                  ['Matched to customers', state.matched],
                  ['Skipped (duplicates)', state.skipped],
                  ['Unmatched',            state.unmatched],
                ] as [string, number][]).map(([label, val]) => (
                  <div key={label} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <span style={{ color: val > 0 && label === 'Unmatched' ? '#ff9800' : '#ccc' }}>{val}</span>{' '}
                    {label}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
                {state.dateFrom} → {state.dateTo}
              </div>
            </div>

            {/* Unmatched names — collapsible list */}
            {state.unmatched > 0 && (
              <div style={{
                border: '1px solid #2d5a2d',
                borderTop: '1px solid var(--border-emphasis)',
                borderRadius: '0 0 8px 8px',
                background: '#181818',
                padding: '10px 14px',
              }}>
                <div style={{ fontSize: 11, color: '#ff9800', marginBottom: 6, fontWeight: 500 }}>
                  {state.unmatched} QB name{state.unmatched !== 1 ? 's' : ''} not found in this entity's customer list:
                </div>
                <div style={{
                  maxHeight: 130,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}>
                  {state.unmatchedNames.map((name) => (
                    <div key={name} style={{
                      fontSize: 11,
                      color: '#999',
                      padding: '2px 0',
                      borderBottom: '1px solid #222',
                      fontFamily: 'monospace',
                    }}>
                      {name}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>
                  Payments were still saved. To match them, add these QB names to the customer's entity ref in the customer detail page.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
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
            onClick={onClose}
            disabled={isLoading}
            style={{
              background: 'transparent', border: '1px solid var(--border-emphasis)', borderRadius: 8,
              color: 'var(--text-muted)', padding: '8px 16px', fontSize: 13,
              cursor: isLoading ? 'default' : 'pointer',
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {isDone ? 'Close' : 'Cancel'}
          </button>
          {!isDone && (
            <button
              onClick={handleSubmit}
              disabled={isLoading || !file}
              style={{
                background: '#ff6b00',
                border: 'none', borderRadius: 8,
                color: 'var(--text-primary)', padding: '8px 20px', fontSize: 13, fontWeight: 500,
                cursor: isLoading || !file ? 'default' : 'pointer',
                opacity: isLoading || !file ? 0.5 : 1,
              }}
            >
              {isLoading ? 'Importing…' : 'Import Payments'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
