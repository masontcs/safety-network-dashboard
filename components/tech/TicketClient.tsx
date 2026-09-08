'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { techApi, TechApiError, type TicketDetail, type TicketPhoto } from '@/lib/tech/client'
import FeatureTags from '@/components/tech/FeatureTags'
import Sheet from '@/components/tech/Sheet'
import AddTimeSheet from '@/components/tech/AddTimeSheet'
import AddEquipmentSheet from '@/components/tech/AddEquipmentSheet'
import { useBroadcast } from '@/lib/realtime/useBroadcast'

type SheetKind = 'time' | 'equipment' | 'submit' | null

/** Best-effort device location — resolves null if unavailable or denied, never rejects. */
function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    )
  })
}

/** Screen 2 — one ticket. Read-only header + Labor / Equipment tabs. Lead-only submit. */
export default function TicketClient({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [t, setT] = useState<TicketDetail | null>(null)
  const [gone, setGone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'labor' | 'equipment' | 'photos'>('labor')
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [submitting, setSubmitting] = useState(false)
  const [photos, setPhotos] = useState<TicketPhoto[]>([])
  const [photoBusy, setPhotoBusy] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  // The camera stays locked until location access is granted — every field photo must carry a
  // location, so we require the permission up front rather than silently saving a photo without one.
  const [locGranted, setLocGranted] = useState(false)
  const [locErr, setLocErr] = useState<string | null>(null)
  const [locBusy, setLocBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setErr(null)
      setT(await techApi.getTicket(ticketId))
    } catch (e) {
      if (e instanceof TechApiError && e.status === 404) { setGone(true); return }
      setErr(e instanceof TechApiError ? e.message : 'Could not load this ticket.')
    }
  }, [ticketId])

  const loadPhotos = useCallback(async () => {
    try { setPhotos(await techApi.listPhotos(ticketId)) } catch { /* non-fatal */ }
  }, [ticketId])

  useEffect(() => { load(); loadPhotos() }, [load, loadPhotos])

  // If the browser already remembers geolocation as granted, unlock the camera without a re-prompt.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return
    navigator.permissions.query({ name: 'geolocation' as PermissionName })
      .then((s) => { if (s.state === 'granted') setLocGranted(true) })
      .catch(() => { /* Permissions API unavailable — user taps Enable location */ })
  }, [])

  // Ask for location; only a successful fix unlocks the camera button.
  async function enableLocation() {
    if (locBusy) return
    setLocBusy(true); setLocErr(null)
    const pos = await getPosition()
    setLocBusy(false)
    if (pos) setLocGranted(true)
    else setLocErr('Location is off or blocked. Allow location for this site in your browser settings, then tap Enable location again.')
  }

  // Take/pick a photo, stamp it with the device's location + time, and attach it to the ticket.
  async function capturePhoto(file: File) {
    if (photoBusy) return
    setPhotoBusy(true); setErr(null)
    try {
      const pos = await getPosition()
      const fd = new FormData()
      fd.append('file', file)
      fd.append('capturedAt', new Date().toISOString())
      if (pos) {
        fd.append('latitude', String(pos.coords.latitude))
        fd.append('longitude', String(pos.coords.longitude))
        if (Number.isFinite(pos.coords.accuracy)) fd.append('accuracy', String(pos.coords.accuracy))
      }
      await techApi.addPhoto(ticketId, fd)
      await loadPhotos()
    } catch (e) {
      setErr(e instanceof TechApiError ? e.message : 'Could not add that photo.')
    } finally {
      setPhotoBusy(false)
    }
  }
  async function removePhoto(id: string) {
    if (!window.confirm('Remove this photo?')) return
    try { await techApi.deletePhoto(ticketId, id); loadPhotos() }
    catch (e) { setErr(e instanceof TechApiError ? e.message : 'Could not remove that photo.') }
  }
  // Live: crew/assignment/void changes from the office reflect without a refresh. If the
  // office voids this ticket, the refetch 404s and the screen shows it's no longer available.
  useBroadcast('billing', 'changed', load)

  async function removeLabor(entryId: string) {
    if (!window.confirm('Remove this time entry?')) return
    try { await techApi.deleteLabor(ticketId, entryId); load() }
    catch (e) { setErr(e instanceof TechApiError ? e.message : 'Could not remove that entry.') }
  }
  async function removeEquipment(entryId: string) {
    if (!window.confirm('Remove this equipment?')) return
    try { await techApi.deleteEquipment(ticketId, entryId); load() }
    catch (e) { setErr(e instanceof TechApiError ? e.message : 'Could not remove that item.') }
  }
  async function doSubmit() {
    if (submitting) return
    setSubmitting(true)
    try {
      await techApi.submit(ticketId)
      router.push('/tech') // it's handed off — it leaves their world
    } catch (e) {
      setErr(e instanceof TechApiError ? e.message : 'Could not submit.')
      setSubmitting(false)
      setSheet(null)
    }
  }

  const bar = (
    <div className="tech-bar">
      <button className="tech-back" onClick={() => router.push('/tech')}>‹ Tickets</button>
    </div>
  )

  if (gone) {
    return (
      <>
        {bar}
        <div className="tech-page">
          <div className="tech-card">
            <div className="tech-empty">
              This ticket isn’t available anymore.<br />
              It may have been submitted or closed by the office.
            </div>
            <button className="tech-btn block" onClick={() => router.push('/tech')}>Back to my tickets</button>
          </div>
        </div>
      </>
    )
  }

  if (!t) {
    return (
      <>
        {bar}
        <div className="tech-page">
          {err ? <div className="tech-note err">{err}</div> : <div className="tech-skeleton" style={{ height: 220 }} />}
        </div>
      </>
    )
  }

  const crewLabor = t.labor // for a crew tech this is already only theirs
  const showSubmit = t.isLead

  return (
    <>
      {bar}
      <div className="tech-page">
        {err && <div className="tech-note err" role="alert">{err}</div>}

        {/* Read-only header — what the work is. They can't change any of it. */}
        <div className="tech-card">
          <div className="tech-row">
            <span className="tech-num">{t.ticketNumber}</span>
            <FeatureTags features={t.features} isLead={t.isLead} />
          </div>
          <div className="tech-jobname">{t.job?.name || t.job?.number || 'Job'}</div>
          <div className="tech-meta">
            {t.customer ? <>{t.customer}<br /></> : null}
            {t.site || 'No site address'}<br />
            {t.date}
          </div>
        </div>

        <div className="tech-tabs">
          <button className={`tech-tab ${tab === 'labor' ? 'on' : ''}`} onClick={() => setTab('labor')}>Labor</button>
          <button className={`tech-tab ${tab === 'equipment' ? 'on' : ''}`} onClick={() => setTab('equipment')}>Equipment</button>
          <button className={`tech-tab ${tab === 'photos' ? 'on' : ''}`} onClick={() => setTab('photos')}>Photos{photos.length ? ` (${photos.length})` : ''}</button>
        </div>

        {tab === 'labor' && (
          <div className="tech-card">
            <div className="tech-row" style={{ marginBottom: 6 }}>
              <span className="tech-lbl" style={{ margin: 0 }}>{t.isLead ? 'Crew time' : 'My time'}</span>
              <div className="tech-hours" style={{ marginLeft: 'auto' }}>
                <b>{t.myHours.toFixed(2)}</b><span>my hrs</span>
              </div>
            </div>

            {crewLabor.length === 0 && <div className="tech-empty">No time logged yet.</div>}
            {crewLabor.map((l) => (
              <div key={l.id} className="tech-item">
                <div className="body">
                  <div className="t1">{l.activity}{t.isLead && !l.mine ? ` · ${l.technicianName}` : ''}</div>
                  <div className="t2">{l.startTime}–{l.endTime}{l.crossesMidnight ? ' +1d' : ''}{l.enteredOnMyBehalf ? ' · entered by lead' : ''}</div>
                </div>
                <div className="r"><b>{l.hours.toFixed(2)}</b> h</div>
                {(l.mine || t.isLead) && <button className="tech-linkbtn" onClick={() => removeLabor(l.id)} aria-label="Remove">✕</button>}
              </div>
            ))}

            <button className="tech-btn ghost block" onClick={() => setSheet('time')}>+ Add time</button>
          </div>
        )}

        {tab === 'equipment' && (
          <div className="tech-card">
            <span className="tech-lbl">Equipment on this ticket</span>
            {t.equipment.length === 0 && <div className="tech-empty">No equipment recorded yet.</div>}
            {t.equipment.map((e) => (
              <div key={e.id} className="tech-item">
                <div className="body">
                  <div className="t1">{e.itemName}{e.variation ? ` · ${e.variation}` : ''}</div>
                  <div className="t2">
                    {e.itemCode}
                    {e.eventType ? <> · <span className={`tech-tag ${e.eventType === 'return' ? 'ret' : e.eventType === 'lost' ? 'dtc' : 'add'}`}>{e.eventType}</span></> : null}
                    {e.equipmentId ? ` · ${e.equipmentId}` : ''}
                  </div>
                </div>
                <div className="r"><b>{e.qty}</b></div>
                <button className="tech-linkbtn" onClick={() => removeEquipment(e.id)} aria-label="Remove">✕</button>
              </div>
            ))}

            <button className="tech-btn ghost block" onClick={() => setSheet('equipment')}>+ Add equipment</button>
          </div>
        )}

        {tab === 'photos' && (
          <div className="tech-card">
            <span className="tech-lbl">Photos on this ticket</span>
            {photos.length === 0 && <div className="tech-empty">No photos yet. Take one and it’s stamped with the time and your location, then goes to the office with the ticket.</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: photos.length ? 8 : 0 }}>
              {photos.map((p) => (
                <div key={p.id} style={{ border: '1px solid var(--tech-line, #2a2a2a)', borderRadius: 10, overflow: 'hidden', background: 'var(--tech-surface2, #1a1a1a)' }}>
                  {p.url
                    ? <a href={p.url} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '1 / 1' }}>
                        <img src={p.url} alt={p.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      </a>
                    : <div style={{ aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', fontSize: 11, opacity: 0.6 }}>unavailable</div>}
                  <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.4 }}>
                    <div>{p.capturedAt ? new Date(p.capturedAt).toLocaleString() : new Date(p.createdAt).toLocaleString()}</div>
                    {p.latitude != null && p.longitude != null
                      ? <a href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`} target="_blank" rel="noreferrer" style={{ color: 'var(--tech-accent, #ff6b00)' }}>
                          📍 {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                        </a>
                      : <span style={{ opacity: 0.55 }}>No location</span>}
                    <button className="tech-linkbtn" onClick={() => removePhoto(p.id)} style={{ display: 'block', marginTop: 4 }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            {/* capture="environment" opens the rear camera on phones; falls back to the file/photo
                picker elsewhere. Location + time are attached on upload. */}
            <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) capturePhoto(f); e.target.value = '' }} />
            {locGranted ? (
              // Direct gesture → camera opens (position is re-read at upload for the exact spot).
              <button className="tech-btn ghost block" style={{ marginTop: 10 }} disabled={photoBusy} onClick={() => photoInput.current?.click()}>
                {photoBusy ? 'Adding…' : '+ Take / add photo'}
              </button>
            ) : (
              <>
                <div className="tech-note info" style={{ marginTop: 10 }}>Location access is required before taking a photo — every photo is tagged with where it was taken.</div>
                <button className="tech-btn block" style={{ marginTop: 8 }} disabled={locBusy} onClick={enableLocation}>
                  {locBusy ? 'Requesting…' : 'Enable location'}
                </button>
              </>
            )}
            {locErr && <div className="tech-note err" style={{ marginTop: 8 }}>{locErr}</div>}
          </div>
        )}

        {showSubmit && (
          <button className="tech-btn good" style={{ marginTop: 4 }} onClick={() => setSheet('submit')}>Submit ticket</button>
        )}
      </div>

      {sheet === 'time' && <AddTimeSheet destinations={[{ id: ticketId, kind: 'ticket', label: t.ticketNumber, date: t.date }]} onClose={() => setSheet(null)} onSaved={load} />}
      {sheet === 'equipment' && <AddEquipmentSheet ticketId={ticketId} features={t.features} onClose={() => setSheet(null)} onSaved={load} />}
      {sheet === 'submit' && (
        <Sheet title="Submit ticket" onClose={() => setSheet(null)}>
          <div className="tech-note info">This finalizes your edits and the items added. The ticket goes to the office and leaves your list. If they need more, they can send it back.</div>
          <button className="tech-btn good block" onClick={doSubmit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit ticket'}</button>
          <button className="tech-btn ghost block" onClick={() => setSheet(null)} disabled={submitting}>Cancel</button>
        </Sheet>
      )}
    </>
  )
}
