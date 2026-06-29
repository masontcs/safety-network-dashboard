import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

// Names the payroll breakdown depends on — protected from rename/delete.
const SYSTEM_GROUPS = new Set(['Fringes', 'Other'])

// PATCH — rename a group
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as { name?: string }
    const name = body.name?.trim()
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Group name is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    const { data: group, error: gErr } = await supabase
      .from('payroll_item_groups')
      .select('id, name')
      .eq('id', params.id)
      .maybeSingle()
    if (gErr) throw new Error(gErr.message)
    if (!group) {
      return NextResponse.json({ success: false, error: 'Group not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    if (SYSTEM_GROUPS.has(group.name)) {
      return NextResponse.json(
        { success: false, error: `"${group.name}" is a system group used by the payroll breakdown and cannot be renamed.`, code: 'FORBIDDEN' },
        { status: 403 }
      )
    }
    if (SYSTEM_GROUPS.has(name)) {
      return NextResponse.json(
        { success: false, error: `"${name}" is reserved for the payroll breakdown and cannot be used.`, code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const { data: dup, error: dErr } = await supabase
      .from('payroll_item_groups')
      .select('id')
      .ilike('name', name)
      .neq('id', params.id)
      .maybeSingle()
    if (dErr) throw new Error(dErr.message)
    if (dup) {
      return NextResponse.json(
        { success: false, error: `A group named "${name}" already exists`, code: 'CONFLICT' },
        { status: 409 }
      )
    }

    const { data: updated, error: uErr } = await supabase
      .from('payroll_item_groups')
      .update({ name })
      .eq('id', params.id)
      .select('id, name')
      .single()
    if (uErr || !updated) throw new Error(uErr?.message ?? 'Failed to rename group')

    return NextResponse.json({ success: true, data: { id: updated.id, name: updated.name } })
  } catch (err) {
    return apiError(err)
  }
}

// DELETE — remove a group (only if empty and not a system group)
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const { data: group, error: gErr } = await supabase
      .from('payroll_item_groups')
      .select('id, name')
      .eq('id', params.id)
      .maybeSingle()
    if (gErr) throw new Error(gErr.message)
    if (!group) {
      return NextResponse.json({ success: false, error: 'Group not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    if (SYSTEM_GROUPS.has(group.name)) {
      return NextResponse.json(
        { success: false, error: `"${group.name}" is a system group and cannot be deleted.`, code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const { count, error: cErr } = await supabase
      .from('payroll_items')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', params.id)
    if (cErr) throw new Error(cErr.message)
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { success: false, error: `This group has ${count} item${count === 1 ? '' : 's'} assigned. Reassign them first (Admin → Payroll Items).`, code: 'CONFLICT' },
        { status: 409 }
      )
    }

    const { error: dErr } = await supabase.from('payroll_item_groups').delete().eq('id', params.id)
    if (dErr) throw new Error(dErr.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
