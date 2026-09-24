import type { Metadata } from 'next'
import { LegalDocument, LegalSection, LegalMail } from '@/components/legal/LegalDocument'
import { LEGAL_ENTITY, LEGAL_GOVERNING_LAW, PRODUCT_NAME } from '@/lib/legal/content'

/**
 * Public Terms of Service / EULA — https://dashboards.safetynetworkteams.com/terms
 *
 * Listed as the EULA URL on the company's QuickBooks Online developer app. Public for the same
 * two reasons as /privacy: it is outside the middleware matcher, and PUBLIC_STATIC_PATHS
 * short-circuits the middleware before any auth check.
 *
 * Static server component: no data fetching, no client JS, no auth.
 */
export const metadata: Metadata = {
  title: `Terms of Service & EULA — ${PRODUCT_NAME}`,
  description: `Terms of use and end-user license agreement for the ${PRODUCT_NAME}.`,
  robots: { index: true, follow: true },
}

export const dynamic = 'force-static'

export default function TermsPage() {
  return (
    <LegalDocument title={`Terms of Service / End-User License Agreement — ${PRODUCT_NAME}`}>
      <LegalSection heading="Internal use">
        The Dashboard is provided for use by authorized employees and affiliates of{' '}
        {LEGAL_ENTITY}. Access requires explicit authorization.
      </LegalSection>

      <LegalSection heading="License">
        You are granted a limited, non-transferable, revocable license to use the Dashboard for
        internal business purposes only.
      </LegalSection>

      <LegalSection heading="Acceptable use">
        No unauthorized access, no reverse engineering, no automated scraping, no use outside
        authorized business purposes.
      </LegalSection>

      <LegalSection heading="QuickBooks integration">
        By connecting a QuickBooks Online company, an authorized administrator authorizes the
        Dashboard to access that company&rsquo;s accounting data as described in the Privacy
        Policy.
      </LegalSection>

      <LegalSection heading="No warranty">
        The Dashboard is provided &ldquo;as is,&rdquo; without warranties of any kind.
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        To the maximum extent permitted by law, {LEGAL_ENTITY} is not liable for indirect or
        consequential damages arising from use of the Dashboard.
      </LegalSection>

      <LegalSection heading="Termination">
        Access may be suspended or revoked at any time.
      </LegalSection>

      <LegalSection heading="Governing law">
        {LEGAL_GOVERNING_LAW}.
      </LegalSection>

      <LegalSection heading="Contact">
        <LegalMail />.
      </LegalSection>
    </LegalDocument>
  )
}
