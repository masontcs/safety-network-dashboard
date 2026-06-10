import { createServiceClient } from '@/lib/supabase/server'

// ── Action types ───────────────────────────────────────────────────────────────

export type AuditAction =
  // User management
  | 'user.create'
  | 'user.update'
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
