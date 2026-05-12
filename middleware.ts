import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/supabase/database.types'

type Role = Database['public']['Tables']['user_profiles']['Row']['role']

// After login, all roles land on /dashboard
const DASHBOARD = '/dashboard'

// Paths that are publicly accessible without auth
const PUBLIC_PATHS = ['/', '/login', '/request-access']

// Role-specific path prefixes that each role is allowed to access
const ROLE_ALLOWED_PREFIXES: Record<Role, string[]> = {
  admin:            ['/dashboard', '/admin', '/fuel'],
  executive:        ['/dashboard', '/executive', '/fuel'],
  district_manager: ['/dashboard', '/district', '/fuel'],
  branch_manager:   ['/dashboard', '/manager', '/fuel'],
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const res = NextResponse.next()
  const supabase = createMiddlewareClient<Database>({ req: request, res })

  const { data: { session } } = await supabase.auth.getSession()

  // Unauthenticated: allow public paths, redirect everything else to /login
  if (!session) {
    if (PUBLIC_PATHS.includes(pathname)) return res
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data } = await supabase
    .from('user_profiles')
    .select('role, must_change_password')
    .eq('id', session.user.id)
    .single()
  const profile = data as { role: Role; must_change_password: boolean } | null

  // Authenticated user on a public path → redirect to dashboard
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL(DASHBOARD, request.url))
  }

  if (!profile) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Force password change before anything else
  if (profile.must_change_password) {
    if (pathname !== '/change-password') {
      return NextResponse.redirect(new URL('/change-password', request.url))
    }
    return res
  }

  // Already changed password — don't let them back to the change-password page
  if (pathname === '/change-password') {
    return NextResponse.redirect(new URL(DASHBOARD, request.url))
  }

  // Block cross-role access (individual server pages do their own role checks,
  // but this prevents a branch_manager from even reaching /admin/import etc.)
  const allowed = ROLE_ALLOWED_PREFIXES[profile.role]
  if (!allowed.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.redirect(new URL(DASHBOARD, request.url))
  }

  return res
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/request-access',
    '/change-password',
    '/dashboard/:path*',
    '/admin/:path*',
    '/executive/:path*',
    '/district/:path*',
    '/manager/:path*',
    '/fuel/:path*',
  ],
}
