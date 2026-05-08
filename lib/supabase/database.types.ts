// Database types for the Safety Network dashboard schema.
// Regenerate after schema changes:
//   npx supabase gen types typescript --project-id zobgzhgwgduziszzevzp > lib/supabase/database.types.ts

export type Role = 'admin' | 'executive' | 'district_manager' | 'branch_manager'
export type LaborType =
  | 'direct'
  | 'admin_hourly'
  | 'admin_salary'
  | 'corp_hourly'
  | 'corp_salary'
  | 'hq_hourly'
  | 'hq_salary'
export type AllocationType = 'none' | 'corp' | 'hq'
export type Vendor = 'interstate' | 'flyers'
export type ImportStatus = 'pending' | 'confirmed' | 'replaced'
export type BusinessTag = 'western_highways' | 'signs'

export type Database = {
  public: {
    Tables: {
      businesses: {
        Row: { id: string; name: string; code: string; is_active: boolean; hq_allocation_pct: number }
        Insert: { id?: string; name: string; code: string; is_active?: boolean; hq_allocation_pct?: number }
        Update: { id?: string; name?: string; code?: string; is_active?: boolean; hq_allocation_pct?: number }
        Relationships: []
      }
      entities: {
        Row: { id: string; name: string; code: string }
        Insert: { id?: string; name: string; code: string }
        Update: { id?: string; name?: string; code?: string }
        Relationships: []
      }
      branches: {
        Row: { id: string; name: string; business_id: string; is_revenue_generating: boolean; is_corporate: boolean; is_active: boolean }
        Insert: { id?: string; name: string; business_id: string; is_revenue_generating?: boolean; is_corporate?: boolean; is_active?: boolean }
        Update: { id?: string; name?: string; business_id?: string; is_revenue_generating?: boolean; is_corporate?: boolean; is_active?: boolean }
        Relationships: []
      }
      payroll_item_groups: {
        Row: { id: string; name: string }
        Insert: { id?: string; name: string }
        Update: { id?: string; name?: string }
        Relationships: []
      }
      payroll_items: {
        Row: { id: string; name: string; group_id: string; is_confirmed: boolean; ai_suggested_group: string | null; ai_confidence: number | null }
        Insert: { id?: string; name: string; group_id: string; is_confirmed?: boolean; ai_suggested_group?: string | null; ai_confidence?: number | null }
        Update: { id?: string; name?: string; group_id?: string; is_confirmed?: boolean; ai_suggested_group?: string | null; ai_confidence?: number | null }
        Relationships: []
      }
      payroll_codes: {
        Row: { id: string; code: string; branch_id: string | null; entity_id: string; labor_type: LaborType; allocation_type: AllocationType; is_active: boolean }
        Insert: { id?: string; code: string; branch_id?: string | null; entity_id: string; labor_type: LaborType; allocation_type: AllocationType; is_active?: boolean }
        Update: { id?: string; code?: string; branch_id?: string | null; entity_id?: string; labor_type?: LaborType; allocation_type?: AllocationType; is_active?: boolean }
        Relationships: []
      }
      fiscal_months: {
        Row: { id: string; name: string; year: number; start_date: string; end_date: string; sort_order: number; is_active: boolean }
        Insert: { id?: string; name: string; year: number; start_date: string; end_date: string; sort_order?: number; is_active?: boolean }
        Update: { id?: string; name?: string; year?: number; start_date?: string; end_date?: string; sort_order?: number; is_active?: boolean }
        Relationships: []
      }
      revenue_codes: {
        Row: { id: string; code: string; branch_id: string; entity_id: string; is_active: boolean }
        Insert: { id?: string; code: string; branch_id: string; entity_id: string; is_active?: boolean }
        Update: { id?: string; code?: string; branch_id?: string; entity_id?: string; is_active?: boolean }
        Relationships: []
      }
      user_profiles: {
        Row: { id: string; role: Role; display_name: string; must_change_password: boolean }
        Insert: { id: string; role: Role; display_name?: string; must_change_password?: boolean }
        Update: { id?: string; role?: Role; display_name?: string; must_change_password?: boolean }
        Relationships: []
      }
      user_branch_assignments: {
        Row: { id: string; user_id: string; branch_id: string }
        Insert: { id?: string; user_id: string; branch_id: string }
        Update: { id?: string; user_id?: string; branch_id?: string }
        Relationships: []
      }
      employees: {
        Row: { id: string; first_name: string; last_name: string; is_active: boolean }
        Insert: { id?: string; first_name?: string; last_name?: string; is_active?: boolean }
        Update: { id?: string; first_name?: string; last_name?: string; is_active?: boolean }
        Relationships: []
      }
      employee_entity_assignments: {
        Row: { id: string; employee_id: string; entity_id: string; payroll_code_id: string | null; raw_name_in_report: string; is_confirmed: boolean; ai_match_score: number | null; ai_match_candidate: string | null; effective_from: string; effective_to: string | null; business_tag: BusinessTag | null }
        Insert: { id?: string; employee_id: string; entity_id: string; payroll_code_id?: string | null; raw_name_in_report: string; is_confirmed?: boolean; ai_match_score?: number | null; ai_match_candidate?: string | null; effective_from?: string; effective_to?: string | null; business_tag?: BusinessTag | null }
        Update: { id?: string; employee_id?: string; entity_id?: string; payroll_code_id?: string | null; raw_name_in_report?: string; is_confirmed?: boolean; ai_match_score?: number | null; ai_match_candidate?: string | null; effective_from?: string; effective_to?: string | null; business_tag?: BusinessTag | null }
        Relationships: []
      }
      employee_branch_transfers: {
        Row: { id: string; employee_id: string; from_payroll_code_id: string; to_payroll_code_id: string; effective_date: string; created_at: string; created_by: string | null; notes: string | null }
        Insert: { id?: string; employee_id: string; from_payroll_code_id: string; to_payroll_code_id: string; effective_date: string; created_at?: string; created_by?: string | null; notes?: string | null }
        Update: { id?: string; employee_id?: string; from_payroll_code_id?: string; to_payroll_code_id?: string; effective_date?: string; created_at?: string; created_by?: string | null; notes?: string | null }
        Relationships: []
      }
      fuel_card_assignments: {
        Row: { id: string; card_name: string; vendor: Vendor; employee_id: string | null; branch_id: string | null; business_tag: BusinessTag | null; is_confirmed: boolean }
        Insert: { id?: string; card_name: string; vendor: Vendor; employee_id?: string | null; branch_id?: string | null; business_tag?: BusinessTag | null; is_confirmed?: boolean }
        Update: { id?: string; card_name?: string; vendor?: Vendor; employee_id?: string | null; branch_id?: string | null; business_tag?: BusinessTag | null; is_confirmed?: boolean }
        Relationships: []
      }
      payroll_imports: {
        Row: { id: string; entity_id: string; period_date: string; imported_at: string; imported_by: string; status: ImportStatus }
        Insert: { id?: string; entity_id: string; period_date: string; imported_at?: string; imported_by: string; status?: ImportStatus }
        Update: { id?: string; entity_id?: string; period_date?: string; imported_at?: string; imported_by?: string; status?: ImportStatus }
        Relationships: []
      }
      revenue_imports: {
        Row: { id: string; period_date: string; imported_at: string; imported_by: string; status: ImportStatus }
        Insert: { id?: string; period_date: string; imported_at?: string; imported_by: string; status?: ImportStatus }
        Update: { id?: string; period_date?: string; imported_at?: string; imported_by?: string; status?: ImportStatus }
        Relationships: []
      }
      fuel_imports: {
        Row: { id: string; vendor: Vendor; date_range_start: string; date_range_end: string; imported_at: string; imported_by: string; status: ImportStatus }
        Insert: { id?: string; vendor: Vendor; date_range_start: string; date_range_end: string; imported_at?: string; imported_by: string; status?: ImportStatus }
        Update: { id?: string; vendor?: Vendor; date_range_start?: string; date_range_end?: string; imported_at?: string; imported_by?: string; status?: ImportStatus }
        Relationships: []
      }
      payroll_transactions: {
        Row: { id: string; import_id: string; employee_id: string; entity_id: string; payroll_code_id: string; period_date: string; payroll_item_id: string | null; hours: number | null; rate: number | null; amount: number }
        Insert: { id?: string; import_id: string; employee_id: string; entity_id: string; payroll_code_id: string; period_date: string; payroll_item_id?: string | null; hours?: number | null; rate?: number | null; amount: number }
        Update: { id?: string; import_id?: string; employee_id?: string; entity_id?: string; payroll_code_id?: string; period_date?: string; payroll_item_id?: string | null; hours?: number | null; rate?: number | null; amount?: number }
        Relationships: []
      }
      payroll_taxes: {
        Row: { id: string; import_id: string; employee_id: string; entity_id: string; period_date: string; amount: number }
        Insert: { id?: string; import_id: string; employee_id: string; entity_id: string; period_date: string; amount: number }
        Update: { id?: string; import_id?: string; employee_id?: string; entity_id?: string; period_date?: string; amount?: number }
        Relationships: []
      }
      revenue_transactions: {
        Row: { id: string; import_id: string; revenue_code_id: string | null; branch_id: string; entity_id: string; period_date: string; labor: number; rental: number; one_time_charges: number; sales_tax: number; total_revenue: number }
        Insert: { id?: string; import_id: string; revenue_code_id?: string | null; branch_id: string; entity_id: string; period_date: string; labor?: number; rental?: number; one_time_charges?: number; sales_tax?: number; total_revenue?: number }
        Update: { id?: string; import_id?: string; revenue_code_id?: string | null; branch_id?: string; entity_id?: string; period_date?: string; labor?: number; rental?: number; one_time_charges?: number; sales_tax?: number; total_revenue?: number }
        Relationships: []
      }
      fuel_transactions: {
        Row: { id: string; import_id: string; fuel_card_assignment_id: string | null; branch_id: string | null; employee_id: string | null; business_tag: BusinessTag | null; vendor: Vendor; transaction_date: string; transaction_time: string | null; site_name: string | null; site_city: string | null; site_state: string | null; product: string | null; gallons: number | null; price_per_gallon: number | null; total_pretax: number | null; tax: number | null; total_with_tax: number; mpg: number | null }
        Insert: { id?: string; import_id: string; fuel_card_assignment_id?: string | null; branch_id?: string | null; employee_id?: string | null; business_tag?: BusinessTag | null; vendor: Vendor; transaction_date: string; transaction_time?: string | null; site_name?: string | null; site_city?: string | null; site_state?: string | null; product?: string | null; gallons?: number | null; price_per_gallon?: number | null; total_pretax?: number | null; tax?: number | null; total_with_tax: number; mpg?: number | null }
        Update: { id?: string; import_id?: string; fuel_card_assignment_id?: string | null; branch_id?: string | null; employee_id?: string | null; business_tag?: BusinessTag | null; vendor?: Vendor; transaction_date?: string; transaction_time?: string | null; site_name?: string | null; site_city?: string | null; site_state?: string | null; product?: string | null; gallons?: number | null; price_per_gallon?: number | null; total_pretax?: number | null; tax?: number | null; total_with_tax?: number; mpg?: number | null }
        Relationships: []
      }
      fiscal_quarters: {
        Row: { id: string; name: string; quarter_number: number; year: number; is_active: boolean; created_at: string }
        Insert: { id?: string; name: string; quarter_number: number; year: number; is_active?: boolean; created_at?: string }
        Update: { id?: string; name?: string; quarter_number?: number; year?: number; is_active?: boolean }
        Relationships: []
      }
      fiscal_quarter_months: {
        Row: { id: string; fiscal_quarter_id: string; fiscal_month_id: string; sort_order: number }
        Insert: { id?: string; fiscal_quarter_id: string; fiscal_month_id: string; sort_order: number }
        Update: { id?: string; fiscal_quarter_id?: string; fiscal_month_id?: string; sort_order?: number }
        Relationships: []
      }
      branch_targets: {
        Row: { id: string; branch_id: string; fiscal_month_id: string; revenue_target: number | null; profit_pct_target: number | null; created_at: string; updated_by: string | null }
        Insert: { id?: string; branch_id: string; fiscal_month_id: string; revenue_target?: number | null; profit_pct_target?: number | null; created_at?: string; updated_by?: string | null }
        Update: { id?: string; branch_id?: string; fiscal_month_id?: string; revenue_target?: number | null; profit_pct_target?: number | null; updated_by?: string | null }
        Relationships: []
      }
      access_requests: {
        Row: { id: string; first_name: string; last_name: string; email: string; branch_id: string | null; requested_role: string; notes: string | null; status: string; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
        Insert: { id?: string; first_name: string; last_name: string; email: string; branch_id?: string | null; requested_role: string; notes?: string | null; status?: string; reviewed_by?: string | null; reviewed_at?: string | null; created_at?: string }
        Update: { id?: string; first_name?: string; last_name?: string; email?: string; branch_id?: string | null; requested_role?: string; notes?: string | null; status?: string; reviewed_by?: string | null; reviewed_at?: string | null }
        Relationships: []
      }
      payroll_staged_transactions: {
        Row: { id: string; assignment_id: string; import_id: string; entity_id: string; period_date: string; payroll_item_id: string | null; hours: number | null; rate: number | null; amount: number }
        Insert: { id?: string; assignment_id: string; import_id: string; entity_id: string; period_date: string; payroll_item_id?: string | null; hours?: number | null; rate?: number | null; amount: number }
        Update: { id?: string; assignment_id?: string; import_id?: string; entity_id?: string; period_date?: string; payroll_item_id?: string | null; hours?: number | null; rate?: number | null; amount?: number }
        Relationships: []
      }
      payroll_staged_taxes: {
        Row: { id: string; assignment_id: string; import_id: string; entity_id: string; period_date: string; amount: number }
        Insert: { id?: string; assignment_id: string; import_id: string; entity_id: string; period_date: string; amount: number }
        Update: { id?: string; assignment_id?: string; import_id?: string; entity_id?: string; period_date?: string; amount?: number }
        Relationships: []
      }
      payroll_item_staged_transactions: {
        Row: { id: string; payroll_item_id: string; import_id: string; employee_id: string; entity_id: string; payroll_code_id: string; period_date: string; hours: number | null; rate: number | null; amount: number }
        Insert: { id?: string; payroll_item_id: string; import_id: string; employee_id: string; entity_id: string; payroll_code_id: string; period_date: string; hours?: number | null; rate?: number | null; amount: number }
        Update: { id?: string; payroll_item_id?: string; import_id?: string; employee_id?: string; entity_id?: string; payroll_code_id?: string; period_date?: string; hours?: number | null; rate?: number | null; amount?: number }
        Relationships: []
      }
      employee_allocations: {
        Row: { id: string; employee_id: string; branch_id: string; percentage: number; effective_from: string; effective_to: string | null; status: string; requested_by: string | null; approved_by: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; employee_id: string; branch_id: string; percentage: number; effective_from: string; effective_to?: string | null; status?: string; requested_by?: string | null; approved_by?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; employee_id?: string; branch_id?: string; percentage?: number; effective_from?: string; effective_to?: string | null; status?: string; requested_by?: string | null; approved_by?: string | null; notes?: string | null }
        Relationships: []
      }
      employee_allocation_overrides: {
        Row: { id: string; employee_id: string; period_date: string; branch_id: string; percentage: number; status: string; requested_by: string | null; approved_by: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; employee_id: string; period_date: string; branch_id: string; percentage: number; status?: string; requested_by?: string | null; approved_by?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; employee_id?: string; period_date?: string; branch_id?: string; percentage?: number; status?: string; requested_by?: string | null; approved_by?: string | null; notes?: string | null }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
