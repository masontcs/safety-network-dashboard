'use client'

import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr'
import type { Database } from './database.types'
import { cookieDomainForHost } from '@/lib/utils/domains'

// For Client Components (browser — anon key, RLS enforced)
export function createBrowserClient() {
  // Share the session across subdomains: parent-domain cookie on *.safetynetworkteams.com,
  // host-only otherwise (…vercel.app / localhost).
  const domain = typeof window !== 'undefined' ? cookieDomainForHost(window.location.host) : undefined
  return createSSRBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    domain ? { cookieOptions: { domain } } : undefined
  )
}
