import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/

const VALID_ROLES = [
  'branch_manager', 'district_manager', 'executive',
  'ar_manager', 'ar_team', 'office_team', 'project_manager',
]

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as {
      firstName?: string
      lastName?: string
      email?: string
      username?: string
      branchId?: string
      requestedRole?: string
      notes?: string
    }

    const { firstName, lastName, email, username, branchId, requestedRole, notes } = body

    if (!firstName?.trim()) {
      return NextResponse.json({ success: false, error: 'First name is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!lastName?.trim()) {
      return NextResponse.json({ success: false, error: 'Last name is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ success: false, error: 'A valid work email is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    const uname = username?.trim().toLowerCase() ?? ''
    if (!USERNAME_REGEX.test(uname)) {
      return NextResponse.json({ success: false, error: 'Username must be 3–20 characters and contain only lowercase letters, numbers, or underscores.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!branchId) {
      return NextResponse.json({ success: false, error: 'Branch is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!requestedRole || !VALID_ROLES.includes(requestedRole)) {
      return NextResponse.json({ success: false, error: 'A valid role is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Verify branch exists and is active
    const { data: branch, error: branchErr } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('is_active', true)
      .single()

    if (branchErr || !branch) {
      return NextResponse.json({ success: false, error: 'Invalid branch', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    // Check username isn't already taken by an existing account
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('username', uname)
      .maybeSingle()

    if (existingProfile) {
      return NextResponse.json({ success: false, error: 'That username is already taken. Please choose another.', code: 'CONFLICT' }, { status: 409 })
    }

    const { error } = await supabase.from('access_requests').insert({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim().toLowerCase(),
      username: uname,
      branch_id: branchId,
      requested_role: requestedRole,
      notes: notes?.trim() || null,
    })

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    return apiError(err)
  }
}
