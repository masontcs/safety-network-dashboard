import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Everything the billing forms need in one call: the branches this user may
 * bill for, the managed payment-term list, and the customer list.
 *
 * Branch scoping follows the codebase convention (branchIds === null means
 * full access). Only billing-enabled branches are returned — corporate and
 * inactive branches have no billing_branch_settings row.
 */

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()

    const { data: branchSettings, error: bErr } = await supabase
      .from('billing_branch_settings')
      .select('branch_id, code, tax_rate_pct, branches(id, name, is_active)')
      .eq('billing_enabled', true)
    if (bErr) throw new Error(bErr.message)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let branches = (branchSettings ?? []).map((b: any) => ({
      id: b.branch_id,
      name: b.branches?.name ?? '',
      code: b.code,
      taxRatePct: b.tax_rate_pct,
    }))
    if (ctx.access.branchIds !== null) {
      const allowed = new Set(ctx.access.branchIds)
      branches = branches.filter((b: { id: string }) => allowed.has(b.id))
    }
    branches.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))

    const { data: terms, error: tErr } = await supabase
      .from('billing_payment_terms')
      .select('id, name, net_days, sort_order')
      .eq('is_active', true)
      .order('sort_order')
    if (tErr) throw new Error(tErr.message)

    const { data: customers, error: cErr } = await supabase
      .from('billing_customers')
      .select('id, code, name, default_payment_term_id')
      .eq('is_active', true)
      .order('name')
    if (cErr) throw new Error(cErr.message)

    return NextResponse.json({
      success: true,
      data: {
        branches,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        paymentTerms: (terms ?? []).map((t: any) => ({ id: t.id, name: t.name, netDays: t.net_days })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        customers: (customers ?? []).map((c: any) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          defaultPaymentTermId: c.default_payment_term_id,
        })),
        isAdmin: ctx.access.role === 'admin',
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}
