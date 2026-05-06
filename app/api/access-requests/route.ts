import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as {
      firstName?: string
      lastName?: string
      email?: string
      branchId?: string
      requestedRole?: string
      notes?: string
    }

    const { firstName, lastName, email, branchId, requestedRole, notes } = body

    if (!firstName?.trim()) {
      return NextResponse.json({ success: false, error: 'First name is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!lastName?.trim()) {
      return NextResponse.json({ success: false, error: 'Last name is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ success: false, error: 'A valid work email is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!branchId) {
      return NextResponse.json({ success: false, error: 'Branch is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!requestedRole || !['branch_manager', 'district_manager', 'executive'].includes(requestedRole)) {
      return NextResponse.json({ success: false, error: 'A valid role is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Verify branch exists and is active
    const { data: branch, error: branchErr } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('is_active', true)
      .eq('is_revenue_generating', true)
      .single()

    if (branchErr || !branch) {
      return NextResponse.json({ success: false, error: 'Invalid branch', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const { error } = await supabase.from('access_requests').insert({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim().toLowerCase(),
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
