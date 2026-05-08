import { redirect } from 'next/navigation'
import { getAccessContext } from '@/lib/api/auth'
import PayrollItemsClient from './PayrollItemsClient'

export default async function PayrollItemsPage() {
  const ctx = await getAccessContext()
  if (!ctx.ok) redirect('/login')
  if (ctx.access.role !== 'admin') redirect('/admin')

  return <PayrollItemsClient />
}
