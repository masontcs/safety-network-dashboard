// Database types for the Safety Network dashboard schema.
// Regenerate after schema changes:
//   npx supabase gen types typescript --project-id zobgzhgwgduziszzevzp > lib/supabase/database.types.ts

// 'tech' is a FIELD role for the tech app only. It is deliberately NOT a dashboard role:
// see DASHBOARD_ROLES in lib/api/auth.ts — techs are rejected by every dashboard/billing
// API, and /api/tech/* requires it. Never add 'tech' to a dashboard role list.
export type Role = 'admin' | 'executive' | 'district_manager' | 'branch_manager' | 'ar_manager' | 'ar_team' | 'office_team' | 'project_manager' | 'sales' | 'tech'
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

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// ── TCR Billing enums (mirror the Postgres enum types) ────────────────────────
// Money in every billing_* table is INTEGER CENTS. Dates are 'YYYY-MM-DD'.

/**
 * What an item IS. The category picks its price-list tier — except 'Sale', which
 * needs none: a sale is priced by the item's own sale_price_cents and never appears on
 * a price list. Selling a rentable item does NOT make it 'Sale'; that's a sale LINE.
 */
export type BillingItemCategory = 'Equipment' | 'Labor' | 'Lump Sum' | 'Misc' | 'Sale'

/** One rate per rental cadence. No proration: each cell is an entered rate. */
export type BillingType =
  | 'daily'
  | 'weekly'
  | 'monthly'

/**
 * How a price-list cell is keyed. The Postgres `billing_type` enum also carries 'flat':
 * a rate with NO cadence, which is what CHARGE items (Labor / Lump Sum / Misc) price —
 * a "1 Man Crew" has an hourly rate, not a rental cadence.
 *
 * 'flat' is kept OUT of BillingType so the rental engine can never see it.
 */
export type RateKey = BillingType | 'flat'

export type BillingJobStatus = 'new' | 'in_progress' | 'on_hold' | 'completed' | 'closed'
export type BillingTicketStatus = 'active' | 'in_review' | 'final_edit' | 'invoiced'
export type BillingLedgerEvent = 'pickup' | 'return' | 'lost'
export type BillingLineKind = 'sale' | 'lost' | 'labor' | 'lump_sum' | 'misc'
export type BillingInvoiceLineKind = 'rental' | BillingLineKind | 'adjustment'
export type BillingInvoiceStatus = 'draft' | 'issued' | 'void'
export type BillingQueueStatus = 'needs_update' | 'updated'
export type BillingQuoteStatus = 'draft' | 'sent' | 'won' | 'lost'

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
        Row: { id: string; role: Role; display_name: string; must_change_password: boolean; is_active: boolean; username: string | null }
        Insert: { id: string; role: Role; display_name?: string; must_change_password?: boolean; is_active?: boolean; username?: string | null }
        Update: { id?: string; role?: Role; display_name?: string; must_change_password?: boolean; is_active?: boolean; username?: string | null }
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
        Row: { id: string; import_id: string; employee_id: string; entity_id: string; payroll_code_id: string | null; period_date: string; payroll_item_id: string | null; hours: number | null; rate: number | null; amount: number; business_tag: BusinessTag | null }
        Insert: { id?: string; import_id: string; employee_id: string; entity_id: string; payroll_code_id?: string | null; period_date: string; payroll_item_id?: string | null; hours?: number | null; rate?: number | null; amount: number; business_tag?: BusinessTag | null }
        Update: { id?: string; import_id?: string; employee_id?: string; entity_id?: string; payroll_code_id?: string | null; period_date?: string; payroll_item_id?: string | null; hours?: number | null; rate?: number | null; amount?: number; business_tag?: BusinessTag | null }
        Relationships: []
      }
      payroll_taxes: {
        Row: { id: string; import_id: string; employee_id: string; entity_id: string; period_date: string; amount: number; business_tag: BusinessTag | null }
        Insert: { id?: string; import_id: string; employee_id: string; entity_id: string; period_date: string; amount: number; business_tag?: BusinessTag | null }
        Update: { id?: string; import_id?: string; employee_id?: string; entity_id?: string; period_date?: string; amount?: number; business_tag?: BusinessTag | null }
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
        Row: { id: string; first_name: string; last_name: string; email: string; username: string | null; branch_id: string | null; requested_role: string; notes: string | null; status: string; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
        Insert: { id?: string; first_name: string; last_name: string; email: string; username?: string | null; branch_id?: string | null; requested_role: string; notes?: string | null; status?: string; reviewed_by?: string | null; reviewed_at?: string | null; created_at?: string }
        Update: { id?: string; first_name?: string; last_name?: string; email?: string; username?: string | null; branch_id?: string | null; requested_role?: string; notes?: string | null; status?: string; reviewed_by?: string | null; reviewed_at?: string | null }
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
      ar_customers: {
        Row: { id: string; display_name: string; notes: string | null; created_at: string; is_excluded: boolean; customer_status: string; collection_status: string; collection_phase: string; contact_frequency: string | null }
        Insert: { id?: string; display_name: string; notes?: string | null; created_at?: string; is_excluded?: boolean; customer_status?: string; collection_status?: string; collection_phase?: string; contact_frequency?: string | null }
        Update: { id?: string; display_name?: string; notes?: string | null; is_excluded?: boolean; customer_status?: string; collection_status?: string; collection_phase?: string; contact_frequency?: string | null }
        Relationships: []
      }
      ar_customer_contacts: {
        Row: { id: string; customer_id: string; name: string; title: string | null; email: string | null; phone: string | null; is_primary: boolean; created_at: string }
        Insert: { id?: string; customer_id: string; name: string; title?: string | null; email?: string | null; phone?: string | null; is_primary?: boolean; created_at?: string }
        Update: { id?: string; customer_id?: string; name?: string; title?: string | null; email?: string | null; phone?: string | null; is_primary?: boolean }
        Relationships: []
      }
      ar_customer_notes: {
        Row: { id: string; customer_id: string; content: string; created_by: string | null; created_at: string; note_type: string; communication_type: string | null; contact_name: string | null; outcome: string | null; is_pinned: boolean }
        Insert: { id?: string; customer_id: string; content: string; created_by?: string | null; created_at?: string; note_type?: string; communication_type?: string | null; contact_name?: string | null; outcome?: string | null; is_pinned?: boolean }
        Update: { id?: string; customer_id?: string; content?: string; created_by?: string | null; note_type?: string; communication_type?: string | null; contact_name?: string | null; outcome?: string | null; is_pinned?: boolean }
        Relationships: []
      }
      ar_invoice_notes: {
        Row: { id: string; invoice_id: string; content: string; created_by: string | null; created_at: string }
        Insert: { id?: string; invoice_id: string; content: string; created_by?: string | null; created_at?: string }
        Update: { id?: string; invoice_id?: string; content?: string; created_by?: string | null }
        Relationships: []
      }
      ar_customer_pm_assignments: {
        Row: { id: string; customer_id: string; user_id: string; created_at: string }
        Insert: { id?: string; customer_id: string; user_id: string; created_at?: string }
        Update: { id?: string; customer_id?: string; user_id?: string }
        Relationships: []
      }
      ar_customer_assignments: {
        Row: { id: string; customer_id: string; user_id: string; assigned_by: string | null; assigned_at: string }
        Insert: { id?: string; customer_id: string; user_id: string; assigned_by?: string | null; assigned_at?: string }
        Update: { id?: string; customer_id?: string; user_id?: string; assigned_by?: string | null }
        Relationships: []
      }
      ar_customer_entity_refs: {
        Row: { id: string; customer_id: string; entity_code: string; quickbooks_name: string }
        Insert: { id?: string; customer_id: string; entity_code: string; quickbooks_name: string }
        Update: { id?: string; customer_id?: string; entity_code?: string; quickbooks_name?: string }
        Relationships: []
      }
      ar_imports: {
        Row: { id: string; entity_code: string; report_date: string; imported_at: string; imported_by: string | null; total_ar: number | null; invoice_count: number | null }
        Insert: { id?: string; entity_code: string; report_date: string; imported_at?: string; imported_by?: string | null; total_ar?: number | null; invoice_count?: number | null }
        Update: { id?: string; entity_code?: string; report_date?: string; imported_at?: string; imported_by?: string | null; total_ar?: number | null; invoice_count?: number | null }
        Relationships: []
      }
      ar_class_codes: {
        Row: { code: string; branch_id: string | null; entity_code: string | null }
        Insert: { code: string; branch_id?: string | null; entity_code?: string | null }
        Update: { code?: string; branch_id?: string | null; entity_code?: string | null }
        Relationships: []
      }
      ar_invoices: {
        Row: { id: string; import_id: string; customer_id: string; entity_code: string; branch_id: string | null; raw_class_code: string | null; invoice_number: string | null; po_number: string | null; job_name: string | null; invoice_date: string | null; due_date: string | null; terms: string | null; open_balance: number; aging_bucket: string | null; aging_days: number | null; row_type: string; invoice_status: string | null; created_at: string }
        Insert: { id?: string; import_id: string; customer_id: string; entity_code: string; branch_id?: string | null; raw_class_code?: string | null; invoice_number?: string | null; po_number?: string | null; job_name?: string | null; invoice_date?: string | null; due_date?: string | null; terms?: string | null; open_balance: number; aging_bucket?: string | null; aging_days?: number | null; row_type?: string; invoice_status?: string | null; created_at?: string }
        Update: { id?: string; import_id?: string; customer_id?: string; entity_code?: string; branch_id?: string | null; raw_class_code?: string | null; invoice_number?: string | null; po_number?: string | null; job_name?: string | null; invoice_date?: string | null; due_date?: string | null; terms?: string | null; open_balance?: number; aging_bucket?: string | null; aging_days?: number | null; row_type?: string; invoice_status?: string | null }
        Relationships: []
      }

      // ── TCR Billing v2 ────────────────────────────────────────────────────
      billing_entity_settings: {
        Row: { entity_id: string; letter: string; billing_enabled: boolean }
        Insert: { entity_id: string; letter: string; billing_enabled?: boolean }
        Update: { entity_id?: string; letter?: string; billing_enabled?: boolean }
        Relationships: []
      }
      billing_branch_settings: {
        Row: { branch_id: string; code: string; tax_rate_pct: number | null; billing_enabled: boolean }
        Insert: { branch_id: string; code: string; tax_rate_pct?: number | null; billing_enabled?: boolean }
        Update: { branch_id?: string; code?: string; tax_rate_pct?: number | null; billing_enabled?: boolean }
        Relationships: []
      }
      billing_payment_terms: {
        Row: { id: string; name: string; net_days: number; sort_order: number; is_active: boolean }
        Insert: { id?: string; name: string; net_days?: number; sort_order?: number; is_active?: boolean }
        Update: { id?: string; name?: string; net_days?: number; sort_order?: number; is_active?: boolean }
        Relationships: []
      }
      billing_customers: {
        Row: { id: string; code: string; name: string; ar_customer_id: string | null; default_payment_term_id: string | null; is_active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; code: string; name: string; ar_customer_id?: string | null; default_payment_term_id?: string | null; is_active?: boolean }
        Update: { id?: string; code?: string; name?: string; ar_customer_id?: string | null; default_payment_term_id?: string | null; is_active?: boolean }
        Relationships: []
      }
      billing_profiles: {
        Row: { id: string; customer_id: string; branch_id: string; code: string; name: string; payment_term_id: string | null; rental_minimum_enabled: boolean; rental_minimum_cents: number; field_rules: Json; portal_enabled: boolean; is_active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; customer_id: string; branch_id: string; code: string; name: string; payment_term_id?: string | null; rental_minimum_enabled?: boolean; rental_minimum_cents?: number; field_rules?: Json; portal_enabled?: boolean; is_active?: boolean }
        Update: { id?: string; customer_id?: string; branch_id?: string; code?: string; name?: string; payment_term_id?: string | null; rental_minimum_enabled?: boolean; rental_minimum_cents?: number; field_rules?: Json; portal_enabled?: boolean; is_active?: boolean }
        Relationships: []
      }
      billing_portal_accounts: {
        Row: { id: string; customer_id: string; auth_user_id: string | null; email: string; name: string | null; role: 'owner' | 'member'; is_active: boolean; invited_by: string | null; last_login_at: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; customer_id: string; auth_user_id?: string | null; email: string; name?: string | null; role?: 'owner' | 'member'; is_active?: boolean; invited_by?: string | null; last_login_at?: string | null }
        Update: { id?: string; customer_id?: string; auth_user_id?: string | null; email?: string; name?: string | null; role?: 'owner' | 'member'; is_active?: boolean; invited_by?: string | null; last_login_at?: string | null; updated_at?: string }
        Relationships: []
      }
      billing_profile_contacts: {
        Row: { id: string; profile_id: string; name: string; email: string | null; phone: string | null; is_invoice_recipient: boolean; created_at: string }
        Insert: { id?: string; profile_id: string; name: string; email?: string | null; phone?: string | null; is_invoice_recipient?: boolean }
        Update: { id?: string; profile_id?: string; name?: string; email?: string | null; phone?: string | null; is_invoice_recipient?: boolean }
        Relationships: []
      }
      billing_items: {
        Row: { id: string; code: string; name: string; category: BillingItemCategory; cost_cents: number; rentable: boolean; salable: boolean; sale_price_cents: number | null; taxable: boolean; tracked: boolean; is_active: boolean; owner_profile_id: string | null; own_rate_cents: number | null; created_at: string; updated_at: string }
        Insert: { id?: string; code: string; name: string; category: BillingItemCategory; cost_cents?: number; rentable?: boolean; salable?: boolean; sale_price_cents?: number | null; taxable?: boolean; tracked?: boolean; is_active?: boolean; owner_profile_id?: string | null; own_rate_cents?: number | null }
        Update: { id?: string; code?: string; name?: string; category?: BillingItemCategory; cost_cents?: number; rentable?: boolean; salable?: boolean; sale_price_cents?: number | null; taxable?: boolean; tracked?: boolean; is_active?: boolean; owner_profile_id?: string | null; own_rate_cents?: number | null }
        Relationships: []
      }
      billing_item_default_rates: {
        Row: { item_id: string; billing_type: RateKey; rate_cents: number }
        Insert: { item_id: string; billing_type: RateKey; rate_cents: number }
        Update: { item_id?: string; billing_type?: RateKey; rate_cents?: number }
        Relationships: []
      }
      billing_item_variations: {
        Row: { id: string; item_id: string; name: string; cost_adj_cents: number; sale_adj_cents: number; sort_order: number; own_rate_cents: number | null }
        Insert: { id?: string; item_id: string; name: string; cost_adj_cents?: number; sale_adj_cents?: number; sort_order?: number; own_rate_cents?: number | null }
        Update: { id?: string; item_id?: string; name?: string; cost_adj_cents?: number; sale_adj_cents?: number; sort_order?: number; own_rate_cents?: number | null }
        Relationships: []
      }
      billing_price_lists: {
        Row: { id: string; name: string; entity_id: string; is_active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; name: string; entity_id: string; is_active?: boolean }
        Update: { id?: string; name?: string; entity_id?: string; is_active?: boolean }
        Relationships: []
      }
      billing_price_list_tiers: {
        Row: { id: string; price_list_id: string; position: number; name: string; pct_off_previous: number }
        Insert: { id?: string; price_list_id: string; position: number; name: string; pct_off_previous?: number }
        Update: { id?: string; price_list_id?: string; position?: number; name?: string; pct_off_previous?: number }
        Relationships: []
      }
      billing_price_list_items: {
        Row: { id: string; price_list_id: string; item_id: string; freeze_after_position: number | null; tier_exception_tier_id: string | null; single_rate: boolean }
        Insert: { id?: string; price_list_id: string; item_id: string; freeze_after_position?: number | null; tier_exception_tier_id?: string | null; single_rate?: boolean }
        Update: { id?: string; price_list_id?: string; item_id?: string; freeze_after_position?: number | null; tier_exception_tier_id?: string | null; single_rate?: boolean }
        Relationships: []
      }
      billing_price_list_item_bases: {
        Row: { price_list_item_id: string; variation_id: string | null; billing_type: RateKey; base_cents: number }
        Insert: { price_list_item_id: string; variation_id?: string | null; billing_type: RateKey; base_cents: number }
        Update: { price_list_item_id?: string; variation_id?: string | null; billing_type?: RateKey; base_cents?: number }
        Relationships: []
      }
      billing_price_list_item_overrides: {
        Row: { price_list_item_id: string; variation_id: string | null; tier_id: string; billing_type: RateKey; rate_cents: number }
        Insert: { price_list_item_id: string; variation_id?: string | null; tier_id: string; billing_type: RateKey; rate_cents: number }
        Update: { price_list_item_id?: string; variation_id?: string | null; tier_id?: string; billing_type?: RateKey; rate_cents?: number }
        Relationships: []
      }
      /** The COMPILED explicit grid. Pricing reads this. */
      billing_price_list_rates: {
        Row: { price_list_item_id: string; variation_id: string | null; tier_id: string; billing_type: RateKey; rate_cents: number; compiled_at: string }
        Insert: { price_list_item_id: string; variation_id?: string | null; tier_id: string; billing_type: RateKey; rate_cents: number; compiled_at?: string }
        Update: { price_list_item_id?: string; variation_id?: string | null; tier_id?: string; billing_type?: RateKey; rate_cents?: number; compiled_at?: string }
        Relationships: []
      }
      billing_profile_entities: {
        Row: { id: string; profile_id: string; entity_id: string; enabled: boolean; price_list_id: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; profile_id: string; entity_id: string; enabled?: boolean; price_list_id?: string | null }
        Update: { id?: string; profile_id?: string; entity_id?: string; enabled?: boolean; price_list_id?: string | null }
        Relationships: []
      }
      billing_profile_entity_category_tiers: {
        Row: { profile_entity_id: string; category: BillingItemCategory; price_list_id: string; tier_id: string }
        Insert: { profile_entity_id: string; category: BillingItemCategory; price_list_id: string; tier_id: string }
        Update: { profile_entity_id?: string; category?: BillingItemCategory; price_list_id?: string; tier_id?: string }
        Relationships: []
      }
      billing_counters: {
        Row: { kind: string; entity_id: string; branch_id: string | null; next_seq: number }
        Insert: { kind: string; entity_id: string; branch_id?: string | null; next_seq?: number }
        Update: { kind?: string; entity_id?: string; branch_id?: string | null; next_seq?: number }
        Relationships: []
      }
      billing_jobs: {
        Row: { id: string; job_number: string; profile_id: string; entity_id: string; branch_id: string; name: string | null; status: BillingJobStatus; certified: boolean; prevailing_wage: boolean; shift_schedule: string | null; dir_number: string | null; cert_payroll_contact: string | null; contract_number: string | null; pay_classification: string | null; address: string | null; cross_streets: string | null; city: string | null; county: string | null; state: string | null; zip: string | null; tax_exempt: boolean; require_signature: boolean; enable_second_signature: boolean; ticket_labor_minimum_minutes: number | null; po_number: string | null; notes: string | null; date_opened: string; date_completed: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; job_number: string; profile_id: string; entity_id: string; branch_id: string; name?: string | null; status?: BillingJobStatus; certified: boolean; prevailing_wage?: boolean; shift_schedule?: string | null; dir_number?: string | null; cert_payroll_contact?: string | null; contract_number?: string | null; pay_classification?: string | null; address?: string | null; cross_streets?: string | null; city?: string | null; county?: string | null; state?: string | null; zip?: string | null; tax_exempt?: boolean; require_signature?: boolean; enable_second_signature?: boolean; ticket_labor_minimum_minutes?: number | null; po_number?: string | null; notes?: string | null; date_opened?: string; date_completed?: string | null }
        Update: { id?: string; job_number?: string; profile_id?: string; entity_id?: string; branch_id?: string; name?: string | null; status?: BillingJobStatus; certified?: boolean; prevailing_wage?: boolean; shift_schedule?: string | null; dir_number?: string | null; cert_payroll_contact?: string | null; contract_number?: string | null; pay_classification?: string | null; address?: string | null; cross_streets?: string | null; city?: string | null; county?: string | null; state?: string | null; zip?: string | null; tax_exempt?: boolean; require_signature?: boolean; enable_second_signature?: boolean; ticket_labor_minimum_minutes?: number | null; po_number?: string | null; notes?: string | null; date_opened?: string; date_completed?: string | null }
        Relationships: []
      }
      billing_tickets: {
        Row: { id: string; ticket_number: string; job_id: string; entity_id: string; ticket_date: string; status: BillingTicketStatus; feature_add: boolean; feature_return: boolean; feature_dtc: boolean; billing_type: BillingType | null; recurring: boolean; final_edited_at: string | null; notes: string | null; is_voided: boolean; voided_at: string | null; voided_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; ticket_number: string; job_id: string; entity_id: string; ticket_date: string; status?: BillingTicketStatus; feature_add?: boolean; feature_return?: boolean; feature_dtc?: boolean; billing_type?: BillingType | null; recurring?: boolean; final_edited_at?: string | null; notes?: string | null; is_voided?: boolean; voided_at?: string | null; voided_by?: string | null }
        Update: { id?: string; ticket_number?: string; job_id?: string; entity_id?: string; ticket_date?: string; status?: BillingTicketStatus; feature_add?: boolean; feature_return?: boolean; feature_dtc?: boolean; billing_type?: BillingType | null; recurring?: boolean; final_edited_at?: string | null; notes?: string | null; is_voided?: boolean; voided_at?: string | null; voided_by?: string | null }
        Relationships: []
      }
      billing_ticket_ledger: {
        Row: { id: string; ticket_id: string; job_id: string; item_id: string; variation_id: string | null; event_type: BillingLedgerEvent; event_date: string; qty: number; equipment_id: string | null; billing_type: BillingType | null; created_at: string }
        Insert: { id?: string; ticket_id: string; job_id: string; item_id: string; variation_id?: string | null; event_type: BillingLedgerEvent; event_date: string; qty: number; equipment_id?: string | null; billing_type?: BillingType | null }
        Update: { id?: string; ticket_id?: string; job_id?: string; item_id?: string; variation_id?: string | null; event_type?: BillingLedgerEvent; event_date?: string; qty?: number; equipment_id?: string | null; billing_type?: BillingType | null }
        Relationships: []
      }
      billing_ticket_photos: {
        Row: { id: string; ticket_id: string; storage_path: string; file_name: string; content_type: string | null; size_bytes: number | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; ticket_id: string; storage_path: string; file_name: string; content_type?: string | null; size_bytes?: number | null; uploaded_by?: string | null }
        Update: { id?: string; ticket_id?: string; storage_path?: string; file_name?: string; content_type?: string | null; size_bytes?: number | null; uploaded_by?: string | null }
        Relationships: []
      }
      billing_activity_types: {
        // note_keyword = lowercase token in the TSheets note; service_item = QB export string.
        // exported/paid/billable/pw_eligible drive the export + payroll classification.
        Row: { id: string; name: string; sort_order: number; is_active: boolean; note_keyword: string | null; service_item: string | null; exported: boolean; paid: boolean; billable: boolean; pw_eligible: boolean; created_at: string }
        Insert: { id?: string; name: string; sort_order?: number; is_active?: boolean; note_keyword?: string | null; service_item?: string | null; exported?: boolean; paid?: boolean; billable?: boolean; pw_eligible?: boolean }
        Update: { id?: string; name?: string; sort_order?: number; is_active?: boolean; note_keyword?: string | null; service_item?: string | null; exported?: boolean; paid?: boolean; billable?: boolean; pw_eligible?: boolean }
        Relationships: []
      }
      billing_technicians: {
        Row: { id: string; name: string; is_active: boolean; user_id: string | null; created_at: string }
        Insert: { id?: string; name: string; is_active?: boolean; user_id?: string | null }
        Update: { id?: string; name?: string; is_active?: boolean; user_id?: string | null }
        Relationships: []
      }
      billing_ticket_assignments: {
        Row: { id: string; ticket_id: string; technician_id: string; is_lead: boolean; created_at: string }
        Insert: { id?: string; ticket_id: string; technician_id: string; is_lead?: boolean }
        Update: { id?: string; ticket_id?: string; technician_id?: string; is_lead?: boolean }
        Relationships: []
      }
      billing_ticket_labor: {
        // work_date: the entry's own date (overnight). Null = falls on the ticket's date.
        Row: { id: string; ticket_id: string; technician_id: string; activity_type_id: string; start_time: string; end_time: string; work_date: string | null; notes: string | null; entered_by: string | null; created_at: string }
        Insert: { id?: string; ticket_id: string; technician_id: string; activity_type_id: string; start_time: string; end_time: string; work_date?: string | null; notes?: string | null; entered_by?: string | null }
        Update: { id?: string; ticket_id?: string; technician_id?: string; activity_type_id?: string; start_time?: string; end_time?: string; work_date?: string | null; notes?: string | null; entered_by?: string | null }
        Relationships: []
      }
      /** A tech dispatched to the yard (no ticket). Yard time logs against it, excluded from billing. */
      billing_yard_shifts: {
        Row: { id: string; technician_id: string; branch_id: string | null; shift_date: string; created_at: string }
        Insert: { id?: string; technician_id: string; branch_id?: string | null; shift_date: string }
        Update: { id?: string; technician_id?: string; branch_id?: string | null; shift_date?: string }
        Relationships: []
      }
      billing_yard_time: {
        Row: { id: string; yard_shift_id: string; technician_id: string; activity_type_id: string; start_time: string; end_time: string; work_date: string | null; notes: string | null; entered_by: string | null; created_at: string }
        Insert: { id?: string; yard_shift_id: string; technician_id: string; activity_type_id: string; start_time: string; end_time: string; work_date?: string | null; notes?: string | null; entered_by?: string | null }
        Update: { id?: string; yard_shift_id?: string; technician_id?: string; activity_type_id?: string; start_time?: string; end_time?: string; work_date?: string | null; notes?: string | null; entered_by?: string | null }
        Relationships: []
      }
      /** Ongoing-rental accruals, keyed by PICKUP LOT (lot_date). Cumulative qty-units billed. */
      billing_rental_accruals: {
        Row: { id: string; ticket_id: string; item_id: string; variation_id: string | null; lot_date: string; qty_units_billed: number; updated_at: string }
        Insert: { id?: string; ticket_id: string; item_id: string; variation_id?: string | null; lot_date: string; qty_units_billed?: number }
        Update: { id?: string; ticket_id?: string; item_id?: string; variation_id?: string | null; lot_date?: string; qty_units_billed?: number }
        Relationships: []
      }
      billing_ticket_lines: {
        // unit_rate_cents / amount_cents are NULL for item-priced kinds (labor, lump sum):
        // their rate comes from the price list at invoice time, not from the ticket.
        Row: { id: string; ticket_id: string; kind: BillingLineKind; item_id: string | null; variation_id: string | null; description: string; qty: number; units: number; unit_rate_cents: number | null; amount_cents: number | null; taxable: boolean; created_at: string }
        Insert: { id?: string; ticket_id: string; kind: BillingLineKind; item_id?: string | null; variation_id?: string | null; description: string; qty?: number; units?: number; unit_rate_cents?: number | null; amount_cents?: number | null; taxable?: boolean }
        Update: { id?: string; ticket_id?: string; kind?: BillingLineKind; item_id?: string | null; variation_id?: string | null; description?: string; qty?: number; units?: number; unit_rate_cents?: number | null; amount_cents?: number | null; taxable?: boolean }
        Relationships: []
      }
      billing_invoices: {
        Row: { id: string; invoice_number: string; job_id: string; profile_id: string; entity_id: string; branch_id: string; through_date: string; invoice_date: string; status: BillingInvoiceStatus; tax_rate_pct: number; rental_subtotal_cents: number; sales_subtotal_cents: number; other_subtotal_cents: number; rental_minimum_adjustment_cents: number; subtotal_cents: number; taxable_base_cents: number; tax_cents: number; total_cents: number; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; invoice_number: string; job_id: string; profile_id: string; entity_id: string; branch_id: string; through_date: string; invoice_date?: string; status?: BillingInvoiceStatus; tax_rate_pct?: number; rental_subtotal_cents?: number; sales_subtotal_cents?: number; other_subtotal_cents?: number; rental_minimum_adjustment_cents?: number; subtotal_cents?: number; taxable_base_cents?: number; tax_cents?: number; total_cents?: number; created_by?: string | null }
        Update: { id?: string; invoice_number?: string; invoice_date?: string; through_date?: string; status?: BillingInvoiceStatus; tax_rate_pct?: number; rental_subtotal_cents?: number; sales_subtotal_cents?: number; other_subtotal_cents?: number; rental_minimum_adjustment_cents?: number; subtotal_cents?: number; taxable_base_cents?: number; tax_cents?: number; total_cents?: number }
        Relationships: []
      }
      billing_invoice_lines: {
        Row: { id: string; invoice_id: string; ticket_id: string | null; kind: BillingInvoiceLineKind; item_id: string | null; variation_id: string | null; description: string; lot_date: string | null; qty: number; units: number; unit_rate_cents: number; amount_cents: number; taxable: boolean; created_at: string }
        Insert: { id?: string; invoice_id: string; ticket_id?: string | null; kind: BillingInvoiceLineKind; item_id?: string | null; variation_id?: string | null; description: string; lot_date?: string | null; qty?: number; units?: number; unit_rate_cents: number; amount_cents: number; taxable?: boolean }
        Update: { id?: string; invoice_id?: string; ticket_id?: string | null; kind?: BillingInvoiceLineKind; item_id?: string | null; variation_id?: string | null; description?: string; lot_date?: string | null; qty?: number; units?: number; unit_rate_cents?: number; amount_cents?: number; taxable?: boolean }
        Relationships: []
      }
      billing_quotes: {
        Row: { id: string; quote_number: string; profile_id: string; entity_id: string; branch_id: string; status: BillingQuoteStatus; quote_date: string; job_name: string | null; notes: string | null; tax_rate_pct: number; subtotal_cents: number; tax_cents: number; total_cents: number; converted_job_id: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; quote_number: string; profile_id: string; entity_id: string; branch_id: string; status?: BillingQuoteStatus; quote_date?: string; job_name?: string | null; notes?: string | null; tax_rate_pct?: number; subtotal_cents?: number; tax_cents?: number; total_cents?: number; converted_job_id?: string | null; created_by?: string | null }
        Update: { id?: string; quote_number?: string; profile_id?: string; entity_id?: string; branch_id?: string; status?: BillingQuoteStatus; quote_date?: string; job_name?: string | null; notes?: string | null; tax_rate_pct?: number; subtotal_cents?: number; tax_cents?: number; total_cents?: number; converted_job_id?: string | null; updated_at?: string }
        Relationships: []
      }
      billing_quote_lines: {
        Row: { id: string; quote_id: string; kind: string; item_id: string | null; variation_id: string | null; description: string; billing_type: BillingType | null; qty: number; units: number; unit_rate_cents: number; amount_cents: number; taxable: boolean; sort_order: number; created_at: string }
        Insert: { id?: string; quote_id: string; kind?: string; item_id?: string | null; variation_id?: string | null; description?: string; billing_type?: BillingType | null; qty?: number; units?: number; unit_rate_cents?: number; amount_cents?: number; taxable?: boolean; sort_order?: number }
        Update: { id?: string; quote_id?: string; kind?: string; item_id?: string | null; variation_id?: string | null; description?: string; billing_type?: BillingType | null; qty?: number; units?: number; unit_rate_cents?: number; amount_cents?: number; taxable?: boolean; sort_order?: number }
        Relationships: []
      }
      billing_accounting_queue: {
        Row: { id: string; invoice_id: string; reason: string; status: BillingQueueStatus; waived: boolean; notes: string | null; created_by: string | null; created_at: string; resolved_by: string | null; resolved_at: string | null }
        Insert: { id?: string; invoice_id: string; reason: string; status?: BillingQueueStatus; waived?: boolean; notes?: string | null; created_by?: string | null }
        Update: { id?: string; invoice_id?: string; reason?: string; status?: BillingQueueStatus; waived?: boolean; notes?: string | null; resolved_by?: string | null; resolved_at?: string | null }
        Relationships: []
      }
      /** Per-tech, per-day per-diem flag. Rolls into a weekly payout list; not on the export. */
      billing_per_diem: {
        Row: { id: string; technician_id: string; work_date: string; branch_id: string | null; status: 'pending' | 'paid'; pre_approved_by: string | null; paid_at: string | null; created_at: string }
        Insert: { id?: string; technician_id: string; work_date: string; branch_id?: string | null; status?: 'pending' | 'paid'; pre_approved_by?: string | null; paid_at?: string | null }
        Update: { id?: string; technician_id?: string; work_date?: string; branch_id?: string | null; status?: 'pending' | 'paid'; pre_approved_by?: string | null; paid_at?: string | null }
        Relationships: []
      }
      /** Time-approval batch: one per (technician, branch, day). Parallel to the ticket's billing status. */
      billing_time_approvals: {
        Row: { id: string; technician_id: string; branch_id: string; work_date: string; status: 'submitted' | 'returned' | 'approved'; note: string | null; approved_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; technician_id: string; branch_id: string; work_date: string; status?: 'submitted' | 'returned' | 'approved'; note?: string | null; approved_by?: string | null; updated_at?: string }
        Update: { id?: string; technician_id?: string; branch_id?: string; work_date?: string; status?: 'submitted' | 'returned' | 'approved'; note?: string | null; approved_by?: string | null; updated_at?: string }
        Relationships: []
      }
      /** Who may approve times, scoped per branch. Governs ALL users, admins included. */
      billing_time_approvers: {
        Row: { id: string; user_id: string; branch_id: string; created_at: string }
        Insert: { id?: string; user_id: string; branch_id: string }
        Update: { id?: string; user_id?: string; branch_id?: string }
        Relationships: []
      }
      /** The dispatch unit. Staged = draft; Published creates the ticket + crew and notifies techs. job_id null = yard. */
      billing_shifts: {
        Row: { id: string; job_id: string | null; branch_id: string; shift_date: string; status: 'staged' | 'published'; meal_type: 'standard' | 'odmp'; per_diem_preapproved: boolean; ticket_id: string | null; notes: string | null; created_by: string | null; published_at: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; job_id?: string | null; branch_id: string; shift_date: string; status?: 'staged' | 'published'; meal_type?: 'standard' | 'odmp'; per_diem_preapproved?: boolean; ticket_id?: string | null; notes?: string | null; created_by?: string | null; published_at?: string | null }
        Update: { id?: string; job_id?: string | null; branch_id?: string; shift_date?: string; status?: 'staged' | 'published'; meal_type?: 'standard' | 'odmp'; per_diem_preapproved?: boolean; ticket_id?: string | null; notes?: string | null; created_by?: string | null; published_at?: string | null; updated_at?: string }
        Relationships: []
      }
      billing_shift_job_types: {
        Row: { id: string; shift_id: string; job_type: string }
        Insert: { id?: string; shift_id: string; job_type: string }
        Update: { id?: string; shift_id?: string; job_type?: string }
        Relationships: []
      }
      /** Planned timeline (time + activity) — a plan the tech sees; NOT time entries. */
      billing_shift_timeline: {
        Row: { id: string; shift_id: string; sort_order: number; at_time: string; activity_type_id: string }
        Insert: { id?: string; shift_id: string; sort_order?: number; at_time: string; activity_type_id: string }
        Update: { id?: string; shift_id?: string; sort_order?: number; at_time?: string; activity_type_id?: string }
        Relationships: []
      }
      /** Crew on a shift (before publish); acknowledged_at records the tech's shift acknowledgement. */
      billing_shift_crew: {
        Row: { id: string; shift_id: string; technician_id: string; is_lead: boolean; acknowledged_at: string | null }
        Insert: { id?: string; shift_id: string; technician_id: string; is_lead?: boolean; acknowledged_at?: string | null }
        Update: { id?: string; shift_id?: string; technician_id?: string; is_lead?: boolean; acknowledged_at?: string | null }
        Relationships: []
      }
      /** Traffic-plan files on a shift (multiple), visible to techs. */
      billing_shift_files: {
        Row: { id: string; shift_id: string; storage_path: string; filename: string | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; shift_id: string; storage_path: string; filename?: string | null; uploaded_by?: string | null }
        Update: { id?: string; shift_id?: string; storage_path?: string; filename?: string | null; uploaded_by?: string | null }
        Relationships: []
      }
    }
    Views: {
      /** Derived QuickBooks customer name: "{customer.name} - {profile.name}" */
      billing_profile_qb_names: {
        Row: { profile_id: string; qb_name: string }
        Relationships: []
      }
    }
    // NOTE: kept empty on purpose. Populating this changes supabase-js's generic
    // resolution enough to break embed-cast inference in unrelated dashboard
    // routes. RPC calls are typed at the call site instead (see billing_next_number).
    Functions: Record<string, never>
  }
}
