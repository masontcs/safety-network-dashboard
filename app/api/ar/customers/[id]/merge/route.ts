import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

// POST /api/ar/customers/[id]/merge
// Absorbs sourceCustomerId into [id]. All refs, invoices, contacts, notes,
// and PM assignments from the source are moved to the target. Source is deleted.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const sourceId = body?.sourceCustomerId
    const targetId = params.id

    if (!sourceId || typeof sourceId !== 'string') {
      return NextResponse.json({ error: 'sourceCustomerId is required' }, { status: 400 })
    }
    if (sourceId === targetId) {
      return NextResponse.json({ error: 'Cannot merge a customer with itself' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Verify both customers exist
    const [{ data: target }, { data: source }] = await Promise.all([
      supabase.from('ar_customers').select('id, display_name').eq('id', targetId).single(),
      supabase.from('ar_customers').select('id, display_name').eq('id', sourceId).single(),
    ])
    if (!target) return NextResponse.json({ error: 'Target customer not found' }, { status: 404 })
    if (!source) return NextResponse.json({ error: 'Source customer not found' }, { status: 404 })

    // Move entity refs
    await supabase.from('ar_customer_entity_refs').update({ customer_id: targetId }).eq('customer_id', sourceId)

    // Move invoices
    await supabase.from('ar_invoices').update({ customer_id: targetId }).eq('customer_id', sourceId)

    // Move contacts
    await supabase.from('ar_customer_contacts').update({ customer_id: targetId }).eq('customer_id', sourceId)

    // Move notes
    await supabase.from('ar_customer_notes').update({ customer_id: targetId }).eq('customer_id', sourceId)

    // Move PM assignments — skip any that would create a duplicate (UNIQUE constraint)
    const { data: sourcePms } = await supabase.from('ar_customer_pm_assignments').select('user_id').eq('customer_id', sourceId)
    const { data: targetPms } = await supabase.from('ar_customer_pm_assignments').select('user_id').eq('customer_id', targetId)
    const existingUserIds = new Set((targetPms ?? []).map((p) => p.user_id as string))

    const toInsert = (sourcePms ?? [])
      .filter((p) => !existingUserIds.has(p.user_id as string))
      .map((p) => ({ customer_id: targetId, user_id: p.user_id as string }))

    if (toInsert.length > 0) {
      await supabase.from('ar_customer_pm_assignments').insert(toInsert)
    }

    // Delete source (cascades remaining source-owned rows like duplicate PM rows)
    await supabase.from('ar_customers').delete().eq('id', sourceId)

    return NextResponse.json({ success: true, mergedName: source.display_name })
  } catch (err) {
    console.error('AR customer merge error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
