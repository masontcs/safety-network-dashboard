import { createServiceClient } from '@/lib/supabase/server'
import RequestAccessClient from '@/components/access-requests/RequestAccessClient'

export default async function RequestAccessPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('branches')
    .select('id, name, is_revenue_generating')
    .eq('is_active', true)
    .order('name')

  const branches = (data as { id: string; name: string; is_revenue_generating: boolean }[] | null) ?? []

  return <RequestAccessClient branches={branches} />
}
