import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * TEST UTILITY (admin-only) — seed a working tech login so the /tech app can be tested.
 *
 * The normal admin "create user" flow doesn't offer the `tech` role and nothing links a
 * technician to an account yet (the invite/provision flow is still to build). This endpoint
 * stands in for that until the real provisioning UI exists: it creates (or resets) a single
 * fixed test account, links it to a technician, and assigns it as LEAD on the most recent
 * active ticket so the whole flow (labor → equipment → submit) is exercisable.
 *
 * Idempotent and scoped to ONE fixed email. Remove once the real provisioning UI lands.
 */
const EMAIL = 'test-tech@safetynetwork.com'
const TECH_NAME = 'Test Tech (mobile)'

export async function POST(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const password = `Tech-${randomBytes(5).toString('hex')}!` // returned once, to the admin

    // 1) Auth user — create, or reset the password if it already exists.
    const { data: list } = await supabase.auth.admin.listUsers()
    const existing = (list?.users ?? []).find((u) => u.email === EMAIL)
    let userId: string
    if (existing) {
      userId = existing.id
      await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true })
    } else {
      const { data: created, error } = await supabase.auth.admin.createUser({
        email: EMAIL,
        password,
        email_confirm: true,
        user_metadata: { must_change_password: false },
      })
      if (error) throw new Error(`createUser: ${error.message}`)
      userId = created.user!.id
    }

    // 2) Profile — least-privileged tech role, no forced password change (so it's testable now).
    const { error: profErr } = await supabase
      .from('user_profiles')
      .upsert({ id: userId, role: 'tech', display_name: TECH_NAME, must_change_password: false }, { onConflict: 'id' })
    if (profErr) throw new Error(`profile: ${profErr.message}`)

    // 3) Technician linked to that login.
    const { data: linked } = await supabase.from('billing_technicians').select('id').eq('user_id', userId).maybeSingle()
    let technicianId: string
    if (linked) {
      technicianId = linked.id
      await supabase.from('billing_technicians').update({ is_active: true, name: TECH_NAME }).eq('id', technicianId)
    } else {
      const { data: tech, error: tErr } = await supabase
        .from('billing_technicians')
        .insert({ name: TECH_NAME, user_id: userId, is_active: true })
        .select('id')
        .single()
      if (tErr) throw new Error(`technician: ${tErr.message}`)
      technicianId = tech.id
    }

    // 4) Assign as LEAD on the most recent active ticket, if one exists.
    const { data: ticket } = await supabase
      .from('billing_tickets')
      .select('id, ticket_number')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let assignedTicket: { id: string; number: string } | null = null
    if (ticket) {
      // Satisfy "at most one lead per ticket": demote any current lead, drop any prior row
      // for this tech, then insert this tech as the lead.
      await supabase.from('billing_ticket_assignments').update({ is_lead: false }).eq('ticket_id', ticket.id).eq('is_lead', true)
      await supabase.from('billing_ticket_assignments').delete().eq('ticket_id', ticket.id).eq('technician_id', technicianId)
      const { error: aErr } = await supabase
        .from('billing_ticket_assignments')
        .insert({ ticket_id: ticket.id, technician_id: technicianId, is_lead: true })
      if (aErr) throw new Error(`assignment: ${aErr.message}`)
      assignedTicket = { id: ticket.id, number: ticket.ticket_number }
    }

    return NextResponse.json({
      success: true,
      data: {
        login: { email: EMAIL, password },
        technicianId,
        assignedTicket,
        note: assignedTicket
          ? `Assigned as LEAD on active ticket ${assignedTicket.number}. Sign out, then sign in at /tech with the login above.`
          : 'No active ticket found to assign. Create/keep an active ticket, then POST this again to assign it.',
      },
    })
  } catch (err) {
    // Temp util: surface the real error (apiError would mask it as "unexpected error").
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message, code: 'SEED_ERROR' }, { status: 500 })
  }
}
