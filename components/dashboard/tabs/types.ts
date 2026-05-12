import type { Role } from '@/lib/supabase/database.types'
import type { DashboardData, Branch, FiscalMonth } from '../UnifiedDashboard'

export type TabProps = {
  role: Role
  data: DashboardData
  branches: Branch[]
  selectedBranchId: string
  allocationOn: boolean
  startDate: string
  endDate: string
  isMultiBranch: boolean
  monthSaturdays: string[]
  selectedMonth: FiscalMonth | undefined
}
