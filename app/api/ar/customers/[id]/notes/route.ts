import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'

// Write access per note type
const COLLECTION_WRITE_ROLES: Role[] = ['admin', 'ar_manager', 'ar_team', 'executive']
const OPERATION_WRITE_ROLES: Role[]  = ['admin', 'executive', 'district_manager', 'branch_manager', 'project_manager']

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const { role, userId } = ctx.access

    const body = await request.json()
    const content  = body?.content?.trim()
    const noteType = (body?.noteType ?? 'collection') as 'collection' | 'operation'

    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })
    if (noteType !== 'collection' && noteType !== 'operation') {
      return NextResponse.json({ error: 'Invalid noteType' }, { status: 400 })
    }

    // Validate the role can write this note type
    if (noteType === 'collection' && !COLLECTION_WRITE_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Your role cannot write collection notes' }, { status: 403 })
    }
    if (noteType === 'operation' && !OPERATION_WRITE_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Your role cannot write operation notes' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('ar_customer_notes')
      .insert({ customer_id: params.id, content, created_by: userId ?? null, note_type: noteType })
      .select('id, content, created_by, created_at, note_type')
      .single()

    if (error) return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })

    const { data: profile } = data.created_by
      ? await supabase.from('user_profiles').select('display_name').eq('id', data.created_by).single()
      : { data: null }

    return NextResponse.json({
      note: {
        id:            data.id,
        content:       data.content,
        noteType:      data.note_type,
        createdAt:     data.created_at,
        createdByName: profile?.display_name ?? null,
      },
    })
  } catch (err) {
    console.error('AR note POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
