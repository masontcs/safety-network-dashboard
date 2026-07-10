import type { createServiceClient } from '@/lib/supabase/server'

/**
 * Typed wrapper for the billing number generator.
 *
 * The Database `Functions` type is kept empty on purpose (populating it breaks
 * supabase-js embed-cast inference in unrelated dashboard routes), so RPCs are
 * typed here at the call site instead.
 *
 * `billing_next_number` is SECURITY DEFINER and granted to service_role only,
 * so it must be called with the SERVICE client.
 */
export async function nextNumber(
  supabase: ReturnType<typeof createServiceClient>,
  kind: 'job' | 'ticket' | 'invoice' | 'bid',
  entityId: string,
  branchId: string | null = null
): Promise<string> {
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: { p_kind: string; p_entity: string; p_branch: string | null }
  ) => Promise<{ data: string | null; error: { message: string } | null }>
  const { data, error } = await rpc('billing_next_number', { p_kind: kind, p_entity: entityId, p_branch: branchId })
  if (error || !data) throw new Error(error?.message ?? `Failed to generate ${kind} number`)
  return data
}
