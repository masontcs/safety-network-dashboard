import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { canBillingArea } from '@/lib/utils/interfaces'

/**
 * Lightweight "can I use the QuickBooks export?" check for the UI, so the Invoices page only
 * shows the export control to users who actually have it. Authoritative gating still lives on
 * the export routes themselves.
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await getAccessContext()
  if (!ctx.ok) return ctx.response
  const isAdmin = ctx.access.role === 'admin'
  const hasInvoices = canBillingArea(ctx.access.role, 'invoices', ctx.access.billingRole)
  return NextResponse.json({
    success: true,
    data: {
      canExport: hasInvoices && (isAdmin || !!ctx.access.qbExport),
      canConfig: isAdmin || !!ctx.access.qbConfig,
    },
  })
}
