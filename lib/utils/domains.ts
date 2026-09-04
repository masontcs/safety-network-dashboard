/**
 * Subdomain surfaces. The one app is served under three subdomains — each shows only its own
 * interface (strict separation), while /login, /api and assets work on all of them:
 *
 *   billing.safetynetworkteams.com     → the billing interface (/billing)
 *   dashboards.safetynetworkteams.com  → the dashboards interface (/dashboard, /ar, /fuel, …)
 *   field.safetynetworkteams.com       → the field tech app (/tech)
 *
 * The apex (safetynetworkteams.com) is NOT served by this app (it's a separate base44 site),
 * so it never reaches here. The …vercel.app host has no surface, so it keeps serving everything
 * (a safe fallback + local dev). Dependency-free so middleware and components can share it.
 */

export const ROOT_DOMAIN = 'safetynetworkteams.com'

/**
 * The customer portal is a fourth surface, but it is NOT a staff Surface: it has its own
 * auth (external portal accounts, no user_profiles) and must stay isolated from the staff
 * subdomains. So it's handled separately from the Surface machinery below — the portal
 * lives only on portal.<root> and serves only /portal.
 */
export const PORTAL_HOST = `portal.${ROOT_DOMAIN}`
export const PORTAL_URL = `https://${PORTAL_HOST}`
/** Where an invite / password-reset link should land (the portal set-password flow). */
export const portalSetPasswordRedirect = (): string =>
  (process.env.NEXT_PUBLIC_PORTAL_URL || PORTAL_URL) + '/portal/auth/callback?next=set-password'
export const isPortalHost = (host?: string | null): boolean => (host ?? '').split(':')[0].toLowerCase() === PORTAL_HOST
export const isPortalPath = (pathname: string): boolean => pathname === '/portal' || pathname.startsWith('/portal/')

export type Surface = 'billing' | 'dashboards' | 'field'

export const SUBDOMAIN_HOST: Record<Surface, string> = {
  billing: `billing.${ROOT_DOMAIN}`,
  dashboards: `dashboards.${ROOT_DOMAIN}`,
  field: `field.${ROOT_DOMAIN}`,
}

const bareHost = (host?: string | null) => (host ?? '').split(':')[0].toLowerCase()

/** Which surface a Host header maps to, or null (…vercel.app / localhost / apex → no restriction). */
export function surfaceForHost(host?: string | null): Surface | null {
  const h = bareHost(host)
  if (h === SUBDOMAIN_HOST.billing) return 'billing'
  if (h === SUBDOMAIN_HOST.dashboards) return 'dashboards'
  if (h === SUBDOMAIN_HOST.field) return 'field'
  return null
}

/** Where each surface's root ('/') should land. */
export const SURFACE_HOME: Record<Surface, string> = { billing: '/billing', dashboards: '/dashboard', field: '/tech' }

/** The path prefixes that belong to each surface — used to route/guard by host. */
export const SURFACE_PREFIXES: Record<Surface, string[]> = {
  billing: ['/billing'],
  dashboards: ['/dashboard', '/ar', '/fuel', '/admin', '/executive', '/district', '/manager'],
  field: ['/tech'],
}

/** Which surface a path belongs to (by prefix), or null for shared/unknown paths. */
export function surfaceForPath(pathname: string): Surface | null {
  for (const s of ['billing', 'dashboards', 'field'] as Surface[]) {
    if (SURFACE_PREFIXES[s].some((p) => pathname === p || pathname.startsWith(p + '/'))) return s
  }
  return null
}

/** Absolute URL to a surface (for cross-subdomain redirects). */
export function surfaceUrl(surface: Surface, path = ''): string {
  return `https://${SUBDOMAIN_HOST[surface]}${path}`
}

/**
 * Cookie domain for a host: the parent domain for any *.safetynetworkteams.com host (so ONE
 * login is shared across billing/dashboards/field and a hybrid can hop between them without
 * re-authenticating); undefined for …vercel.app / localhost (host-only, unchanged).
 */
export function cookieDomainForHost(host?: string | null): string | undefined {
  const h = bareHost(host)
  // The portal is a separate audience with its own auth — keep its session cookie HOST-ONLY
  // so it never joins (or clobbers) the staff single-sign-on cookie on the parent domain.
  if (h === PORTAL_HOST) return undefined
  return h === ROOT_DOMAIN || h.endsWith('.' + ROOT_DOMAIN) ? '.' + ROOT_DOMAIN : undefined
}
