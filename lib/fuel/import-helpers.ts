import type { ParsedFuelTransaction } from './types'
import type { createServiceClient } from '@/lib/supabase/server'
import type { Vendor, BusinessTag } from '@/lib/supabase/database.types'

type SupabaseClient = ReturnType<typeof createServiceClient>

type CardAssignment = {
  assignmentId: string
  branchId: string | null
  employeeId: string | null
  businessTag: BusinessTag | null
}

export async function resolveCardAssignments(
  transactions: ParsedFuelTransaction[],
  vendor: Vendor,
  supabase: SupabaseClient
): Promise<Map<string, CardAssignment>> {
  const cardNames = [...new Set(transactions.map((t) => t.cardName))]
  const map = new Map<string, CardAssignment>()

  const { data: existing, error } = await supabase
    .from('fuel_card_assignments')
    .select('id, card_name, branch_id, employee_id, business_tag')
    .eq('vendor', vendor)
    .in('card_name', cardNames)

  if (error) throw new Error(`Failed to load fuel_card_assignments: ${error.message}`)

  for (const row of existing ?? []) {
    map.set(row.card_name, {
      assignmentId: row.id,
      branchId: row.branch_id,
      employeeId: row.employee_id,
      businessTag: row.business_tag,
    })
  }

  // Create unconfirmed assignments for new card names
  for (const cardName of cardNames) {
    if (map.has(cardName)) continue

    // Detect business tag from transaction (parser already tagged WH cards)
    const txn = transactions.find((t) => t.cardName === cardName)
    const businessTag = txn?.businessTag ?? null

    const { data: newCard, error: insertErr } = await supabase
      .from('fuel_card_assignments')
      .insert({ card_name: cardName, vendor, is_confirmed: false, business_tag: businessTag })
      .select('id')
      .single()

    if (insertErr || !newCard) throw new Error(`Failed to create card assignment for "${cardName}": ${insertErr?.message}`)

    map.set(cardName, {
      assignmentId: newCard.id,
      branchId: null,
      employeeId: null,
      businessTag,
    })
  }

  return map
}

const BATCH_SIZE = 500

export async function insertFuelData(
  importId: string,
  transactions: ParsedFuelTransaction[],
  cardMap: Map<string, CardAssignment>,
  vendor: Vendor,
  supabase: SupabaseClient
): Promise<{ insertedCount: number }> {
  const rows = transactions.map((txn) => {
    const card = cardMap.get(txn.cardName)
    const businessTag = txn.businessTag ?? card?.businessTag ?? null
    return {
      import_id: importId,
      fuel_card_assignment_id: card?.assignmentId ?? null,
      branch_id: card?.branchId ?? null,
      employee_id: card?.employeeId ?? null,
      business_tag: businessTag,
      vendor,
      transaction_date: txn.transactionDate,
      transaction_time: txn.transactionTime,
      site_name: txn.siteName,
      site_city: txn.siteCity,
      site_state: txn.siteState,
      product: txn.product,
      gallons: txn.gallons,
      price_per_gallon: txn.pricePerGallon,
      total_pretax: txn.totalPretax,
      tax: txn.tax,
      total_with_tax: txn.totalWithTax,
      mpg: txn.mpg ?? null,
    }
  })

  // Insert in batches to stay within Supabase payload limits
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from('fuel_transactions').insert(batch)
    if (error) throw new Error(`Failed to insert fuel transactions (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error.message}`)
  }

  return { insertedCount: rows.length }
}
