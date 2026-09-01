import { createServerClient as createSSRServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import type { Database } from './database.types'
import { cookieDomainForHost } from '@/lib/utils/domains'

// For Server Components and Route Handlers (session from cookies — anon key, RLS enforced)
export function createServerClient() {
  const cookieStore = cookies()
  // Share the session across subdomains: parent-domain cookie for *.safetynetworkteams.com,
  // host-only (undefined) for …vercel.app / localhost.
  let cookieDomain: string | undefined
  try { cookieDomain = cookieDomainForHost(headers().get('host')) } catch { cookieDomain = undefined }
  return createSSRServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, cookieDomain ? { ...options, domain: cookieDomain } : options)
            )
          } catch {
            // Called from a Server Component — cookie writes are a no-op
          }
        },
      },
    }
  )
}

// Alias kept for backwards compatibility with existing route handler imports
export const createRouteClient = createServerClient

// For API routes that need to bypass RLS (service role — SERVER ONLY, never NEXT_PUBLIC_)
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
