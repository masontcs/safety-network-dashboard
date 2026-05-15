import { NextResponse } from 'next/server'
import { getAccessContext, guardFuelAccess } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const fuelGuard = guardFuelAccess(ctx.access.role)
    if (fuelGuard) return fuelGuard
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

    let query = supabase
      .from('fuel_card_assignments')
      .select('id, card_name, vendor, employee_id, branch_id, business_tag, is_confirmed, employees(first_name, last_name), branches(name)')
      .order('card_name')

    if (access.branchIds !== null) {
      query = query.in('branch_id', access.branchIds)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const cards = ((data ?? []) as unknown as RawCard[]).map((c) => ({
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
    }))

    return NextResponse.json({ success: true, data: cards })
  } catch (err) {
    return apiError(err)
  }
}
