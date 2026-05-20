import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('ar_invoice_notes')
      .select('id, content, created_by, created_at')
      .eq('invoice_id', params.id)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 })

    // Fetch author names in one batch
    const userIds = [...new Set((data ?? []).map((n) => n.created_by).filter(Boolean))] as string[]
    const profileMap: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, display_name')
        .in('id', userIds)
      for (const p of profiles ?? []) profileMap[p.id] = p.display_name
    }

    const notes = (data ?? []).map((n) => ({
      id:            n.id,
      content:       n.content,
      createdAt:     n.created_at,
      createdByName: n.created_by ? (profileMap[n.created_by] ?? null) : null,
    }))

    return NextResponse.json({ notes })
  } catch (err) {
    console.error('AR invoice notes GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard
    const { userId } = ctx.access

    const body = await request.json()
    const content = body?.content?.trim()
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('ar_invoice_notes')
      .insert({ invoice_id: params.id, content, created_by: userId ?? null })
      .select('id, content, created_by, created_at')
      .single()

    if (error) return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })

    const { data: profile } = data.created_by
      ? await supabase.from('user_profiles').select('display_name').eq('id', data.created_by).single()
      : { data: null }

    return NextResponse.json({
      note: {
        id:            data.id,
        content:       data.content,
        createdAt:     data.created_at,
        createdByName: (profile as { display_name: string } | null)?.display_name ?? null,
      },
    })
  } catch (err) {
    console.error('AR invoice notes POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
