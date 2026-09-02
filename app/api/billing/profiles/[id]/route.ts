import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import type { Database } from '@/lib/supabase/database.types'

/**
 * A single billing profile: read its details, update the basics.
 * Its per-entity price-list configuration lives at ./entity-config.
 */

type ProfileUpdate = Database['public']['Tables']['billing_profiles']['Update']

/**
 * The shape of the embedded select below. Our hand-maintained Database type
 * declares `Relationships: []`, so supabase-js cannot infer PostgREST embeds
 * and widens the row to `never`. We assert the shape we asked for — the column
 * list and this interface must be kept in step.
 */
interface ProfileDetailRow {
  id: string
  code: string
  name: string
  branch_id: string
  is_active: boolean
  payment_term_id: string | null
  rental_minimum_enabled: boolean
  rental_minimum_cents: number
  portal_enabled: boolean
  billing_customers: { id: string; code: string; name: string; default_payment_term_id: string | null } | null
  branches: { id: string; name: string } | null
  billing_profile_contacts: {
    id: string; name: string; email: string | null; phone: string | null; is_invoice_recipient: boolean
  }[]
}

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data: raw, error } = await supabase
      .from('billing_profiles')
      .select(`
        id, code, name, branch_id, is_active, payment_term_id,
        rental_minimum_enabled, rental_minimum_cents, portal_enabled,
        billing_customers(id, code, name, default_payment_term_id),
        branches(id, name),
        billing_profile_contacts(id, name, email, phone, is_invoice_recipient)
      `)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(error.message)

    const p = raw as unknown as ProfileDetailRow | null
    if (!p) return bad('Billing profile not found', 'NOT_FOUND', 404)

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(p.branch_id)) {
      return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)
    }

    return NextResponse.json({
      success: true,
      data: {
        id: p.id,
        code: p.code,
        name: p.name,
        isActive: p.is_active,
        paymentTermId: p.payment_term_id,
        rentalMinimumEnabled: p.rental_minimum_enabled,
        rentalMinimumCents: p.rental_minimum_cents,
        portalEnabled: p.portal_enabled,
        branch: { id: p.branch_id, name: p.branches?.name ?? '' },
        customer: p.billing_customers,
        qbName: p.billing_customers ? `${p.billing_customers.name} - ${p.name}` : p.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contacts: (p.billing_profile_contacts ?? []).map((c: any) => ({
          id: c.id, name: c.name, email: c.email, phone: c.phone, isInvoiceRecipient: c.is_invoice_recipient,
        })),
        isAdmin: ctx.access.role === 'admin',
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // Billing roles are not defined yet — writes are admin-only until they are.
    const guard = guardBillingArea(ctx.access, 'customers')
    if (guard) return guard

    const supabase = createServiceClient()
    const { data: existing, error: exErr } = await supabase
      .from('billing_profiles')
      .select('id, branch_id')
      .eq('id', params.id)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (!existing) return bad('Billing profile not found', 'NOT_FOUND', 404)

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(existing.branch_id)) {
      return bad('You do not have access to this profile’s branch.', 'FORBIDDEN', 403)
    }

    const body = (await request.json()) as {
      name?: string
      paymentTermId?: string | null
      rentalMinimumEnabled?: boolean
      rentalMinimumCents?: number
      portalEnabled?: boolean
      isActive?: boolean
    }

    const patch: ProfileUpdate = {}
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return bad('Profile name cannot be empty')
      patch.name = name
    }
    if (body.paymentTermId !== undefined) patch.payment_term_id = body.paymentTermId
    if (body.rentalMinimumEnabled !== undefined) patch.rental_minimum_enabled = body.rentalMinimumEnabled
    if (body.rentalMinimumCents !== undefined) {
      if (!Number.isInteger(body.rentalMinimumCents) || body.rentalMinimumCents < 0) {
        return bad('Rental minimum must be a whole number of cents, zero or greater')
      }
      patch.rental_minimum_cents = body.rentalMinimumCents
    }
    if (body.portalEnabled !== undefined) patch.portal_enabled = body.portalEnabled
    if (body.isActive !== undefined) patch.is_active = body.isActive

    if (Object.keys(patch).length === 0) return bad('Nothing to update')

    const { error } = await supabase.from('billing_profiles').update(patch).eq('id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
