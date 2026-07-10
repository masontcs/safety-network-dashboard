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
  // Call `.rpc` AS A MEMBER of the client — do NOT pull it into a local const.
  // supabase-js's rpc() relies on `this` (this.rest); a detached reference
  // throws "Cannot read properties of undefined (reading 'rest')" at runtime.
  // We cast to any only because the Database `Functions` type is kept empty
  // (see database.types.ts), which erases rpc's argument types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc('billing_next_number', {
    p_kind: kind,
    p_entity: entityId,
    p_branch: branchId,
  })) as { data: string | null; error: { message: string } | null }
  if (error || !data) throw new Error(error?.message ?? `Failed to generate ${kind} number`)
  return data
}
