import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'
import { logAudit, getClientIp } from '@/lib/audit/log'

// Write access per note type
const COLLECTION_WRITE_ROLES: Role[] = ['admin', 'ar_manager', 'ar_team', 'office_team', 'executive']
const OPERATION_WRITE_ROLES: Role[]  = ['admin', 'executive', 'district_manager', 'branch_manager', 'project_manager', 'sales']

const VALID_COMM_TYPES  = ['email', 'phone_call', 'text', 'in_person', 'portal']
const VALID_OUTCOMES    = ['positive', 'no_answer', 'needs_follow_up', 'roadblock', 'promise_to_pay', 'escalated', 'unproductive']

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const ip = getClientIp(request)
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const { role, userId } = ctx.access

    const body = await request.json()
    const content          = body?.content?.trim()
    const noteType         = (body?.noteType ?? 'collection') as 'collection' | 'operation'
    const communicationType = body?.communicationType ?? null
    const contactName      = body?.contactName?.trim() || null
    const outcome          = body?.outcome ?? null

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

    // Validate optional enum fields (only meaningful on collection notes)
    if (communicationType !== null && !VALID_COMM_TYPES.includes(communicationType)) {
      return NextResponse.json({ error: 'Invalid communicationType' }, { status: 400 })
    }
    if (outcome !== null && !VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('ar_customer_notes')
      .insert({
        customer_id:        params.id,
        content,
        created_by:         userId ?? null,
        note_type:          noteType,
        communication_type: communicationType,
        contact_name:       contactName,
        outcome:            outcome,
      })
      .select('id, content, created_by, created_at, note_type, communication_type, contact_name, outcome')
      .single()

    if (error) return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })

    // Resolve customer name for the audit label (best-effort)
    const { data: customer } = await supabase
      .from('ar_customers').select('display_name').eq('id', params.id).single()

    await logAudit({
      userId:          ctx.access.userId,
      userDisplayName: ctx.access.displayName,
      userRole:        ctx.access.role,
      action:          'ar.note.add',
      resourceType:    'ar_customer',
      resourceId:      params.id,
      resourceLabel:   (customer as { display_name: string } | null)?.display_name ?? params.id,
      metadata:        { noteType, snippet: content.slice(0, 120) },
      ipAddress:       ip,
    })

    const { data: profile } = data.created_by
      ? await supabase.from('user_profiles').select('display_name').eq('id', data.created_by).single()
      : { data: null }

    return NextResponse.json({
      note: {
        id:                data.id,
        content:           data.content,
        noteType:          data.note_type,
        createdAt:         data.created_at,
        editedAt:          null,
        createdBy:         data.created_by ?? null,
        createdByName:     profile?.display_name ?? null,
        communicationType: data.communication_type ?? null,
        contactName:       data.contact_name ?? null,
        outcome:           data.outcome ?? null,
      },
    })
  } catch (err) {
    console.error('AR note POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
