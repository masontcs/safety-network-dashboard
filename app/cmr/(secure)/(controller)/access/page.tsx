import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCmrPageContext } from '@/lib/cmr/session'
import CmrAccessClient from '@/components/cmr/CmrAccessClient'

export const metadata: Metadata = { title: 'Access' }

export default async function CmrAccessPage() {
  const ctx = await getCmrPageContext()
  if (!ctx.ok || ctx.role !== 'controller') redirect('/cmr')
  return <CmrAccessClient currentUserId={ctx.userId} />
}
