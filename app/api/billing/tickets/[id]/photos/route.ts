import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Ticket photo attachments. Files live in the PRIVATE 'ticket-photos' bucket;
 * metadata in billing_ticket_photos. GET returns short-lived signed URLs so the
 * private files can be shown. Upload/delete are admin-only. Photos are
 * documentation, so they're allowed even on a locked (final/invoiced) ticket.
 */

const BUCKET = 'ticket-photos'
const MAX_BYTES = 15 * 1024 * 1024 // 15 MB

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
type SB = ReturnType<typeof createServiceClient>

async function loadTicket(supabase: SB, id: string) {
  const { data, error } = await supabase
    .from('billing_tickets')
    .select('id, billing_jobs(branch_id)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as { id: string; billing_jobs: { branch_id: string } | null } | null
}

type Ctx = Extract<Awaited<ReturnType<typeof getAccessContext>>, { ok: true }>
function branchDenied(ctx: Ctx, ticket: { billing_jobs: { branch_id: string } | null }) {
  return ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))
}

interface PhotoRow { id: string; storage_path: string; file_name: string; content_type: string | null; size_bytes: number | null; created_at: string }

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)

    const { data, error } = await supabase
      .from('billing_ticket_photos')
      .select('id, storage_path, file_name, content_type, size_bytes, created_at')
      .eq('ticket_id', params.id)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as PhotoRow[]

    const photos = await Promise.all(rows.map(async (r) => {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600)
      return { id: r.id, fileName: r.file_name, contentType: r.content_type, sizeBytes: r.size_bytes, createdAt: r.created_at, url: signed?.signedUrl ?? null }
    }))

    return NextResponse.json({ success: true, data: photos })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access.role, 'tickets')
    if (guard) return guard

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return bad('No file provided')
    if (file.size === 0) return bad('That file is empty')
    if (file.size > MAX_BYTES) return bad('File is too large (max 15 MB)')
    if (!file.type.startsWith('image/')) return bad('Only image files can be attached')

    const dot = file.name.lastIndexOf('.')
    const ext = dot > -1 ? file.name.slice(dot) : ''
    const path = `${params.id}/${globalThis.crypto.randomUUID()}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: false })
    if (upErr) throw new Error(upErr.message)

    const { error: insErr } = await supabase.from('billing_ticket_photos').insert({
      ticket_id: params.id,
      storage_path: path,
      file_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
      uploaded_by: ctx.access.userId,
    })
    if (insErr) {
      await supabase.storage.from(BUCKET).remove([path]) // don't orphan the upload
      throw new Error(insErr.message)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access.role, 'tickets')
    if (guard) return guard

    const url = new URL(request.url)
    const photoId = url.searchParams.get('photoId')
    if (!photoId) return bad('photoId is required')

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)

    const { data: photo, error: pErr } = await supabase
      .from('billing_ticket_photos')
      .select('id, storage_path')
      .eq('id', photoId)
      .eq('ticket_id', params.id)
      .maybeSingle()
    if (pErr) throw new Error(pErr.message)
    if (!photo) return bad('Photo not found', 'NOT_FOUND', 404)

    await supabase.storage.from(BUCKET).remove([photo.storage_path])
    const { error: delErr } = await supabase.from('billing_ticket_photos').delete().eq('id', photoId).eq('ticket_id', params.id)
    if (delErr) throw new Error(delErr.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
