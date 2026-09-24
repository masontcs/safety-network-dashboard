/**
 * The two public legal pages (/privacy and /terms) exist so the company's QuickBooks Online
 * developer app can list a privacy-policy URL and an EULA URL that Intuit (and anyone else)
 * can fetch without signing in.
 *
 * Everything an editor is likely to want to change lives here: the legal entity name, the
 * contact address, and the effective date shown on both pages. Change a value once and both
 * pages follow.
 */

/** The operating entity named throughout both documents. */
export const LEGAL_ENTITY = 'Safety Network'

/** Affiliate named in the Privacy Policy's "Who we are". */
export const LEGAL_AFFILIATE = 'Western Highways'

/** The product name used in both documents. */
export const PRODUCT_NAME = 'Safety Network Dashboard'

/** Contact address printed on both pages. */
export const LEGAL_CONTACT_EMAIL = 'privacy@safetynetworkteams.com'

/** Effective date shown under each title (ISO day, rendered in Pacific-neutral long form). */
export const LEGAL_EFFECTIVE_DATE = '2026-09-24'

/** Human-readable form of LEGAL_EFFECTIVE_DATE — computed with no timezone shift. */
export const LEGAL_EFFECTIVE_DATE_LABEL = new Date(`${LEGAL_EFFECTIVE_DATE}T12:00:00Z`)
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** Governing law for the Terms. */
export const LEGAL_GOVERNING_LAW = 'California, USA'
