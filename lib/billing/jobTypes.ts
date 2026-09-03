import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/**
 * The set of real job-type names (managed in billing_job_types). Used to validate job types
 * saved on a shift. We accept ANY existing name — active or retired — so retiring a type never
 * strips it from a shift that already used it; the dispatch picker separately shows only active
 * ones. Anything not in this set is a bogus value and gets dropped.
 */
export async function existingJobTypeNames(supabase: SupabaseClient<Database>): Promise<Set<string>> {
  const { data } = await supabase.from('billing_job_types').select('name')
  return new Set((data ?? []).map((r) => r.name as string))
}
