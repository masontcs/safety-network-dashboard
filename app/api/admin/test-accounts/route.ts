import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

const TEST_ACCOUNTS = [
  {
    email: 'test-executive@safetynetwork.com',
    displayName: 'Test Executive',
    role: 'executive' as const,
    branchNames: [] as string[],
  },
  {
    email: 'test-district@safetynetwork.com',
    displayName: 'Test District',
    role: 'district_manager' as const,
    branchNames: ['Bakersfield', 'Fresno'],
  },
  {
    email: 'test-manager@safetynetwork.com',
    displayName: 'Test Manager',
    role: 'branch_manager' as const,
    branchNames: ['Bakersfield'],
  },
]

const PASSWORD = 'TestPass2026!'

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { data: authUsers } = await supabase.auth.admin.listUsers()
    const emails = new Set((authUsers?.users ?? []).map((u) => u.email))

    const status = TEST_ACCOUNTS.map((a) => ({
      email: a.email,
      displayName: a.displayName,
      role: a.role,
      exists: emails.has(a.email),
    }))

    return NextResponse.json({ success: true, data: { accounts: status } })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const { data: branchRows } = await supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true)
    const branchByName = Object.fromEntries((branchRows ?? []).map((b) => [b.name, b.id]))

    const created: string[] = []
    const skipped: string[] = []

    for (const account of TEST_ACCOUNTS) {
      const { data: existing } = await supabase.auth.admin.listUsers()
      const alreadyExists = (existing?.users ?? []).some((u) => u.email === account.email)
      if (alreadyExists) {
        skipped.push(account.email)
        continue
      }

      const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
        email: account.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { must_change_password: false },
      })
      if (createErr) throw new Error(`Failed to create ${account.email}: ${createErr.message}`)

      const userId = createData.user?.id
      if (!userId) throw new Error(`No user ID returned for ${account.email}`)

      const { error: profileErr } = await supabase
        .from('user_profiles')
        .insert({
          id: userId,
          role: account.role,
          display_name: account.displayName,
          must_change_password: false,
        })
      if (profileErr) {
        await supabase.auth.admin.deleteUser(userId)
        throw new Error(`Failed to create profile for ${account.email}: ${profileErr.message}`)
      }

      if (account.branchNames.length > 0) {
        const branchIds = account.branchNames
          .map((name) => branchByName[name])
          .filter(Boolean)
        if (branchIds.length > 0) {
          const { error: assignErr } = await supabase
            .from('user_branch_assignments')
            .insert(branchIds.map((branch_id) => ({ user_id: userId, branch_id })))
          if (assignErr) throw new Error(`Failed to assign branches for ${account.email}: ${assignErr.message}`)
        }
      }

      created.push(account.email)
    }

    return NextResponse.json({ success: true, data: { created, skipped } }, { status: 201 })
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const { data: authUsers } = await supabase.auth.admin.listUsers()
    const testEmails = new Set(TEST_ACCOUNTS.map((a) => a.email))
    const toDelete = (authUsers?.users ?? []).filter((u) => testEmails.has(u.email ?? ''))

    const deleted: string[] = []
    for (const user of toDelete) {
      await supabase.from('user_branch_assignments').delete().eq('user_id', user.id)
      await supabase.from('user_profiles').delete().eq('id', user.id)
      await supabase.auth.admin.deleteUser(user.id)
      deleted.push(user.email ?? user.id)
    }

    return NextResponse.json({ success: true, data: { deleted } })
  } catch (err) {
    return apiError(err)
  }
}
