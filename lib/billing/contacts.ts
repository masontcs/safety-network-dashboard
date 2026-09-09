/**
 * Billing profile contact roles — the functions a per-profile contact can hold.
 * Kept in lib (not in a route.ts) because Next's App Router rejects any non-handler
 * export from a route file, so the two contact routes import the list from here.
 */
export const CONTACT_ROLES = ['general', 'ap', 'pm', 'superintendent', 'safety', 'estimator', 'scheduler', 'other'] as const
export type ContactRole = (typeof CONTACT_ROLES)[number]

/** Coerce arbitrary input to a valid role, defaulting to 'general'. */
export const normContactRole = (v: unknown): ContactRole =>
  (CONTACT_ROLES as readonly string[]).includes(v as string) ? (v as ContactRole) : 'general'
