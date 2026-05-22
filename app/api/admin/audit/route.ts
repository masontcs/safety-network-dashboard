import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const { searchParams } = new URL(request.url)
    const page       = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit      = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') ?? '50', 10)))
    const userId     = searchParams.get('userId') || null
    const category   = searchParams.get('category') || null   // 'users' | 'imports' | 'ar' | 'payroll'
    const startDate  = searchParams.get('startDate') || null
    const endDate    = searchParams.get('endDate') || null
    const from       = (page - 1) * limit

    const supabase = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    let query = db
      .from('audit_logs')
      .select('id, user_id, user_display_name, user_role, action, resource_type, resource_id, resource_label, metadata, ip_address, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)

    if (userId) query = query.eq('user_id', userId)

    if (category) {
      const prefixMap: Record<string, string> = {
        users:   'user.',
        requests: 'access_request.',
        imports: 'import.',
        ar:      'ar.',
        payroll: 'payroll.',
      }
      const prefix = prefixMap[category]
      if (prefix) query = query.like('action', `${prefix}%`)
    }

    if (startDate) query = query.gte('created_at', startDate)
    if (endDate) {
      // Include the full end day
      const end = new Date(endDate)
      end.setDate(end.getDate() + 1)
      query = query.lt('created_at', end.toISOString().slice(0, 10))
    }

    const { data: logs, error, count } = await query
    if (error) throw new Error(error.message)

    // Fetch distinct users for the filter dropdown — cap at 5000 rows to prevent
    // a full-table scan as audit_logs grows; only distinct users are needed.
    const { data: users } = await db
      .from('audit_logs')
      .select('user_id, user_display_name, user_role')
      .order('user_display_name')
      .limit(5000)

    // Deduplicate by user_id
    const userMap = new Map<string, { userId: string; displayName: string; role: string }>()
    for (const u of users ?? []) {
      if (u.user_id && !userMap.has(u.user_id)) {
        userMap.set(u.user_id, {
          userId:      u.user_id,
          displayName: u.user_display_name,
          role:        u.user_role,
        })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        logs:  logs ?? [],
        total: count ?? 0,
        page,
        limit,
        users: [...userMap.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
      },
    })
  } catch (err) {
    console.error('Audit log GET error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
