import type { ParsedRevenueRecord } from './types'
import type { createServiceClient } from '@/lib/supabase/server'

type SupabaseClient = ReturnType<typeof createServiceClient>

export async function resolveBranchIds(
  branchNames: string[],
  supabase: SupabaseClient
): Promise<{ branchMap: Map<string, string>; warnings: string[] }> {
  const { data: branches, error } = await supabase
    .from('branches')
    .select('id, name')

  if (error) throw new Error(`Failed to load branches: ${error.message}`)

  const dbMap = new Map((branches ?? []).map((b) => [b.name, b.id]))
  const branchMap = new Map<string, string>()
  const warnings: string[] = []

  for (const name of branchNames) {
    const id = dbMap.get(name)
    if (id) {
      branchMap.set(name, id)
    } else {
      warnings.push(`Unknown branch name: "${name}"`)
    }
  }

  return { branchMap, warnings }
}

export async function resolveEntityIds(
  entityCodes: string[],
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  const { data: entities, error } = await supabase
    .from('entities')
    .select('id, code')

  if (error) throw new Error(`Failed to load entities: ${error.message}`)

  const dbMap = new Map((entities ?? []).map((e) => [e.code, e.id]))
  const entityMap = new Map<string, string>()

  for (const code of entityCodes) {
    const id = dbMap.get(code)
    if (id) entityMap.set(code, id)
  }

  return entityMap
}

export async function buildRevenueCodeMap(
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  const { data: codes, error } = await supabase
    .from('revenue_codes')
    .select('id, branch_id, entity_id')

  if (error) throw new Error(`Failed to load revenue_codes: ${error.message}`)

  const map = new Map<string, string>()
  for (const c of codes ?? []) {
    map.set(`${c.branch_id}|${c.entity_id}`, c.id)
  }
  return map
}

export async function insertRevenueData(
  importId: string,
  periodDate: string,
  records: ParsedRevenueRecord[],
  branchMap: Map<string, string>,
  entityMap: Map<string, string>,
  revenueCodeMap: Map<string, string>,
  supabase: SupabaseClient
): Promise<{ insertedCount: number; skippedCount: number; warnings: string[] }> {
  let insertedCount = 0
  let skippedCount = 0
  const warnings: string[] = []

  for (const rec of records) {
    const branchId = branchMap.get(rec.branchName)
    const entityId = entityMap.get(rec.entityCode)

    if (!branchId) {
      warnings.push(`Skipping record — branch not found: "${rec.branchName}"`)
      skippedCount++
      continue
    }
    if (!entityId) {
      warnings.push(`Skipping record — entity not found: "${rec.entityCode}"`)
      skippedCount++
      continue
    }

    const revenueCodeId = revenueCodeMap.get(`${branchId}|${entityId}`) ?? null

    const { error } = await supabase.from('revenue_transactions').insert({
      import_id: importId,
      revenue_code_id: revenueCodeId,
      branch_id: branchId,
      entity_id: entityId,
      period_date: periodDate,
      labor: rec.labor,
      rental: rec.rental,
      one_time_charges: rec.oneTimeCharges,
      sales_tax: rec.salesTax,
      total_revenue: rec.totalRevenue,
    })

    if (error) throw new Error(`Failed to insert revenue transaction: ${error.message}`)
    insertedCount++
  }

  return { insertedCount, skippedCount, warnings }
}
