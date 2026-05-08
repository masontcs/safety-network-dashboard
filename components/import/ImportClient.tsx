'use client'

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react'
import { formatPeriodDate } from '@/lib/utils/date'

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'payroll' | 'revenue' | 'fuel'
type EntityCode = 'INC' | 'TCS' | 'STS'

type UploadState =
  | { status: 'idle' }
  | { status: 'ready'; file: File }
  | { status: 'uploading'; label?: string; progress?: number }
  | { status: 'success'; lines: string[] }
  | { status: 'error'; message: string }
  | { status: 'duplicate'; conflict: { importId: string; periodDate?: string; entityCode?: string; dateRangeStart?: string; dateRangeEnd?: string }; file: File }

type PayrollHistoryRow = { id: string; periodDate: string; entityCode: string; importedAt: string; status: string }
type RevenueHistoryRow = { id: string; periodDate: string; importedAt: string; status: string }
type FuelHistoryRow    = { id: string; vendor: string; dateRangeStart: string; dateRangeEnd: string; importedAt: string; status: string }

// ─── Drop zone ────────────────────────────────────────────────────────────────

interface DropZoneProps {
  accept: string
  state: UploadState
  onFile: (file: File) => void
  label: string
  hint: string
}

function DropZone({ accept, state, onFile, label, hint }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    e.target.value = ''
  }

  const isActive = state.status === 'idle' || state.status === 'ready'
  const border = dragging
    ? '2px dashed #ff6b00'
    : state.status === 'error'
    ? '2px dashed #cc4444'
    : state.status === 'success'
    ? '2px dashed #4caf50'
    : '2px dashed #2a2a2a'

  return (
    <div
      onClick={() => isActive && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border,
        borderRadius: 10,
        padding: '20px 16px',
        textAlign: 'center',
        cursor: isActive ? 'pointer' : 'default',
        background: dragging ? '#1a1a1a' : 'transparent',
        transition: 'border-color 0.15s',
        minHeight: 90,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleChange} />

      {state.status === 'idle' && (
        <>
          <UploadIcon />
          <div style={{ fontSize: 12, color: '#888888', marginTop: 4 }}>{label}</div>
          <div style={{ fontSize: 11, color: '#555555' }}>{hint}</div>
        </>
      )}

      {state.status === 'ready' && (
        <>
          <FileIcon />
          <div style={{ fontSize: 12, color: '#cccccc', marginTop: 4 }}>{state.file.name}</div>
          <div style={{ fontSize: 11, color: '#555555' }}>
            {(state.file.size / 1024).toFixed(0)} KB — click to change
          </div>
        </>
      )}

      {state.status === 'uploading' && (
        <UploadingState label={state.label} progress={state.progress} />
      )}

      {state.status === 'success' && (
        <>
          <CheckIcon />
          <div style={{ fontSize: 12, color: '#4caf50', marginTop: 4 }}>Import successful</div>
        </>
      )}

      {state.status === 'error' && (
        <>
          <ErrorIcon />
          <div style={{ fontSize: 12, color: '#cc4444', marginTop: 4, maxWidth: 240 }}>
            {state.message}
          </div>
        </>
      )}

      {state.status === 'duplicate' && (
        <>
          <WarnIcon />
          <div style={{ fontSize: 12, color: '#ff9800', marginTop: 4 }}>
            Duplicate detected
          </div>
        </>
      )}
    </div>
  )
}

// ─── Payroll helpers ──────────────────────────────────────────────────────────

function buildPayrollSuccessLines(d: Record<string, unknown>, replaced = false): string[] {
  return [
    `Period: ${formatPeriodDate(d.periodDate as string)}${replaced ? ' (replaced)' : ''}`,
    `Entity: ${d.entityCode as string}`,
    `${d.transactionCount as number} payroll transactions`,
    (d.taxCount as number) > 0 ? `${d.taxCount as number} tax entries` : null,
    (d.pendingEmployeeCount as number) > 0 ? `${d.pendingEmployeeCount as number} employees need review` : null,
    (d.stagedItemTxnCount as number) > 0
      ? `${d.stagedItemTxnCount as number} transactions staged — ${d.newItemCount as number} new item${(d.newItemCount as number) !== 1 ? 's' : ''} need review`
      : null,
    ...((d.warnings as string[]) ?? []),
  ].filter(Boolean) as string[]
}

// ─── Payroll section ──────────────────────────────────────────────────────────

function PayrollSection({ onSuccess }: { onSuccess: () => void }) {
  const [entity, setEntity] = useState<EntityCode>('INC')
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const [confirmLoading, setConfirmLoading] = useState(false)

  const handleFile = (file: File) => setState({ status: 'ready', file })

  const handleUpload = async () => {
    if (state.status !== 'ready') return
    const file = state.file
    setState({ status: 'uploading' })

    const form = new FormData()
    form.append('file', file)
    form.append('entityCode', entity)

    try {
      const res = await fetch('/api/import/payroll', { method: 'POST', body: form })

      // Non-stream responses: 409 duplicate, 400 validation, 401/403 auth errors
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('x-ndjson')) {
        const json = await res.json()
        if (res.status === 409 && json.conflict) {
          setState({ status: 'duplicate', conflict: json.conflict, file })
          return
        }
        setState({ status: 'error', message: json.error ?? 'Upload failed.' })
        return
      }

      // Stream path — read NDJSON events as they arrive
      if (!res.body) {
        setState({ status: 'error', message: 'Streaming not supported by this browser.' })
        return
      }

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
              type: string; label?: string; progress?: number
              current?: number; total?: number
              data?: Record<string, unknown>; error?: string
            }
            if (event.type === 'step') {
              setState({ status: 'uploading', label: event.label, progress: event.progress })
            } else if (event.type === 'done') {
              finalData = event.data ?? null
              break outer
            } else if (event.type === 'error') {
              setState({ status: 'error', message: event.error ?? 'Upload failed.' })
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

      setState({ status: 'success', lines: buildPayrollSuccessLines(finalData) })
      onSuccess()
    } catch {
      setState({ status: 'error', message: 'Network error — please try again.' })
    }
  }

  const handleConfirmReplace = async () => {
    if (state.status !== 'duplicate') return
    const { file, conflict } = state
    setConfirmLoading(true)
    setState({ status: 'uploading' })

    const form = new FormData()
    form.append('file', file)
    form.append('entityCode', entity)
    form.append('replaceImportId', conflict.importId)

    try {
      const res = await fetch('/api/import/payroll/confirm-replace', { method: 'POST', body: form })

      // Non-stream responses: 400/401/403/404 errors
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('x-ndjson')) {
        const json = await res.json()
        setState({ status: 'error', message: json.error ?? 'Replace failed.' })
        return
      }

      if (!res.body) {
        setState({ status: 'error', message: 'Streaming not supported by this browser.' })
        return
      }

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
              type: string; label?: string; progress?: number
              current?: number; total?: number
              data?: Record<string, unknown>; error?: string
            }
            if (event.type === 'step') {
              setState({ status: 'uploading', label: event.label, progress: event.progress })
            } else if (event.type === 'done') {
              finalData = event.data ?? null
              break outer
            } else if (event.type === 'error') {
              setState({ status: 'error', message: event.error ?? 'Replace failed.' })
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

      const lines = buildPayrollSuccessLines(finalData, true)
      setState({ status: 'success', lines })
      onSuccess()
    } catch {
      setState({ status: 'error', message: 'Network error — please try again.' })
    } finally {
      setConfirmLoading(false)
    }
  }

  const isDuplicate = state.status === 'duplicate'

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>Payroll</div>
        <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>
          QuickBooks .xlsm — one entity per upload
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: '#888888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Entity
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['INC', 'TCS', 'STS'] as EntityCode[]).map((code) => (
            <button
              key={code}
              onClick={() => setEntity(code)}
              className={`filter-pill${entity === code ? ' filter-pill-active' : ''}`}
              style={{ fontFamily: 'inherit' }}
            >
              {code}
            </button>
          ))}
        </div>
      </div>

      <DropZone
        accept=".xlsm,.xlsx,.xls"
        state={state}
        onFile={handleFile}
        label="Drop payroll file here or click to browse"
        hint=".xlsm · .xlsx · .xls"
      />

      {isDuplicate && (
        <div style={{ background: '#2a1a00', border: '1px solid #ff9800', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, color: '#ff9800', fontWeight: 500, marginBottom: 4 }}>Duplicate import detected</div>
          <div style={{ fontSize: 12, color: '#cccccc', marginBottom: 10 }}>
            An import already exists for{' '}
            <strong>{state.status === 'duplicate' && state.conflict.periodDate ? formatPeriodDate(state.conflict.periodDate) : ''}</strong>
            {' '}({entity}). Replacing it will permanently delete the previous import.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleConfirmReplace} disabled={confirmLoading} className="btn-primary" style={{ fontSize: 12, padding: '6px 14px', opacity: confirmLoading ? 0.6 : 1 }}>
              {confirmLoading ? 'Replacing…' : 'Replace'}
            </button>
            <button onClick={() => setState({ status: 'idle' })} style={{ background: '#2a2a2a', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#888888', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.status === 'success' && (
        <ResultSummary lines={state.lines} onReset={() => setState({ status: 'idle' })} />
      )}

      {state.status === 'ready' && (
        <button onClick={handleUpload} className="btn-primary" style={{ alignSelf: 'flex-start' }}>
          Upload Payroll
        </button>
      )}

      {state.status === 'error' && (
        <button onClick={() => setState({ status: 'idle' })} style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 12, cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}>
          Try again
        </button>
      )}
    </section>
  )
}

// ─── Revenue section ──────────────────────────────────────────────────────────

function RevenueSection({ onSuccess }: { onSuccess: () => void }) {
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const [confirmLoading, setConfirmLoading] = useState(false)

  const handleUpload = async () => {
    if (state.status !== 'ready') return
    const file = state.file
    setState({ status: 'uploading' })

    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/api/import/revenue', { method: 'POST', body: form })
      const json = await res.json()

      if (res.status === 409 && json.conflict) {
        setState({ status: 'duplicate', conflict: json.conflict, file })
        return
      }
      if (!json.success) {
        setState({ status: 'error', message: json.error ?? 'Upload failed.' })
        return
      }

      const d = json.data
      const lines = [
        `Period: ${formatPeriodDate(d.periodDate)}`,
        `${d.insertedCount} transactions inserted`,
        d.skippedCount > 0 ? `${d.skippedCount} rows skipped` : null,
        ...((d.warnings as string[]) ?? []),
      ].filter(Boolean) as string[]

      setState({ status: 'success', lines })
      onSuccess()
    } catch {
      setState({ status: 'error', message: 'Network error — please try again.' })
    }
  }

  const handleConfirmReplace = async () => {
    if (state.status !== 'duplicate') return
    const { file, conflict } = state
    setConfirmLoading(true)

    const form = new FormData()
    form.append('file', file)
    form.append('replaceImportId', conflict.importId)

    try {
      const res = await fetch('/api/import/revenue/confirm-replace', { method: 'POST', body: form })
      const json = await res.json()

      if (!json.success) {
        setState({ status: 'error', message: json.error ?? 'Replace failed.' })
        return
      }

      const d = json.data
      const lines = [
        `Period: ${formatPeriodDate(d.periodDate)} (replaced)`,
        `${d.insertedCount} transactions inserted`,
        d.skippedCount > 0 ? `${d.skippedCount} rows skipped` : null,
        ...((d.warnings as string[]) ?? []),
      ].filter(Boolean) as string[]

      setState({ status: 'success', lines })
      onSuccess()
    } catch {
      setState({ status: 'error', message: 'Network error — please try again.' })
    } finally {
      setConfirmLoading(false)
    }
  }

  const isDuplicate = state.status === 'duplicate'

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>Revenue</div>
        <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>QuickBooks revenue export .xls</div>
      </div>

      <DropZone
        accept=".xls,.xlsx"
        state={state}
        onFile={(f) => setState({ status: 'ready', file: f })}
        label="Drop revenue file here or click to browse"
        hint=".xls · .xlsx"
      />

      {isDuplicate && (
        <div style={{ background: '#2a1a00', border: '1px solid #ff9800', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, color: '#ff9800', fontWeight: 500, marginBottom: 4 }}>Duplicate import detected</div>
          <div style={{ fontSize: 12, color: '#cccccc', marginBottom: 10 }}>
            Revenue is already imported for{' '}
            <strong>{state.status === 'duplicate' && state.conflict.periodDate ? formatPeriodDate(state.conflict.periodDate) : ''}</strong>.
            {' '}Replacing it will permanently delete the previous import.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleConfirmReplace} disabled={confirmLoading} className="btn-primary" style={{ fontSize: 12, padding: '6px 14px', opacity: confirmLoading ? 0.6 : 1 }}>
              {confirmLoading ? 'Replacing…' : 'Replace'}
            </button>
            <button onClick={() => setState({ status: 'idle' })} style={{ background: '#2a2a2a', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#888888', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.status === 'success' && (
        <ResultSummary lines={state.lines} onReset={() => setState({ status: 'idle' })} />
      )}

      {state.status === 'ready' && (
        <button onClick={handleUpload} className="btn-primary" style={{ alignSelf: 'flex-start' }}>
          Upload Revenue
        </button>
      )}

      {state.status === 'error' && (
        <button onClick={() => setState({ status: 'idle' })} style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 12, cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}>
          Try again
        </button>
      )}
    </section>
  )
}

// ─── Fuel section ─────────────────────────────────────────────────────────────

function FuelSection({ onSuccess }: { onSuccess: () => void }) {
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const [confirmLoading, setConfirmLoading] = useState(false)

  const handleUpload = async () => {
    if (state.status !== 'ready') return
    const file = state.file
    setState({ status: 'uploading' })

    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/api/import/fuel', { method: 'POST', body: form })
      const json = await res.json()

      if (res.status === 409 && json.conflict) {
        setState({ status: 'duplicate', conflict: json.conflict, file })
        return
      }
      if (!json.success) {
        setState({ status: 'error', message: json.error ?? 'Upload failed.' })
        return
      }

      const d = json.data
      const lines = [
        `Vendor: ${d.vendor}`,
        `${d.dateRangeStart} – ${d.dateRangeEnd}`,
        `${d.insertedCount} transactions inserted`,
        d.newCardCount > 0 ? `${d.newCardCount} new fuel cards — review needed` : null,
        ...((d.warnings as string[]) ?? []),
      ].filter(Boolean) as string[]

      setState({ status: 'success', lines })
      onSuccess()
    } catch {
      setState({ status: 'error', message: 'Network error — please try again.' })
    }
  }

  const handleConfirmReplace = async () => {
    if (state.status !== 'duplicate') return
    const { file, conflict } = state
    setConfirmLoading(true)

    const form = new FormData()
    form.append('file', file)
    form.append('replaceImportId', conflict.importId)

    try {
      const res = await fetch('/api/import/fuel/confirm-replace', { method: 'POST', body: form })
      const json = await res.json()

      if (!json.success) {
        setState({ status: 'error', message: json.error ?? 'Replace failed.' })
        return
      }

      const d = json.data
      const lines = [
        `Vendor: ${d.vendor} (replaced)`,
        `${d.dateRangeStart} – ${d.dateRangeEnd}`,
        `${d.insertedCount} transactions inserted`,
        d.newCardCount > 0 ? `${d.newCardCount} new fuel cards — review needed` : null,
        ...((d.warnings as string[]) ?? []),
      ].filter(Boolean) as string[]

      setState({ status: 'success', lines })
      onSuccess()
    } catch {
      setState({ status: 'error', message: 'Network error — please try again.' })
    } finally {
      setConfirmLoading(false)
    }
  }

  const isDuplicate = state.status === 'duplicate'

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>Fuel</div>
        <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>Interstate or Flyers export .csv or .xlsx</div>
      </div>

      <DropZone
        accept=".csv,.xlsx,.xls"
        state={state}
        onFile={(f) => setState({ status: 'ready', file: f })}
        label="Drop fuel file here or click to browse"
        hint=".csv · .xlsx"
      />

      {isDuplicate && (
        <div style={{ background: '#2a1a00', border: '1px solid #ff9800', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, color: '#ff9800', fontWeight: 500, marginBottom: 4 }}>Duplicate import detected</div>
          <div style={{ fontSize: 12, color: '#cccccc', marginBottom: 10 }}>
            Fuel data already exists for{' '}
            <strong>{state.status === 'duplicate' ? `${state.conflict.dateRangeStart} – ${state.conflict.dateRangeEnd}` : ''}</strong>.
            {' '}Replacing it will permanently delete the previous import.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleConfirmReplace} disabled={confirmLoading} className="btn-primary" style={{ fontSize: 12, padding: '6px 14px', opacity: confirmLoading ? 0.6 : 1 }}>
              {confirmLoading ? 'Replacing…' : 'Replace'}
            </button>
            <button onClick={() => setState({ status: 'idle' })} style={{ background: '#2a2a2a', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#888888', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.status === 'success' && (
        <ResultSummary lines={state.lines} onReset={() => setState({ status: 'idle' })} />
      )}

      {state.status === 'ready' && (
        <button onClick={handleUpload} className="btn-primary" style={{ alignSelf: 'flex-start' }}>
          Upload Fuel
        </button>
      )}

      {state.status === 'error' && (
        <button onClick={() => setState({ status: 'idle' })} style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 12, cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}>
          Try again
        </button>
      )}
    </section>
  )
}

// ─── Result summary ───────────────────────────────────────────────────────────

function ResultSummary({ lines, onReset }: { lines: string[]; onReset: () => void }) {
  return (
    <div style={{ background: '#0a1f0a', border: '1px solid #2d5a2d', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 12, color: '#4caf50', fontWeight: 500, marginBottom: 6 }}>✓ Import complete</div>
      {lines.map((line, i) => (
        <div key={i} style={{ fontSize: 12, color: line.includes('review') || line.includes('flagged') || line.includes('corrected') ? '#ff9800' : '#888888', marginBottom: 2 }}>
          {line}
        </div>
      ))}
      <button onClick={onReset} style={{ marginTop: 8, background: 'none', border: 'none', color: '#555555', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
        Import another file
      </button>
    </div>
  )
}

// ─── Import history panel ─────────────────────────────────────────────────────

function formatImportedAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function HistoryPanel({ activeTab, refreshKey }: { activeTab: ImportType; refreshKey: number }) {
  const [payroll, setPayroll] = useState<PayrollHistoryRow[] | null>(null)
  const [revenue, setRevenue] = useState<RevenueHistoryRow[] | null>(null)
  const [fuel, setFuel]       = useState<FuelHistoryRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/import/history?type=${activeTab}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) return
        if (activeTab === 'payroll') setPayroll(json.data)
        if (activeTab === 'revenue') setRevenue(json.data)
        if (activeTab === 'fuel')    setFuel(json.data)
      })
      .finally(() => setLoading(false))
  }, [activeTab, refreshKey])

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    fontSize: 11,
    color: '#666666',
    fontWeight: 400,
    padding: '0 12px 8px 0',
    whiteSpace: 'nowrap',
  }
  const tdStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#cccccc',
    padding: '7px 12px 7px 0',
    borderTop: '1px solid #2a2a2a',
    whiteSpace: 'nowrap',
  }

  const rows = activeTab === 'payroll' ? payroll : activeTab === 'revenue' ? revenue : fuel
  const isEmpty = !loading && rows !== null && rows.length === 0

  return (
    <div style={{ overflowX: 'auto' }}>
      {loading && (
        <div style={{ fontSize: 12, color: '#555555', padding: '16px 0' }}>Loading…</div>
      )}

      {isEmpty && (
        <div style={{ fontSize: 12, color: '#555555', padding: '16px 0' }}>No imports yet.</div>
      )}

      {!loading && activeTab === 'payroll' && payroll && payroll.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Period</th>
              <th style={thStyle}>Entity</th>
              <th style={thStyle}>Imported</th>
            </tr>
          </thead>
          <tbody>
            {payroll.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}>{formatPeriodDate(r.periodDate)}</td>
                <td style={{ ...tdStyle }}>
                  <span style={{ background: '#2a2a2a', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#ff6b00' }}>
                    {r.entityCode}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: '#888888' }}>{formatImportedAt(r.importedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && activeTab === 'revenue' && revenue && revenue.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Period</th>
              <th style={thStyle}>Imported</th>
            </tr>
          </thead>
          <tbody>
            {revenue.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}>{formatPeriodDate(r.periodDate)}</td>
                <td style={{ ...tdStyle, color: '#888888' }}>{formatImportedAt(r.importedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && activeTab === 'fuel' && fuel && fuel.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Vendor</th>
              <th style={thStyle}>Date Range</th>
              <th style={thStyle}>Imported</th>
            </tr>
          </thead>
          <tbody>
            {fuel.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}>
                  <span style={{ background: '#2a2a2a', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#cccccc', textTransform: 'capitalize' }}>
                    {r.vendor}
                  </span>
                </td>
                <td style={tdStyle}>{r.dateRangeStart} – {r.dateRangeEnd}</td>
                <td style={{ ...tdStyle, color: '#888888' }}>{formatImportedAt(r.importedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function ImportClient() {
  const [historyTab, setHistoryTab] = useState<ImportType>('payroll')
  const [refreshKey, setRefreshKey] = useState(0)

  const handleSuccess = (type: ImportType) => {
    setHistoryTab(type)
    setRefreshKey((k) => k + 1)
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? '#ff6b00' : 'transparent',
    border: active ? 'none' : '1px solid #2a2a2a',
    borderRadius: 8,
    padding: '5px 14px',
    fontSize: 12,
    color: active ? '#ffffff' : '#888888',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.15s, color 0.15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Import Data</div>
        <div style={{ fontSize: 12, color: '#666666', marginTop: 4 }}>
          Upload weekly exports from QuickBooks and fuel vendors. Each file is validated before inserting.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, alignItems: 'start' }}>
        <PayrollSection onSuccess={() => handleSuccess('payroll')} />
        <RevenueSection onSuccess={() => handleSuccess('revenue')} />
        <FuelSection    onSuccess={() => handleSuccess('fuel')} />
      </div>

      {/* Import history */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#ffffff' }}>Import History</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['payroll', 'revenue', 'fuel'] as ImportType[]).map((t) => (
              <button key={t} onClick={() => setHistoryTab(t)} style={tabStyle(historyTab === t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <HistoryPanel activeTab={historyTab} refreshKey={refreshKey} />
      </div>
    </div>
  )
}

// ─── Upload progress ─────────────────────────────────────────────────────────

function UploadingState({ label, progress }: { label?: string; progress?: number }) {
  const steps = ['Parsing file…', 'Validating data…', 'Inserting records…', 'Finalizing…']
  const [internalStep, setInternalStep] = useState(0)
  const [internalProgress, setInternalProgress] = useState(0)

  // Only use the internal timer when the server isn't sending real progress
  const hasRealProgress = progress !== undefined

  useEffect(() => {
    if (hasRealProgress) return
    const interval = setInterval(() => {
      setInternalProgress((p) => (p >= 88 ? p : p + (88 - p) * 0.05))
    }, 100)
    return () => clearInterval(interval)
  }, [hasRealProgress])

  useEffect(() => {
    if (hasRealProgress) return
    const t1 = setTimeout(() => setInternalStep(1), 2000)
    const t2 = setTimeout(() => setInternalStep(2), 5000)
    const t3 = setTimeout(() => setInternalStep(3), 9000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [hasRealProgress])

  const displayLabel = label ?? steps[internalStep]
  const displayProgress = progress ?? internalProgress

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#888888' }}>{displayLabel}</div>
      <div style={{ width: '85%', height: 4, background: '#2a2a2a', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${displayProgress}%`,
            background: '#ff6b00',
            borderRadius: 2,
            transition: 'width 0.3s ease-out',
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: '#555555' }}>{Math.round(displayProgress)}%</div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function UploadIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#555555" strokeWidth={1.5}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#ff6b00" strokeWidth={1.5}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth={2}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#cc4444" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#ff9800" strokeWidth={1.5}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}


