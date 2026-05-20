import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

const VALID_INVOICE_STATUSES = ['disputed', 'short_pay', 'payment_pending', 'lien_filed', 'in_legal', 'write_off']

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()

    // invoiceStatus: string or null to clear it
    if (!('invoiceStatus' in body)) {
      return NextResponse.json({ error: 'invoiceStatus is required' }, { status: 400 })
    }
    const invoiceStatus = body.invoiceStatus === null ? null : String(body.invoiceStatus)
    if (invoiceStatus !== null && !VALID_INVOICE_STATUSES.includes(invoiceStatus)) {
      return NextResponse.json({ error: 'Invalid invoiceStatus' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('ar_invoices')
      .update({ invoice_status: invoiceStatus })
      .eq('id', params.id)

    if (error) return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR invoice PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
