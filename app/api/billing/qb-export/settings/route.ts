import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea, guardQbConfig } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import type { Database } from '@/lib/supabase/database.types'

/**
 * The single QuickBooks-export config row. GET returns it plus the branch list (so the
 * settings page can render a class field per branch). PUT (admin only) saves the whole thing.
 */

type Row = Database['public']['Tables']['billing_qb_export_config']['Row']

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'invoices')
    if (guard) return guard

    const svc = createServiceClient()
    const [{ data: cfg }, { data: branches }] = await Promise.all([
      svc.from('billing_qb_export_config').select('*').eq('id', 1).maybeSingle(),
      svc.from('branches').select('id, name, is_active, is_revenue_generating').order('name'),
    ])
    const c = cfg as Row | null
    return NextResponse.json({
      success: true,
      data: {
        canManage: ctx.access.role === 'admin' || !!ctx.access.qbConfig,
        config: {
          arAccount: c?.ar_account ?? 'ACCOUNTS RECEIVABLE',
          taxAccount: c?.tax_account ?? 'Sales Tax Payable',
          taxZeroMemo: c?.tax_zero_memo ?? 'NO TAX',
          taxExtra: c?.tax_extra ?? 'AUTOSTAX',
          defaultNetDays: c?.default_net_days ?? 30,
          nameIncludesJob: c?.name_includes_job ?? false,
          kindMap: c?.kind_map ?? {},
          branchClass: c?.branch_class ?? {},
        },
        branches: (branches ?? []).map((b: { id: string; name: string; is_active: boolean; is_revenue_generating: boolean }) =>
          ({ id: b.id, name: b.name, active: b.is_active, revenue: b.is_revenue_generating })),
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const areaGuard = guardBillingArea(ctx.access, 'invoices')
    if (areaGuard) return areaGuard
    const capGuard = guardQbConfig(ctx.access)
    if (capGuard) return capGuard

    const b = (await request.json()) as {
      arAccount?: string; taxAccount?: string; taxZeroMemo?: string; taxExtra?: string
      defaultNetDays?: number; nameIncludesJob?: boolean
      kindMap?: Record<string, { account: string; item: string; memo: string }>
      branchClass?: Record<string, string>
    }
    const net = Number(b.defaultNetDays)
    if (!Number.isInteger(net) || net < 0 || net > 365) return NextResponse.json({ success: false, error: 'Default net days must be a whole number 0–365.' }, { status: 400 })

    const svc = createServiceClient()
    const { error } = await svc.from('billing_qb_export_config').update({
      ar_account: (b.arAccount ?? '').trim() || 'ACCOUNTS RECEIVABLE',
      tax_account: (b.taxAccount ?? '').trim() || 'Sales Tax Payable',
      tax_zero_memo: (b.taxZeroMemo ?? '').trim() || 'NO TAX',
      tax_extra: (b.taxExtra ?? '').trim() || 'AUTOSTAX',
      default_net_days: net,
      name_includes_job: !!b.nameIncludesJob,
      kind_map: b.kindMap ?? {},
      branch_class: b.branchClass ?? {},
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
