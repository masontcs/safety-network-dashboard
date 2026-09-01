import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/supabase/database.types'
import { allowedPrefixesFor } from '@/lib/utils/interfaces'

type Role = Database['public']['Tables']['user_profiles']['Row']['role']

// Paths that are publicly accessible without auth
const PUBLIC_PATHS = ['/', '/login', '/request-access']

// Where each role lands after login (and after password-change redirect)
const ROLE_HOME: Record<Role, string> = {
  admin:            '/dashboard',
  executive:        '/dashboard',
  district_manager: '/dashboard',
  branch_manager:   '/dashboard',
  ar_manager:       '/ar',
  ar_team:          '/ar',
  office_team:      '/ar',
  project_manager:  '/dashboard',
  sales:            '/dashboard',
  // Field techs land in the mobile tech web app — the only interface they can reach.
  tech:             '/tech',
}

// Path prefixes each role is allowed to visit come from the single source of truth in
// lib/utils/interfaces — allow-lists only, so an unlisted role reaches nothing.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  let res = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          res = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the token server-side — safe against forged session cookies
  const { data: { user } } = await supabase.auth.getUser()

  // Unauthenticated: allow public paths, redirect everything else to /login
  if (!user) {
    if (PUBLIC_PATHS.includes(pathname)) return res
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data } = await supabase
    .from('user_profiles')
    .select('role, must_change_password, field_access')
    .eq('id', user.id)
    .single()
  const profile = data as { role: Role; must_change_password: boolean; field_access: boolean } | null

  // Authenticated user on a public path → redirect to their home page
  if (PUBLIC_PATHS.includes(pathname)) {
    const home = profile ? ROLE_HOME[profile.role] : '/dashboard'
    return NextResponse.redirect(new URL(home, request.url))
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

  // After password change, redirect to role home
  if (pathname === '/change-password') {
    return NextResponse.redirect(new URL(ROLE_HOME[profile.role], request.url))
  }

  // Block cross-role path access. allowedPrefixesFor is an allow-list: a role with no
  // grant reaches nothing, and is bounced to its home rather than shown a 403 (a 403
  // would confirm the page exists).
  const allowed = allowedPrefixesFor(profile.role, profile.field_access)
  if (!allowed.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.redirect(new URL(ROLE_HOME[profile.role], request.url))
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
    '/ar/:path*',
    // /billing was previously NOT matched, so the middleware never ran on it and the
    // /billing layout gate was the only thing standing between a user and the billing
    // interface. Matched now for defence in depth: two independent gates.
    '/billing/:path*',
    // The tech app — gated here (allow-list bounces non-tech roles) and again in the
    // /tech layout, two independent gates like /billing.
    '/tech/:path*',
  ],
}
