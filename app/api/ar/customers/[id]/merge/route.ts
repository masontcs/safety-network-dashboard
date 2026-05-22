import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
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
    const guard = guardArAdminOnly(ctx.access.role)
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

    // NOTE: These steps are not wrapped in a DB transaction — if any step fails after
    // an earlier step succeeds, some data will have moved and some won't. For a proper
    // atomic merge this should be converted to a Postgres RPC function. The error
    // checks below at least surface failures clearly rather than silently swallowing them.

    // Move entity refs
    const { error: e1 } = await supabase.from('ar_customer_entity_refs').update({ customer_id: targetId }).eq('customer_id', sourceId)
    if (e1) return NextResponse.json({ error: `Failed to move entity refs: ${e1.message}` }, { status: 500 })

    // Move invoices
    const { error: e2 } = await supabase.from('ar_invoices').update({ customer_id: targetId }).eq('customer_id', sourceId)
    if (e2) return NextResponse.json({ error: `Failed to move invoices: ${e2.message}` }, { status: 500 })

    // Move contacts
    const { error: e3 } = await supabase.from('ar_customer_contacts').update({ customer_id: targetId }).eq('customer_id', sourceId)
    if (e3) return NextResponse.json({ error: `Failed to move contacts: ${e3.message}` }, { status: 500 })

    // Move notes
    const { error: e4 } = await supabase.from('ar_customer_notes').update({ customer_id: targetId }).eq('customer_id', sourceId)
    if (e4) return NextResponse.json({ error: `Failed to move notes: ${e4.message}` }, { status: 500 })

    // Move PM assignments — skip any that would create a duplicate (UNIQUE constraint)
    const { data: sourcePms, error: e5 } = await supabase.from('ar_customer_pm_assignments').select('user_id').eq('customer_id', sourceId)
    if (e5) return NextResponse.json({ error: `Failed to read source PM assignments: ${e5.message}` }, { status: 500 })
    const { data: targetPms, error: e6 } = await supabase.from('ar_customer_pm_assignments').select('user_id').eq('customer_id', targetId)
    if (e6) return NextResponse.json({ error: `Failed to read target PM assignments: ${e6.message}` }, { status: 500 })
    const existingUserIds = new Set((targetPms ?? []).map((p) => p.user_id as string))

    const toInsert = (sourcePms ?? [])
      .filter((p) => !existingUserIds.has(p.user_id as string))
      .map((p) => ({ customer_id: targetId, user_id: p.user_id as string }))

    if (toInsert.length > 0) {
      const { error: e7 } = await supabase.from('ar_customer_pm_assignments').insert(toInsert)
      if (e7) return NextResponse.json({ error: `Failed to move PM assignments: ${e7.message}` }, { status: 500 })
    }

    // Delete source (cascades remaining source-owned rows like duplicate PM rows)
    const { error: e8 } = await supabase.from('ar_customers').delete().eq('id', sourceId)
    if (e8) return NextResponse.json({ error: `Failed to delete source customer: ${e8.message}` }, { status: 500 })

    return NextResponse.json({ success: true, mergedName: source.display_name })
  } catch (err) {
    console.error('AR customer merge error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
