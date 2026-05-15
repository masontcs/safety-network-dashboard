import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { id } = params

    const [
      { data: customer },
      { data: refs },
      { data: contacts },
      { data: notes },
      { data: pmRows },
    ] = await Promise.all([
      supabase.from('ar_customers').select('id, display_name, is_excluded, status').eq('id', id).single(),
      supabase.from('ar_customer_entity_refs').select('entity_code, quickbooks_name').eq('customer_id', id),
      supabase.from('ar_customer_contacts').select('id, name, title, email, phone, is_primary, created_at').eq('customer_id', id).order('is_primary', { ascending: false }).order('created_at'),
      supabase.from('ar_customer_notes').select('id, content, created_by, created_at').eq('customer_id', id).order('created_at', { ascending: false }),
      supabase.from('ar_customer_pm_assignments').select('user_id').eq('customer_id', id),
    ])

    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Resolve author names for notes and PM display names
    const authorIds = [...new Set([
      ...(notes ?? []).map((n) => n.created_by).filter(Boolean),
      ...(pmRows ?? []).map((p) => p.user_id),
    ])] as string[]

    const { data: profiles } = authorIds.length > 0
      ? await supabase.from('user_profiles').select('id, display_name, role').in('id', authorIds)
      : { data: [] }

    const profileMap = new Map((profiles ?? []).map((p) => [p.id as string, p]))

    return NextResponse.json({
      customer: {
        id:          customer.id,
        displayName: customer.display_name,
        isExcluded:  customer.is_excluded,
        status:      customer.status ?? 'active',
        entityRefs:  (refs ?? []).map((r) => ({ entityCode: r.entity_code, quickbooksName: r.quickbooks_name })),
        contacts:    (contacts ?? []).map((c) => ({
          id:        c.id,
          name:      c.name,
          title:     c.title,
          email:     c.email,
          phone:     c.phone,
          isPrimary: c.is_primary,
        })),
        notes: (notes ?? []).map((n) => ({
          id:            n.id,
          content:       n.content,
          createdAt:     n.created_at,
          createdByName: n.created_by ? (profileMap.get(n.created_by)?.display_name ?? null) : null,
        })),
        pmAssignments: (pmRows ?? []).map((p) => {
          const prof = profileMap.get(p.user_id)
          return { userId: p.user_id, displayName: prof?.display_name ?? '—', role: prof?.role ?? '—' }
        }),
      },
    })
  } catch (err) {
    console.error('AR customer GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    type CustomerUpdate = { is_excluded?: boolean; status?: string }
    const update: CustomerUpdate = {}

    if (typeof body.isExcluded === 'boolean') update.is_excluded = body.isExcluded
    if (typeof body.status === 'string') {
      const VALID = ['active', 'collections', 'on_hold', 'closed']
      if (!VALID.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      update.status = body.status
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase.from('ar_customers').update(update).eq('id', params.id)
    if (error) return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AR customer PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
