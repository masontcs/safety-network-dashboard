import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/supabase/database.types'

type Role = Database['public']['Tables']['user_profiles']['Row']['role']

const ROLE_ROUTES: Record<Role, string> = {
  admin:            '/admin',
  executive:        '/executive',
  district_manager: '/district',
  branch_manager:   '/manager',
}

// Paths that are publicly accessible without auth
const PUBLIC_PATHS = ['/', '/login', '/request-access']

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

  // Authenticated user on a public path → redirect to their dashboard
  if (PUBLIC_PATHS.includes(pathname)) {
    if (profile) {
      return NextResponse.redirect(new URL(ROLE_ROUTES[profile.role], request.url))
    }
    return res
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
    return NextResponse.redirect(new URL(ROLE_ROUTES[profile.role], request.url))
  }

  const correctBase = ROLE_ROUTES[profile.role]
  if (!pathname.startsWith(correctBase)) {
    return NextResponse.redirect(new URL(correctBase, request.url))
  }

  return res
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/request-access',
    '/change-password',
    '/admin/:path*',
    '/executive/:path*',
    '/district/:path*',
    '/manager/:path*',
  ],
}
