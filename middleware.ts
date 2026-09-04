import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/supabase/database.types'
import { allowedPrefixesFor, canBillingArea } from '@/lib/utils/interfaces'
import { surfaceForHost, surfaceForPath, surfaceUrl, cookieDomainForHost, SURFACE_HOME, isPortalHost, isPortalPath, PORTAL_URL } from '@/lib/utils/domains'

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
  // Billing roles land in the billing interface, at the area that matches their job.
  billing_branch_manager: '/billing',
  dispatcher:       '/billing/dispatch',
  biller:           '/billing',
}

// Path prefixes each role is allowed to visit come from the single source of truth in
// lib/utils/interfaces — allow-lists only, so an unlisted role reaches nothing.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')

  // ── Customer portal (its own world) ────────────────────────────────────────────
  // The portal has separate auth (portal accounts, no user_profiles), so the staff gating
  // below must never run on it. It lives ONLY on portal.<root>:
  //   • on the portal host, everything routes to /portal (its own layout gate handles auth);
  //   • on a staff subdomain, a /portal path is pushed to the portal host;
  //   • on …vercel.app / localhost (no custom domains) /portal is served in place for dev.
  const onPortalHost = isPortalHost(host)
  const portalPath = isPortalPath(pathname)
  if (onPortalHost) {
    if (!portalPath) return NextResponse.redirect(new URL('/portal', request.url))
    return NextResponse.next() // portal owns its auth in app/portal/(secure)/layout
  }
  if (portalPath) {
    // A staff subdomain must not serve the portal — push it to its own domain. On
    // …vercel.app / localhost / apex (no custom domains) serve it in place for dev, still
    // skipping the staff auth below (the portal's own layout gate handles auth).
    if (surfaceForHost(host)) return NextResponse.redirect(new URL(`${PORTAL_URL}${pathname}${request.nextUrl.search}`))
    return NextResponse.next()
  }

  // ── Subdomain routing (strict) ────────────────────────────────────────────────
  // On a surface subdomain: its root → that surface's home, and a path belonging to a
  // DIFFERENT surface → that surface's subdomain (a full cross-origin redirect). The
  // shared cookie (below) keeps the user signed in across the hop. …vercel.app / apex have
  // no surface, so they're untouched (fallback + local dev).
  const surface = surfaceForHost(host)
  if (surface) {
    if (pathname === '/') return NextResponse.redirect(new URL(SURFACE_HOME[surface], request.url))
    const pathSurface = surfaceForPath(pathname)
    if (pathSurface && pathSurface !== surface) {
      return NextResponse.redirect(surfaceUrl(pathSurface, pathname + request.nextUrl.search))
    }
  }

  // One login across all subdomains: write auth cookies on the parent domain.
  const cookieDomain = cookieDomainForHost(host)

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
            res.cookies.set(name, value, cookieDomain ? { ...options, domain: cookieDomain } : options)
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
    .select('role, must_change_password, field_access, billing_role')
    .eq('id', user.id)
    .single()
  const profile = data as { role: Role; must_change_password: boolean; field_access: boolean; billing_role: Role | null } | null

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
  const allowed = allowedPrefixesFor(profile.role, profile.field_access, profile.billing_role)
  // The billing home ('/billing') is granted by the 'home' area as an EXACT match — a prefix
  // would over-grant the whole /billing subtree to a role that only has the dashboard.
  const homeOk = pathname === '/billing' && canBillingArea(profile.role, 'home', profile.billing_role)
  if (!homeOk && !allowed.some((prefix) => pathname.startsWith(prefix))) {
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
    // The customer portal — matched so the host router can keep it on portal.<root>
    // (and redirect the root there). Its own layout gate handles auth; the early branch
    // in the middleware body returns before any staff-auth logic runs.
    '/portal',
    '/portal/:path*',
  ],
}
