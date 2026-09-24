import type { Metadata } from 'next'
import { LegalDocument, LegalSection, LegalMail } from '@/components/legal/LegalDocument'
import { LEGAL_AFFILIATE, LEGAL_ENTITY, PRODUCT_NAME } from '@/lib/legal/content'

/**
 * Public Privacy Policy — https://dashboards.safetynetworkteams.com/privacy
 *
 * Listed as the privacy-policy URL on the company's QuickBooks Online developer app, so it must
 * render for an unauthenticated request. It is public by construction: the middleware `config
 * .matcher` is an allow-list that does not include this path (so the middleware never runs on
 * it), and the middleware also short-circuits PUBLIC_STATIC_PATHS before any auth check as a
 * second, independent guarantee.
 *
 * Static server component: no data fetching, no client JS, no auth.
 */
export const metadata: Metadata = {
  title: `Privacy Policy — ${PRODUCT_NAME}`,
  description: `How the ${PRODUCT_NAME} accesses and uses QuickBooks Online data.`,
  // The root layout sets robots: noindex for the internal app. These two pages are the
  // exception — they are meant to be publicly reachable and indexable.
  robots: { index: true, follow: true },
}

export const dynamic = 'force-static'

export default function PrivacyPage() {
  return (
    <LegalDocument title={`Privacy Policy — ${PRODUCT_NAME}`}>
      <LegalSection heading="Who we are">
        The {PRODUCT_NAME} (&ldquo;the Dashboard&rdquo;) is an internal business application
        operated by {LEGAL_ENTITY} and its affiliated companies, including {LEGAL_AFFILIATE}.
        Contact: <LegalMail />.
      </LegalSection>

      <LegalSection heading="Scope">
        This policy covers the Dashboard application and its integration with QuickBooks Online.
      </LegalSection>

      <LegalSection heading="Information we access">
        When connected to QuickBooks Online, the Dashboard accesses the connected company&rsquo;s
        business accounting data through Intuit&rsquo;s API — accounts receivable, accounts
        payable, and revenue / profit-and-loss reporting. It does not access consumer or
        cardholder data.
      </LegalSection>

      <LegalSection heading="How we use it">
        Solely to display internal financial dashboards to authorized employees. We do not sell,
        rent, or share this data with third parties.
      </LegalSection>

      <LegalSection heading="Storage & security">
        Data is stored in our secured database with access restricted to authorized users. Access
        tokens are stored securely and transmitted only over encrypted (HTTPS) connections.
      </LegalSection>

      <LegalSection heading="Retention">
        Data is retained while the QuickBooks integration is active and removed upon disconnection
        or request.
      </LegalSection>

      <LegalSection heading="Your choices">
        An authorized administrator can disconnect the QuickBooks integration at any time, which
        revokes the Dashboard&rsquo;s access. You may also disconnect from within QuickBooks.
      </LegalSection>

      <LegalSection heading="Changes">
        We may update this policy; updates are posted on this page.
      </LegalSection>

      <LegalSection heading="Contact">
        <LegalMail />.
      </LegalSection>
    </LegalDocument>
  )
}
