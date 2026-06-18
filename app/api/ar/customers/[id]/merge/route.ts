import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

// POST /api/ar/customers/[id]/merge
// Absorbs sourceCustomerId into [id] (the survivor). Every related row — invoices,
// contacts, notes, entity refs, AR team assignments, PM assignments, and promises —
// is moved to the target, then the source is deleted.
//
// The move + delete run inside the merge_ar_customer() Postgres function, so the whole
// operation is atomic: a failure partway through rolls back instead of leaving data
// half-moved. (Previously this was a sequence of separate updates that could not be
// rolled back, and it silently dropped ar_customer_assignments — which CASCADE-delete
// with the source — and orphaned payments/promises.)
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

    // Verify both customers exist (and capture the source name for the response)
    const [{ data: target }, { data: source }] = await Promise.all([
      supabase.from('ar_customers').select('id, display_name').eq('id', targetId).single(),
      supabase.from('ar_customers').select('id, display_name').eq('id', sourceId).single(),
    ])
    if (!target) return NextResponse.json({ error: 'Target customer not found' }, { status: 404 })
    if (!source) return NextResponse.json({ error: 'Source customer not found' }, { status: 404 })

    // Atomic merge — moves every related table and deletes the source in one transaction.
    const { error } = await supabase.rpc('merge_ar_customer', {
      p_target: targetId,
      p_source: sourceId,
    })
    if (error) {
      return NextResponse.json({ error: `Merge failed: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, mergedName: source.display_name })
  } catch (err) {
    console.error('AR customer merge error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
