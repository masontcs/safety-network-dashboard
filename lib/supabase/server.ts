import { createServerComponentClient, createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from './database.types'

// For Server Components (reads session from cookies — anon key, RLS enforced)
export function createServerClient() {
  return createServerComponentClient<Database>({ cookies })
}

// For Route Handlers (API routes that need the user's session via cookies)
export function createRouteClient() {
  return createRouteHandlerClient<Database>({ cookies })
}

// For API routes that need to bypass RLS (service role — SERVER ONLY, never NEXT_PUBLIC_)
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
