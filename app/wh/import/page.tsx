import type { Metadata } from 'next'
import WhImportClient from '@/components/wh/WhImportClient'
import { getWhPageContext, whPageRedirect } from '@/lib/wh/access'

/**
 * The WH upload screen. A wh_access grant covers reading AND uploading, so this is the same
 * gate as the rest of the section — re-run here rather than trusted from the layout. Both
 * import routes under /api/wh check it again themselves: the UI hiding a button is never the
 * thing that stops a write.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Import' }

export default async function WhImportPage() {
  const ctx = await getWhPageContext()
  if (!ctx.ok) whPageRedirect(ctx.reason)

  return <WhImportClient />
}
