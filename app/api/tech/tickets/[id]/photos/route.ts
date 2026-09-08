import { NextResponse } from 'next/server'
import { getTechContext, loadAssignedTicket, techBad, isEditable } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Ticket photos captured in the FIELD. A tech takes a photo on their device; it's stored on the
 * ticket (same private 'ticket-photos' bucket + billing_ticket_photos table the office uses) along
 * with the GPS coordinates, accuracy and capture time the device reported. When the ticket is
 * submitted the photos are already attached, so they travel to the office with everything else.
 *
 * Gated by loadAssignedTicket: only a tech assigned to the ticket (and who has accepted its shift)
 * can see or add photos. Money-blind like the rest of /api/tech.
 */

const BUCKET = 'ticket-photos'
const MAX_BYTES = 15 * 1024 * 1024 // 15 MB

const numOrNull = (v: FormDataEntryValue | null): number | null => {
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()
    const ticket = await loadAssignedTicket(supabase, params.id, ctx.tech.technicianId)
    if (!ticket) return techBad('Ticket not found', 'NOT_FOUND', 404)

    const { data, error } = await supabase
      .from('billing_ticket_photos')
      .select('id, storage_path, file_name, caption, latitude, longitude, accuracy_m, captured_at, created_at')
      .eq('ticket_id', params.id)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)

    const photos = await Promise.all((data ?? []).map(async (r) => {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600)
      return {
        id: r.id, fileName: r.file_name, caption: r.caption,
        latitude: r.latitude, longitude: r.longitude, accuracyM: r.accuracy_m,
        capturedAt: r.captured_at, createdAt: r.created_at, url: signed?.signedUrl ?? null,
      }
    }))

    return NextResponse.json({ success: true, data: photos })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()
    const ticket = await loadAssignedTicket(supabase, params.id, ctx.tech.technicianId)
    if (!ticket) return techBad('Ticket not found', 'NOT_FOUND', 404)
    if (!isEditable(ticket.status)) return techBad('This ticket has been submitted — photos can’t be added.', 'CONFLICT', 409)

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return techBad('No photo provided')
    if (file.size === 0) return techBad('That photo is empty')
    if (file.size > MAX_BYTES) return techBad('Photo is too large (max 15 MB)')
    if (!file.type.startsWith('image/')) return techBad('Only image files can be attached')

    const dot = file.name.lastIndexOf('.')
    const ext = dot > -1 ? file.name.slice(dot) : '.jpg'
    const path = `${params.id}/${globalThis.crypto.randomUUID()}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: false })
    if (upErr) throw new Error(upErr.message)

    const capturedAtRaw = form.get('capturedAt')
    const capturedAt = typeof capturedAtRaw === 'string' && capturedAtRaw ? capturedAtRaw : new Date().toISOString()

    const { error: insErr } = await supabase.from('billing_ticket_photos').insert({
      ticket_id: params.id,
      storage_path: path,
      file_name: file.name || `photo${ext}`,
      content_type: file.type,
      size_bytes: file.size,
      uploaded_by: ctx.tech.userId,
      latitude: numOrNull(form.get('latitude')),
      longitude: numOrNull(form.get('longitude')),
      accuracy_m: numOrNull(form.get('accuracy')),
      captured_at: capturedAt,
    })
    if (insErr) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(insErr.message) }

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()
    const ticket = await loadAssignedTicket(supabase, params.id, ctx.tech.technicianId)
    if (!ticket) return techBad('Ticket not found', 'NOT_FOUND', 404)
    if (!isEditable(ticket.status)) return techBad('This ticket has been submitted — photos can’t be changed.', 'CONFLICT', 409)

    const photoId = new URL(request.url).searchParams.get('photoId')
    if (!photoId) return techBad('photoId is required')

    const { data: photo, error: pErr } = await supabase
      .from('billing_ticket_photos')
      .select('id, storage_path')
      .eq('id', photoId)
      .eq('ticket_id', params.id)
      .maybeSingle()
    if (pErr) throw new Error(pErr.message)
    if (!photo) return techBad('Photo not found', 'NOT_FOUND', 404)

    await supabase.storage.from(BUCKET).remove([photo.storage_path])
    const { error: delErr } = await supabase.from('billing_ticket_photos').delete().eq('id', photoId).eq('ticket_id', params.id)
    if (delErr) throw new Error(delErr.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
