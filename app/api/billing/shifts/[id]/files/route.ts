import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'

/**
 * Traffic-plan files on a shift. Private 'shift-files' bucket; metadata in billing_shift_files.
 * GET returns short-lived signed URLs (so techs can view the plan when they acknowledge the
 * shift). Upload/delete are admin-only. Multiple files per shift.
 */

const BUCKET = 'shift-files'
const MAX_BYTES = 25 * 1024 * 1024 // 25 MB
const OK_TYPES = ['application/pdf', 'image/']

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
type SB = ReturnType<typeof createServiceClient>
type Ctx = Extract<Awaited<ReturnType<typeof getAccessContext>>, { ok: true }>

async function loadShift(supabase: SB, id: string) {
  const { data } = await supabase.from('billing_shifts').select('id, branch_id').eq('id', id).maybeSingle()
  return data as { id: string; branch_id: string } | null
}
const branchDenied = (ctx: Ctx, branchId: string) => ctx.access.branchIds !== null && !ctx.access.branchIds.includes(branchId)

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()
    const shift = await loadShift(supabase, params.id)
    if (!shift) return bad('Shift not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, shift.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)

    const { data } = await supabase.from('billing_shift_files').select('id, storage_path, filename, created_at').eq('shift_id', params.id).order('created_at')
    const rows = (data ?? []) as { id: string; storage_path: string; filename: string | null; created_at: string }[]
    const files = await Promise.all(rows.map(async (r) => {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600)
      return { id: r.id, filename: r.filename, createdAt: r.created_at, url: signed?.signedUrl ?? null }
    }))
    return NextResponse.json({ success: true, data: files })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()
    const shift = await loadShift(supabase, params.id)
    if (!shift) return bad('Shift not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, shift.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return bad('No file provided')
    if (file.size === 0) return bad('That file is empty')
    if (file.size > MAX_BYTES) return bad('File is too large (max 25 MB)')
    if (!OK_TYPES.some((t) => file.type.startsWith(t))) return bad('Only PDFs or images can be attached')

    const dot = file.name.lastIndexOf('.')
    const ext = dot > -1 ? file.name.slice(dot) : ''
    const path = `${params.id}/${globalThis.crypto.randomUUID()}${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: false })
    if (upErr) throw new Error(upErr.message)

    const { error: insErr } = await supabase.from('billing_shift_files').insert({
      shift_id: params.id, storage_path: path, filename: file.name, uploaded_by: ctx.access.userId ?? null,
    })
    if (insErr) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(insErr.message) }

    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard
    const supabase = createServiceClient()
    const shift = await loadShift(supabase, params.id)
    if (!shift) return bad('Shift not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, shift.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)

    const fileId = new URL(request.url).searchParams.get('fileId')
    if (!fileId) return bad('fileId is required')
    const { data: f } = await supabase.from('billing_shift_files').select('id, storage_path').eq('id', fileId).eq('shift_id', params.id).maybeSingle()
    if (!f) return bad('File not found', 'NOT_FOUND', 404)

    await supabase.storage.from(BUCKET).remove([f.storage_path])
    const { error } = await supabase.from('billing_shift_files').delete().eq('id', fileId).eq('shift_id', params.id)
    if (error) throw new Error(error.message)
    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
