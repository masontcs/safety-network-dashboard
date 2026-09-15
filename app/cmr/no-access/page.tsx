import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrIcon from '@/components/cmr/CmrIcon'
import CmrSignOutButton from '@/components/cmr/CmrSignOutButton'

export const metadata: Metadata = { title: 'No access' }
export const dynamic = 'force-dynamic'

/**
 * Where anyone without a cmr_access grant lands — platform admins included. It shows no
 * ledger data and no navigation. A user who DOES have a grant is sent back to /cmr.
 */
export default async function CmrNoAccessPage() {
  const ctx = await getCmrPageContext()
  if (ctx.ok) redirect('/cmr')
  if (ctx.status === 401) redirect('/login')
  const checkFailed = ctx.status === 500

  return (
    <main className="cmr-gate" id="cmr-main">
      <div className="cmr-card">
        <div className="cmr-empty">
          <div className="cmr-brand">
            <div className="cmr-mark" aria-hidden="true">SN</div>
            <div style={{ textAlign: 'left' }}>
              <b className="cmr-serif">Cash Ledger</b>
              <small>Safety Network</small>
            </div>
          </div>
          <div className="ring" style={{ marginTop: 18 }}><CmrIcon name="lock" /></div>
          <h1 className="cmr-serif" style={{ fontSize: 22, fontWeight: 500, margin: '0 0 8px' }}>
            {checkFailed ? 'We couldn\u2019t check your access' : 'You don\u2019t have access'}
          </h1>
          <p>
            {checkFailed
              ? 'Something went wrong while checking your Cash Ledger access. Reload the page in a moment.'
              : 'Cash Ledger is open only to people a Controller has added. Being an admin elsewhere doesn\u2019t include it. If you need access, ask a Cash Ledger Controller.'}
          </p>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
            <CmrSignOutButton variant="button" />
          </div>
        </div>
      </div>
    </main>
  )
}
