import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { canBillingArea } from '@/lib/utils/interfaces'
import { normContactRole as normRole } from '@/lib/billing/contacts'

/**
 * Contacts on a billing profile — the people the office deals with per profile, by function:
 * AP (accounts payable / invoicing), PM (project manager), superintendent, safety, general, etc.
 * Read for anyone who can see the profile; create/edit/delete require the 'customers' area.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
type SB = ReturnType<typeof createServiceClient>
type Ctx = Extract<Awaited<ReturnType<typeof getAccessContext>>, { ok: true }>

// Load the profile's branch and confirm the caller may see it. Returns null if not found.
async function profileBranch(supabase: SB, profileId: string): Promise<string | null | undefined> {
  const { data } = await supabase.from('billing_profiles').select('branch_id').eq('id', profileId).maybeSingle()
  return data ? (data.branch_id as string) : undefined
}
const branchDenied = (ctx: Ctx, branchId: string) => ctx.access.branchIds !== null && !ctx.access.branchIds.includes(branchId)

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()
    const branch = await profileBranch(supabase, params.id)
    if (branch === undefined) return bad('Billing profile not found', 'NOT_FOUND', 404)
    if (branch && branchDenied(ctx, branch)) return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)

    const { data, error } = await supabase
      .from('billing_profile_contacts')
      .select('id, name, role, title, email, phone, is_invoice_recipient, sort_order')
      .eq('profile_id', params.id)
      .order('sort_order').order('name')
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      data: {
        canManage: canBillingArea(ctx.access.role, 'customers', ctx.access.billingRole),
        contacts: (data ?? []).map((c) => ({
          id: c.id, name: c.name, role: c.role, title: c.title, email: c.email, phone: c.phone, isInvoiceRecipient: c.is_invoice_recipient,
        })),
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard
    const supabase = createServiceClient()
    const branch = await profileBranch(supabase, params.id)
    if (branch === undefined) return bad('Billing profile not found', 'NOT_FOUND', 404)
    if (branch && branchDenied(ctx, branch)) return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)

    const body = (await request.json()) as { name?: string; role?: string; title?: string | null; email?: string | null; phone?: string | null; isInvoiceRecipient?: boolean }
    if (!body.name?.trim()) return bad('A contact name is required')

    const { data, error } = await supabase.from('billing_profile_contacts').insert({
      profile_id: params.id,
      name: body.name.trim(),
      role: normRole(body.role),
      title: body.title?.trim() || null,
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      is_invoice_recipient: !!body.isInvoiceRecipient,
    }).select('id').single()
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, data: { id: data.id } })
  } catch (err) {
    return billingApiError(err)
  }
}
