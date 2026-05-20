import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Public route — no auth required.
// Given a username, returns the email address so the login page can
// call supabase.auth.signInWithPassword({ email, password }).
// Returns a generic 404 if the username doesn't exist (no enumeration detail).
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const username = searchParams.get('username')?.trim().toLowerCase()

  if (!username) {
    return NextResponse.json({ success: false, error: 'username is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Find the user_profiles row with this username
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('username', username)
    .single()

  if (error || !profile) {
    // Generic message — don't reveal whether username exists or not
    return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 404 })
  }

  // Look up their email from auth.users
  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(profile.id)
  if (authErr || !authUser?.user?.email) {
    return NextResponse.json({ success: false, error: 'Invalid username or password' }, { status: 404 })
  }

  return NextResponse.json({ success: true, email: authUser.user.email })
}
