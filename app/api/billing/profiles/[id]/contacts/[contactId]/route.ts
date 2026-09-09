import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { normContactRole as normRole } from '@/lib/billing/contacts'

/** Edit or remove a single profile contact. Both require the 'customers' area. */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
type SB = ReturnType<typeof createServiceClient>
type Ctx = Extract<Awaited<ReturnType<typeof getAccessContext>>, { ok: true }>

// The contact must belong to this profile AND the caller must have access to the profile's branch.
async function guardContact(supabase: SB, ctx: Ctx, profileId: string, contactId: string): Promise<NextResponse | null> {
  const { data: contact } = await supabase.from('billing_profile_contacts').select('id, profile_id').eq('id', contactId).maybeSingle()
  if (!contact || contact.profile_id !== profileId) return bad('Contact not found', 'NOT_FOUND', 404)
  const { data: prof } = await supabase.from('billing_profiles').select('branch_id').eq('id', profileId).maybeSingle()
  if (!prof) return bad('Billing profile not found', 'NOT_FOUND', 404)
  if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(prof.branch_id as string)) {
    return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)
  }
  return null
}

export async function PATCH(request: Request, { params }: { params: { id: string; contactId: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard
    const supabase = createServiceClient()
    const denied = await guardContact(supabase, ctx, params.id, params.contactId)
    if (denied) return denied

    const body = (await request.json()) as { name?: string; role?: string; title?: string | null; email?: string | null; phone?: string | null; isInvoiceRecipient?: boolean }
    const patch: { name?: string; role?: string; title?: string | null; email?: string | null; phone?: string | null; is_invoice_recipient?: boolean } = {}
    if (body.name !== undefined) { if (!body.name.trim()) return bad('A contact name is required'); patch.name = body.name.trim() }
    if (body.role !== undefined) patch.role = normRole(body.role)
    if (body.title !== undefined) patch.title = body.title?.trim() || null
    if (body.email !== undefined) patch.email = body.email?.trim() || null
    if (body.phone !== undefined) patch.phone = body.phone?.trim() || null
    if (body.isInvoiceRecipient !== undefined) patch.is_invoice_recipient = !!body.isInvoiceRecipient
    if (Object.keys(patch).length === 0) return NextResponse.json({ success: true })

    const { error } = await supabase.from('billing_profile_contacts').update(patch).eq('id', params.contactId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string; contactId: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard
    const supabase = createServiceClient()
    const denied = await guardContact(supabase, ctx, params.id, params.contactId)
    if (denied) return denied

    const { error } = await supabase.from('billing_profile_contacts').delete().eq('id', params.contactId)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
