import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as { temporaryPassword?: string }
    const { temporaryPassword } = body

    if (!temporaryPassword || temporaryPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const supabase = createServiceClient()

    // Verify target user exists in our system
    const { data: profile, error: profileCheckErr } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('id', params.id)
      .single()

    if (profileCheckErr || !profile) {
      return NextResponse.json(
        { success: false, error: 'User not found.', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const { error: authErr } = await supabase.auth.admin.updateUserById(params.id, {
      password: temporaryPassword,
    })
    if (authErr) throw new Error(authErr.message)

    const { error: profileErr } = await supabase
      .from('user_profiles')
      .update({ must_change_password: true })
      .eq('id', params.id)
    if (profileErr) throw new Error(profileErr.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
