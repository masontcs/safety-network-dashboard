'use client'

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react'
import { formatPeriodDate } from '@/lib/utils/date'

// ─── Types ────────────────────────────────────────────────────────────────────

type EntityCode = 'INC' | 'TCS' | 'STS'

type UploadState =
  | { status: 'idle' }
  | { status: 'ready'; file: File }
  | { status: 'uploading' }
  | { status: 'success'; lines: string[] }
  | { status: 'error'; message: string }
  | { status: 'duplicate'; conflict: { importId: string; periodDate?: string; entityCode?: string; dateRangeStart?: string; dateRangeEnd?: string }; file: File }

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
        <>
          <SpinnerIcon />
          <div style={{ fontSize: 12, color: '#888888', marginTop: 4 }}>Uploading…</div>
        </>
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

// ─── Payroll section ──────────────────────────────────────────────────────────

function PayrollSection() {
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
        `Entity: ${d.entityCode}`,
        `${d.transactionCount} payroll transactions`,
        d.taxCount > 0 ? `${d.taxCount} tax entries` : null,
        d.pendingEmployeeCount > 0 ? `${d.pendingEmployeeCount} employees need review` : null,
        d.unknownItemCount > 0 ? `${d.unknownItemCount} unknown items flagged` : null,
        ...((d.warnings as string[]) ?? []),
      ].filter(Boolean) as string[]

      setState({ status: 'success', lines })
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
    form.append('entityCode', entity)
    form.append('replaceImportId', conflict.importId)

    try {
      const res = await fetch('/api/import/payroll/confirm-replace', { method: 'POST', body: form })
      const json = await res.json()

      if (!json.success) {
        setState({ status: 'error', message: json.error ?? 'Replace failed.' })
        return
      }

      const d = json.data
      const lines = [
        `Period: ${formatPeriodDate(d.periodDate)} (replaced)`,
        `Entity: ${d.entityCode}`,
        `${d.transactionCount} payroll transactions`,
        ...((d.warnings as string[]) ?? []),
      ].filter(Boolean) as string[]

      setState({ status: 'success', lines })
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

      {/* Entity selector */}
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

      {/* Duplicate warning */}
      {isDuplicate && (
        <div
          style={{
            background: '#2a1a00',
            border: '1px solid #ff9800',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12, color: '#ff9800', fontWeight: 500, marginBottom: 4 }}>
            Duplicate import detected
          </div>
          <div style={{ fontSize: 12, color: '#cccccc', marginBottom: 10 }}>
            An import already exists for{' '}
            <strong>{state.status === 'duplicate' && state.conflict.periodDate ? formatPeriodDate(state.conflict.periodDate) : ''}</strong>
            {' '}({entity}). Replacing it will permanently delete the previous import.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleConfirmReplace}
              disabled={confirmLoading}
              className="btn-primary"
              style={{ fontSize: 12, padding: '6px 14px', opacity: confirmLoading ? 0.6 : 1 }}
            >
              {confirmLoading ? 'Replacing…' : 'Replace'}
            </button>
            <button
              onClick={() => setState({ status: 'idle' })}
              style={{
                background: '#2a2a2a',
                border: 'none',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 12,
                color: '#888888',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result summary */}
      {state.status === 'success' && (
        <ResultSummary lines={state.lines} onReset={() => setState({ status: 'idle' })} />
      )}

      {/* Upload button */}
      {(state.status === 'ready') && (
        <button onClick={handleUpload} className="btn-primary" style={{ alignSelf: 'flex-start' }}>
          Upload Payroll
        </button>
      )}

      {state.status === 'error' && (
        <button
          onClick={() => setState({ status: 'idle' })}
          style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 12, cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}
        >
          Try again
        </button>
      )}
    </section>
  )
}

// ─── Revenue section ──────────────────────────────────────────────────────────

function RevenueSection() {
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
        <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>
          QuickBooks revenue export .xls
        </div>
      </div>

      <DropZone
        accept=".xls,.xlsx"
        state={state}
        onFile={(f) => setState({ status: 'ready', file: f })}
        label="Drop revenue file here or click to browse"
        hint=".xls · .xlsx"
      />

      {/* Duplicate warning */}
      {isDuplicate && (
        <div
          style={{
            background: '#2a1a00',
            border: '1px solid #ff9800',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12, color: '#ff9800', fontWeight: 500, marginBottom: 4 }}>
            Duplicate import detected
          </div>
          <div style={{ fontSize: 12, color: '#cccccc', marginBottom: 10 }}>
            Revenue is already imported for{' '}
            <strong>{state.status === 'duplicate' && state.conflict.periodDate ? formatPeriodDate(state.conflict.periodDate) : ''}</strong>.
            {' '}Replacing it will permanently delete the previous import.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleConfirmReplace}
              disabled={confirmLoading}
              className="btn-primary"
              style={{ fontSize: 12, padding: '6px 14px', opacity: confirmLoading ? 0.6 : 1 }}
            >
              {confirmLoading ? 'Replacing…' : 'Replace'}
            </button>
            <button
              onClick={() => setState({ status: 'idle' })}
              style={{
                background: '#2a2a2a',
                border: 'none',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 12,
                color: '#888888',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
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
        <button
          onClick={() => setState({ status: 'idle' })}
          style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 12, cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}
        >
          Try again
        </button>
      )}
    </section>
  )
}

// ─── Fuel section ─────────────────────────────────────────────────────────────

function FuelSection() {
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
        <div style={{ fontSize: 11, color: '#666666', marginTop: 2 }}>
          Interstate or Flyers export .csv or .xlsx
        </div>
      </div>

      <DropZone
        accept=".csv,.xlsx,.xls"
        state={state}
        onFile={(f) => setState({ status: 'ready', file: f })}
        label="Drop fuel file here or click to browse"
        hint=".csv · .xlsx"
      />

      {/* Duplicate warning */}
      {isDuplicate && (
        <div
          style={{
            background: '#2a1a00',
            border: '1px solid #ff9800',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12, color: '#ff9800', fontWeight: 500, marginBottom: 4 }}>
            Duplicate import detected
          </div>
          <div style={{ fontSize: 12, color: '#cccccc', marginBottom: 10 }}>
            Fuel data already exists for{' '}
            <strong>
              {state.status === 'duplicate'
                ? `${state.conflict.dateRangeStart} – ${state.conflict.dateRangeEnd}`
                : ''}
            </strong>.
            {' '}Replacing it will permanently delete the previous import.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleConfirmReplace}
              disabled={confirmLoading}
              className="btn-primary"
              style={{ fontSize: 12, padding: '6px 14px', opacity: confirmLoading ? 0.6 : 1 }}
            >
              {confirmLoading ? 'Replacing…' : 'Replace'}
            </button>
            <button
              onClick={() => setState({ status: 'idle' })}
              style={{
                background: '#2a2a2a',
                border: 'none',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 12,
                color: '#888888',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
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
        <button
          onClick={() => setState({ status: 'idle' })}
          style={{ background: 'none', border: 'none', color: '#ff6b00', fontSize: 12, cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}
        >
          Try again
        </button>
      )}
    </section>
  )
}

// ─── Result summary ───────────────────────────────────────────────────────────

function ResultSummary({ lines, onReset }: { lines: string[]; onReset: () => void }) {
  return (
    <div
      style={{
        background: '#0a1f0a',
        border: '1px solid #2d5a2d',
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 12, color: '#4caf50', fontWeight: 500, marginBottom: 6 }}>
        ✓ Import complete
      </div>
      {lines.map((line, i) => (
        <div key={i} style={{ fontSize: 12, color: line.includes('review') || line.includes('flagged') ? '#ff9800' : '#888888', marginBottom: 2 }}>
          {line}
        </div>
      ))}
      <button
        onClick={onReset}
        style={{
          marginTop: 8,
          background: 'none',
          border: 'none',
          color: '#555555',
          fontSize: 11,
          cursor: 'pointer',
          padding: 0,
          fontFamily: 'inherit',
        }}
      >
        Import another file
      </button>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function ImportClient() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#ffffff' }}>Import Data</div>
        <div style={{ fontSize: 12, color: '#666666', marginTop: 4 }}>
          Upload weekly exports from QuickBooks and fuel vendors. Each file is validated before inserting.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, alignItems: 'start' }}>
        <PayrollSection />
        <RevenueSection />
        <FuelSection />
      </div>
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

function SpinnerIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
