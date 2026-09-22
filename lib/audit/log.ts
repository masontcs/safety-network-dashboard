import { createServiceClient } from '@/lib/supabase/server'

// ── Action types ───────────────────────────────────────────────────────────────

export type AuditAction =
  // User management
  | 'user.create'
  | 'user.update'
  // Technician logins
  | 'tech.provision_login'
  | 'tech.reset_password'
  // Access requests
  | 'access_request.approve'
  | 'access_request.archive'
  // Imports
  | 'import.payroll'
  | 'import.payroll.replace'
  | 'import.revenue'
  | 'import.fuel'
  // AR
  | 'ar.note.add'
  | 'ar.note.edit'
  | 'ar.note.delete'
  | 'ar.invoice.flag'
  | 'ar.invoice.void'
  | 'ar.invoice.unvoid'
  | 'ar.customer.update'
  // Payroll data access
  | 'payroll.view'
  // Billing — changing a profile's price list / category tiers re-rates every
  // uninvoiced line for that profile, so it is always logged.
  | 'billing.profile_entity_config.update'
  // SN Cash Ledger — access grants
  | 'cmr.access.grant'
  | 'cmr.access.update'
  | 'cmr.access.revoke'
  // SN Cash Ledger — accounts (never deleted; deactivated instead)
  | 'cmr.account.create'
  | 'cmr.account.rename'
  | 'cmr.account.retype'
  | 'cmr.account.activate'
  | 'cmr.account.deactivate'
  | 'cmr.account.reorder'
  // SN Cash Ledger — recurring vendors (never deleted; deactivated instead)
  | 'cmr.recurring.create'
  | 'cmr.recurring.update'
  | 'cmr.recurring.move'
  | 'cmr.recurring.last_sent'
  | 'cmr.recurring.hold'
  | 'cmr.recurring.release'
  | 'cmr.recurring.activate'
  | 'cmr.recurring.deactivate'
  | 'cmr.recurring.reorder'
  | 'cmr.recurring.place'
  // SN Cash Ledger — daily ledger (AM/PM snapshots created on demand; lines may be deleted)
  | 'cmr.ledger.create'
  | 'cmr.ledger.beginning_cash'
  | 'cmr.ledger.adjustment.create'
  | 'cmr.ledger.adjustment.update'
  | 'cmr.ledger.adjustment.delete'
  | 'cmr.ledger.adjustment.reorder'
  | 'cmr.ledger.pending.create'
  | 'cmr.ledger.pending.update'
  | 'cmr.ledger.pending.delete'
  | 'cmr.ledger.pending.reorder'
  // SN Cash Ledger — moving work forward and checking it off (Phase 6). A pushed item stays on
  // its old day as history; the forward copy is the live one.
  | 'cmr.pending.push'
  | 'cmr.pending.unpush'
  | 'cmr.pending.pay'
  | 'cmr.pending.unpay'
  // SN Cash Ledger — weekly priorities (Controller may hard-delete; carry-forward is Phase 6)
  | 'cmr.priority.create'
  | 'cmr.priority.update'
  | 'cmr.priority.flag'
  | 'cmr.priority.unflag'
  | 'cmr.priority.resolve'
  | 'cmr.priority.pay'
  | 'cmr.priority.reopen'
  | 'cmr.priority.delete'
  | 'cmr.priority.reorder'
  | 'cmr.priority.carry'
  // SN Cash Ledger — vendor requests (the only write a non-Controller can make; a withdrawn
  // request is hard-deleted, so the audit entry is the only record it ever existed)
  | 'cmr.request.submit'
  | 'cmr.request.update'
  | 'cmr.request.withdraw'
  | 'cmr.request.place'
  | 'cmr.request.decline'
  | 'cmr.request.unplace'
  // SN Cash Ledger — accounts payable (AP Phase 1). One entry per committed A/P Aging Detail
  // upload; it records the snapshot it replaced, since the replaced import row is deleted.
  | 'cmr.ap.import'

// ── Payload ────────────────────────────────────────────────────────────────────

export interface AuditPayload {
  userId: string
  userDisplayName: string
  userRole: string
  action: AuditAction
  resourceType?: string
  resourceId?: string
  resourceLabel?: string
  metadata?: Record<string, unknown>
  ipAddress?: string | null
}

// ── Helper to extract client IP from request headers ──────────────────────────

export function getClientIp(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  )
}

// ── Core logging function ──────────────────────────────────────────────────────
// Never throws — audit failures must never break the primary request.

export async function logAudit(payload: AuditPayload): Promise<void> {
  try {
    const supabase = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('audit_logs').insert({
      user_id:           payload.userId,
      user_display_name: payload.userDisplayName,
      user_role:         payload.userRole,
      action:            payload.action,
      resource_type:     payload.resourceType  ?? null,
      resource_id:       payload.resourceId    ?? null,
      resource_label:    payload.resourceLabel ?? null,
      metadata:          payload.metadata      ?? {},
      ip_address:        payload.ipAddress     ?? null,
    })
  } catch (e) {
    console.error('[audit] Failed to write log entry:', e)
  }
}
