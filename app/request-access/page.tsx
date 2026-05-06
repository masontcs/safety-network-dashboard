import { createServiceClient } from '@/lib/supabase/server'
import RequestAccessClient from '@/components/access-requests/RequestAccessClient'

export default async function RequestAccessPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .eq('is_revenue_generating', true)
    .order('name')

  const branches = (data as { id: string; name: string }[] | null) ?? []

  return <RequestAccessClient branches={branches} />
}
