import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const { access } = ctx
    const supabase = createServiceClient()

    type RawCard = {
      id: string
      card_name: string
      vendor: string
      employee_id: string | null
      branch_id: string | null
      business_tag: string | null
      is_confirmed: boolean
      employees: { first_name: string; last_name: string } | null
      branches: { name: string } | null
    }

    const { data: cardRaw, error: cardErr } = await supabase
      .from('fuel_card_assignments')
      .select('id, card_name, vendor, employee_id, branch_id, business_tag, is_confirmed, employees(first_name, last_name), branches(name)')
      .eq('id', params.id)
      .single()

    if (cardErr || !cardRaw) {
      return NextResponse.json({ success: false, error: 'Card not found' }, { status: 404 })
    }

    const c = cardRaw as unknown as RawCard

    // Branch access check: unconfirmed cards (no branch) are admin/exec only
    if (c.branch_id) {
      if (!canAccessBranch(access, c.branch_id)) {
        return NextResponse.json(
          { success: false, error: 'Access to this card is not permitted.', code: 'FORBIDDEN' },
          { status: 403 },
        )
      }
    } else if (access.branchIds !== null) {
      return NextResponse.json(
        { success: false, error: 'Access to this card is not permitted.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    const card = {
      id: c.id,
      cardName: c.card_name,
      vendor: c.vendor,
      employeeId: c.employee_id,
      employeeDisplayName: c.employees
        ? `${c.employees.first_name} ${c.employees.last_name}`.trim()
        : null,
      branchId: c.branch_id,
      branchName: c.branches?.name ?? null,
      businessTag: c.business_tag,
      isConfirmed: c.is_confirmed,
    }

    const { data: txnRaw, error: txnErr } = await supabase
      .from('fuel_transactions')
      .select('id, transaction_date, transaction_time, site_name, site_city, site_state, product, gallons, price_per_gallon, total_pretax, tax, total_with_tax, vendor')
      .eq('fuel_card_assignment_id', params.id)
      .order('transaction_date', { ascending: false })
      .limit(100)

    if (txnErr) throw new Error(txnErr.message)

    return NextResponse.json({ success: true, data: { card, transactions: txnRaw ?? [] } })
  } catch (err) {
    return apiError(err)
  }
}
