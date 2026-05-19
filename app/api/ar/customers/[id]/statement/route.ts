import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { StatementDocument } from '@/lib/ar/statement-pdf'
import type { StatementData, StatementLineItem } from '@/lib/ar/statement-pdf'

type RawLineItem = {
  id: string
  row_type: string
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  po_number: string | null
  job_name: string | null
  open_balance: number
  aging_bucket: string | null
  aging_days: number | null
  entity_code: string
  branch: { name: string } | null
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { id } = params
    const supabase = createServiceClient()

    // Fetch customer
    const { data: customer, error: custErr } = await supabase
      .from('ar_customers')
      .select('id, display_name')
      .eq('id', id)
      .single()
    if (custErr || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Fetch entity refs
    const { data: refs } = await supabase
      .from('ar_customer_entity_refs')
      .select('entity_code, quickbooks_name')
      .eq('customer_id', id)

    // Fetch all line items (invoices + credits) for this customer
    const { data: rawRows, error: rowErr } = await supabase
      .from('ar_invoices')
      .select(`
        id, row_type, invoice_number, invoice_date, due_date, po_number,
        job_name, open_balance, aging_bucket, aging_days, entity_code,
        branch:branches(name)
      `)
      .eq('customer_id', id)
      .order('invoice_date', { ascending: false })
    if (rowErr) {
      return NextResponse.json({ error: 'Failed to load line items' }, { status: 500 })
    }
    const rows = (rawRows ?? []) as unknown as RawLineItem[]

    // Find latest report date from ar_imports
    const { data: latestImport } = await supabase
      .from('ar_imports')
      .select('report_date')
      .order('report_date', { ascending: false })
      .limit(1)
      .single()

    const asOfDate = latestImport?.report_date ?? new Date().toISOString().split('T')[0]

    const lineItems: StatementLineItem[] = rows.map((r) => ({
      id:            r.id,
      rowType:       r.row_type === 'credit_memo' ? 'credit_memo' : 'invoice',
      invoiceNumber: r.invoice_number,
      invoiceDate:   r.invoice_date,
      dueDate:       r.due_date,
      poNumber:      r.po_number,
      jobName:       r.job_name,
      openBalance:   r.open_balance,
      agingBucket:   r.aging_bucket,
      agingDays:     r.aging_days,
      entityCode:    r.entity_code,
      branchName:    r.branch?.name ?? null,
    }))

    if (lineItems.length === 0) {
      return NextResponse.json({ error: 'No line items found for this customer' }, { status: 404 })
    }

    const statementData: StatementData = {
      customer: {
        displayName: customer.display_name as string,
        entityRefs:  (refs ?? []).map((r) => ({
          entityCode:     r.entity_code as string,
          quickbooksName: r.quickbooks_name as string,
        })),
      },
      lineItems,
      reportDate: asOfDate,
      asOfDate,
      companyName: 'Safety Network',
    }

    const pdfBuffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(StatementDocument, { data: statementData }) as any
    )

    const safeName = (customer.display_name as string)
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .slice(0, 50)

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="Statement_${safeName}_${asOfDate}.pdf"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err) {
    console.error('Statement generation error:', err)
    return NextResponse.json({ error: 'Failed to generate statement' }, { status: 500 })
  }
}
