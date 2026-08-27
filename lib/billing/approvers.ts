import type { createServiceClient } from '@/lib/supabase/server'

type Svc = ReturnType<typeof createServiceClient>

/**
 * Time-approval authority. Approving a tech's times is governed ONLY by an explicit
 * per-branch grant in billing_time_approvers — this applies to EVERYONE, admins included
 * (no implicit override). A user with no grants cannot approve any branch.
 */
export async function approverBranchIds(supabase: Svc, userId: string): Promise<string[]> {
  const { data } = await supabase.from('billing_time_approvers').select('branch_id').eq('user_id', userId)
  return ((data ?? []) as { branch_id: string }[]).map((r) => r.branch_id)
}

export async function canApproveBranch(supabase: Svc, userId: string, branchId: string): Promise<boolean> {
  const { data } = await supabase
    .from('billing_time_approvers')
    .select('id')
    .eq('user_id', userId)
    .eq('branch_id', branchId)
    .maybeSingle()
  return !!data
}
