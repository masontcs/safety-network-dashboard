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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const res = NextResponse.next()
  const supabase = createMiddlewareClient<Database>({ req: request, res })

  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    if (pathname === '/login') return res
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()
  const profile = data as { role: Role } | null

  // Authenticated user hitting /login → send to their dashboard
  if (pathname === '/login') {
    if (profile) {
      return NextResponse.redirect(new URL(ROLE_ROUTES[profile.role], request.url))
    }
    return res
  }

  if (!profile) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const correctBase = ROLE_ROUTES[profile.role]
  if (!pathname.startsWith(correctBase)) {
    return NextResponse.redirect(new URL(correctBase, request.url))
  }

  return res
}

export const config = {
  matcher: [
    '/login',
    '/admin/:path*',
    '/executive/:path*',
    '/district/:path*',
    '/manager/:path*',
  ],
}
