import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

// These group names are referenced by name in the payroll breakdown (Gross = everything
// that is NOT Fringes/Other). Renaming or deleting them would silently break the report,
// so they are protected as "system" groups.
const SYSTEM_GROUPS = new Set(['Fringes', 'Other'])
function bucketFor(name: string): 'Gross' | 'Fringes' | 'Other' {
  if (name === 'Fringes') return 'Fringes'
  if (name === 'Other') return 'Other'
  return 'Gross'
}

// GET — list all payroll item groups with how many items each has + its breakdown bucket
export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const [{ data: groups, error: gErr }, { data: items, error: iErr }] = await Promise.all([
      supabase.from('payroll_item_groups').select('id, name').order('name'),
      supabase.from('payroll_items').select('group_id'),
    ])
    if (gErr) throw new Error(gErr.message)
    if (iErr) throw new Error(iErr.message)

    const counts = new Map<string, number>()
    for (const it of (items ?? []) as { group_id: string | null }[]) {
      if (it.group_id) counts.set(it.group_id, (counts.get(it.group_id) ?? 0) + 1)
    }

    const result = ((groups ?? []) as { id: string; name: string }[]).map((g) => ({
      id: g.id,
      name: g.name,
      itemCount: counts.get(g.id) ?? 0,
      system: SYSTEM_GROUPS.has(g.name),
      bucket: bucketFor(g.name),
    }))

    return NextResponse.json({ success: true, data: { groups: result } })
  } catch (err) {
    return apiError(err)
  }
}

// POST — create a new group. New groups roll into Gross wages by default.
export async function POST(request: Request): Promise<NextResponse> {
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

    // Case-insensitive duplicate guard (the column is UNIQUE, but this gives a friendly message)
    const { data: existing, error: exErr } = await supabase
      .from('payroll_item_groups')
      .select('id')
      .ilike('name', name)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (existing) {
      return NextResponse.json(
        { success: false, error: `A group named "${name}" already exists`, code: 'CONFLICT' },
        { status: 409 }
      )
    }

    const { data: created, error: insErr } = await supabase
      .from('payroll_item_groups')
      .insert({ name })
      .select('id, name')
      .single()
    if (insErr || !created) throw new Error(insErr?.message ?? 'Failed to create group')

    return NextResponse.json({
      success: true,
      data: { id: created.id, name: created.name, itemCount: 0, system: false, bucket: bucketFor(created.name) },
    })
  } catch (err) {
    return apiError(err)
  }
}
