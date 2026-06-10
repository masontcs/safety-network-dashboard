import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp } from '@/lib/audit/log'

const VALID_INVOICE_STATUSES = ['disputed', 'short_pay', 'payment_pending', 'lien_filed', 'in_legal', 'write_off']
const VOID_ROLES = ['admin', 'executive', 'ar_manager', 'ar_team']
const FLAG_ROLES = ['admin', 'executive', 'ar_manager']

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { role, userId, displayName } = ctx.access
    const body = await request.json()

    const supabase = createServiceClient()

    // ── Void / unvoid ──────────────────────────────────────────────────────────
    if ('isVoided' in body) {
      if (!VOID_ROLES.includes(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const isVoided = !!body.isVoided

      const { data: inv } = await supabase
        .from('ar_invoices')
        .select('invoice_number, customer_id, is_voided')
        .eq('id', params.id)
        .single()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('ar_invoices')
        .update({
          is_voided:  isVoided,
          voided_at:  isVoided ? new Date().toISOString() : null,
          voided_by:  isVoided ? userId : null,
        })
        .eq('id', params.id)

      if (error) return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })

      await logAudit({
        userId,
        userDisplayName: displayName,
        userRole:        role,
        action:          isVoided ? 'ar.invoice.void' : 'ar.invoice.unvoid',
        resourceType:    'ar_invoice',
        resourceId:      params.id,
        resourceLabel:   (inv as { invoice_number: string | null } | null)?.invoice_number ?? params.id,
        metadata:        { customerId: (inv as { customer_id: string } | null)?.customer_id },
        ipAddress:       getClientIp(request),
      })

      return NextResponse.json({ success: true, isVoided })
    }

    // ── Invoice status flag ────────────────────────────────────────────────────
    if ('invoiceStatus' in body) {
      if (!FLAG_ROLES.includes(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const invoiceStatus = body.invoiceStatus === null ? null : String(body.invoiceStatus)
      if (invoiceStatus !== null && !VALID_INVOICE_STATUSES.includes(invoiceStatus)) {
        return NextResponse.json({ error: 'Invalid invoiceStatus' }, { status: 400 })
      }

      const { data: inv } = await supabase
        .from('ar_invoices')
        .select('invoice_number, invoice_status, customer_id')
        .eq('id', params.id)
        .single()

      const { error } = await supabase
        .from('ar_invoices')
        .update({ invoice_status: invoiceStatus })
        .eq('id', params.id)

      if (error) return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })

      await logAudit({
        userId,
        userDisplayName: displayName,
        userRole:        role,
        action:          'ar.invoice.flag',
        resourceType:    'ar_invoice',
        resourceId:      params.id,
        resourceLabel:   (inv as { invoice_number: string | null } | null)?.invoice_number ?? params.id,
        metadata:        {
          customerId: (inv as { customer_id: string } | null)?.customer_id,
          from:       (inv as { invoice_status: string | null } | null)?.invoice_status ?? null,
          to:         invoiceStatus,
        },
        ipAddress: getClientIp(request),
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'invoiceStatus or isVoided is required' }, { status: 400 })
  } catch (err) {
    console.error('AR invoice PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
