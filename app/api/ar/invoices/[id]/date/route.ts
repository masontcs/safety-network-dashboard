import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

// PATCH /api/ar/invoices/[id]/date
// Body: { date: string | null, note?: string }
// - date = ISO date string → sets override, persists across re-imports
// - date = null → removes override, reverts to QB-imported date
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
    const date: string | null = body?.date ?? null
    const note: string | null = body?.note ?? null

    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD or null' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Fetch the invoice to get invoice_number and entity_code
    const { data: invoice, error: fetchErr } = await supabase
      .from('ar_invoices')
      .select('id, invoice_number, entity_code, invoice_date')
      .eq('id', params.id)
      .single()

    if (fetchErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (!invoice.invoice_number) {
      return NextResponse.json(
        { error: 'Cannot override date on an invoice with no invoice number — it cannot be tracked across imports' },
        { status: 400 }
      )
    }

    if (date === null) {
      // Remove override — delete from overrides table and revert invoice_date
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('ar_invoice_date_overrides')
        .delete()
        .eq('invoice_number', invoice.invoice_number)
        .eq('entity_code', invoice.entity_code)

      // Revert is not straightforward without the original QB date.
      // We can't easily revert without a re-import, so just clear the override record.
      // The date will be corrected on the next import. Surface this to the caller.
      return NextResponse.json({
        cleared: true,
        message: 'Override removed. The original date will be restored on the next import.',
      })
    }

    // Upsert the override record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertErr } = await (supabase as any)
      .from('ar_invoice_date_overrides')
      .upsert(
        {
          invoice_number: invoice.invoice_number,
          entity_code:    invoice.entity_code,
          override_date:  date,
          note:           note || null,
          overridden_by:  ctx.access.userId,
          updated_at:     new Date().toISOString(),
        },
        { onConflict: 'invoice_number,entity_code' }
      )

    if (upsertErr) {
      console.error('Date override upsert error:', upsertErr)
      return NextResponse.json({ error: 'Failed to save date override' }, { status: 500 })
    }

    // Also update the live invoice row immediately so UI reflects it without waiting for re-import
    const { error: updateErr } = await supabase
      .from('ar_invoices')
      .update({ invoice_date: date })
      .eq('id', params.id)

    if (updateErr) {
      console.error('Invoice date update error:', updateErr)
      return NextResponse.json({ error: 'Override saved but failed to update invoice' }, { status: 500 })
    }

    return NextResponse.json({
      invoiceId:     invoice.id,
      invoiceNumber: invoice.invoice_number,
      entityCode:    invoice.entity_code,
      overrideDate:  date,
      note,
    })
  } catch (err) {
    console.error('Invoice date PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
