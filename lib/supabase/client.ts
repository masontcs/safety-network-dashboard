'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from './database.types'

// For Client Components (browser — anon key, RLS enforced)
export function createBrowserClient() {
  return createClientComponentClient<Database>()
}
