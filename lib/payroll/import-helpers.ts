import type { ParsedEmployee } from './types'
import type { createServiceClient } from '@/lib/supabase/server'
import { matchEmployeeName, suggestPayrollItemGroup } from '@/lib/ai/match'

type SupabaseClient = ReturnType<typeof createServiceClient>

export type ResolvedEmployee = {
  rawName: string
  employeeId: string
  assignmentId: string
  payrollCodeId: string | null
  businessTag: string | null
  isNew: boolean
}

type ResolvedItem = { id: string | null; isConfirmed: boolean }

export async function resolveEmployees(
  parsedEmployees: ParsedEmployee[],
  entityId: string,
  supabase: SupabaseClient
): Promise<ResolvedEmployee[]> {
  const resolved: ResolvedEmployee[] = []
  for (const emp of parsedEmployees) {
    const { data: existing, error } = await supabase
      .from('employee_entity_assignments')
      .select('id, employee_id, payroll_code_id, is_confirmed, business_tag')
      .eq('raw_name_in_report', emp.rawName).eq('entity_id', entityId).maybeSingle()
    if (error) throw new Error(`Failed to lookup employee "${emp.rawName}": ${error.message}`)
    if (existing) {
      resolved.push({
        rawName: emp.rawName,
        employeeId: existing.employee_id,
        assignmentId: existing.id,
        payrollCodeId: existing.is_confirmed ? existing.payroll_code_id : null,
        businessTag: existing.business_tag ?? null,
        isNew: false,
      })
      continue
    }
    // Before creating a new employee record, check if this person exists under any other entity.
    // QuickBooks sometimes adds/omits a trailing period after a middle initial (e.g. "A" vs "A."),
    // so we check all name variants to avoid creating duplicate employee records.
    const nameVariants = [...new Set([
      emp.rawName,
      emp.rawName.replace(/\.+\s*$/, ''),   // strip trailing period(s)
      emp.rawName.trimEnd() + '.',           // add trailing period
    ])]
    const { data: crossEntityAssign } = await supabase
      .from('employee_entity_assignments')
      .select('employee_id')
      .in('raw_name_in_report', nameVariants)
      .limit(1)
      .maybeSingle()

    let employeeId: string
    if (crossEntityAssign) {
      employeeId = crossEntityAssign.employee_id
    } else {
      const { data: newEmp, error: empErr } = await supabase
        .from('employees').insert({ first_name: emp.autoFirstName, last_name: emp.autoLastName })
        .select('id').single()
      if (empErr || !newEmp) throw new Error(`Failed to insert employee "${emp.rawName}": ${empErr?.message}`)
      employeeId = newEmp.id
    }

    const { data: newAssign, error: assignErr } = await supabase
      .from('employee_entity_assignments')
      .insert({ employee_id: employeeId, entity_id: entityId, raw_name_in_report: emp.rawName, is_confirmed: false, payroll_code_id: null })
      .select('id').single()
    if (assignErr || !newAssign) throw new Error(`Failed to insert assignment for "${emp.rawName}": ${assignErr?.message}`)
    resolved.push({ rawName: emp.rawName, employeeId, assignmentId: newAssign.id, payrollCodeId: null, businessTag: null, isNew: true })
  }
  return resolved
}

// Returns a map of item name → { id, isConfirmed }.
// Existing confirmed items: isConfirmed=true.
// Existing unconfirmed items: isConfirmed=false (already in review queue).
// Newly created items: isConfirmed=false, added to 'Other' group pending review.
// Creation failures: id=null, isConfirmed=false.
export async function resolvePayrollItems(
  itemNames: string[],
  supabase: SupabaseClient
): Promise<Map<string, ResolvedItem>> {
  const { data: items, error } = await supabase.from('payroll_items').select('id, name, is_confirmed')
  if (error) throw new Error(`Failed to load payroll_items: ${error.message}`)
  const map = new Map<string, ResolvedItem>()
  const existing = new Map((items ?? []).map((i) => [i.name, { id: i.id, isConfirmed: i.is_confirmed }]))
  for (const name of itemNames) {
    if (existing.has(name)) { map.set(name, existing.get(name)!); continue }
    const { data: grp, error: grpErr } = await supabase
      .from('payroll_item_groups').select('id').eq('name', 'Other').maybeSingle()
    if (grpErr) throw new Error(`Failed to lookup Other group: ${grpErr.message}`)
    if (!grp?.id) { map.set(name, { id: null, isConfirmed: false }); continue }
    const { data: ni, error: ie } = await supabase
      .from('payroll_items').insert({ name, group_id: grp.id, is_confirmed: false }).select('id').single()
    map.set(name, ie || !ni ? { id: null, isConfirmed: false } : { id: ni.id, isConfirmed: false })
  }
  return map
}

export async function insertPayrollData(
  importId: string, entityId: string, periodDate: string,
  resolved: ResolvedEmployee[], parsedEmployees: ParsedEmployee[],
  itemNameToId: Map<string, ResolvedItem>, supabase: SupabaseClient,
  onTxnProgress?: (done: number, total: number) => void
): Promise<{ txnCount: number; taxCount: number; pendingCount: number; stagedItemTxnCount: number; newItemNames: string[] }> {
  const rMap = new Map(resolved.map((r) => [r.rawName, r]))
  let txnCount = 0; let taxCount = 0; let pendingCount = 0; let stagedItemTxnCount = 0
  const newItemNames: string[] = []

  // Pre-count live transactions (excludes staged-by-item) for progress reporting
  const confirmedTxnTotal = parsedEmployees.reduce((sum, emp) => {
    const r = rMap.get(emp.rawName)
    if (!r || r.payrollCodeId === null) return sum
    return sum + emp.lineItems.filter((item) => {
      const ri = itemNameToId.get(item.itemName)
      return r.businessTag || !ri || ri.isConfirmed || ri.id === null
    }).length
  }, 0)
  const updateEvery = Math.max(1, Math.floor(confirmedTxnTotal / 10))

  for (const emp of parsedEmployees) {
    const res = rMap.get(emp.rawName)
    if (!res) continue

    if (res.businessTag) {
      // WH/Signs employee — store data with null payroll_code_id + business_tag so it is
      // preserved for auditing but naturally excluded from all SN dashboard queries
      for (const item of emp.lineItems) {
        const ri = itemNameToId.get(item.itemName) ?? { id: null, isConfirmed: true }
        const { error } = await supabase.from('payroll_transactions').insert({
          import_id: importId, employee_id: res.employeeId, entity_id: entityId,
          payroll_code_id: null, business_tag: res.businessTag as 'western_highways' | 'signs',
          period_date: periodDate, payroll_item_id: ri.id,
          hours: item.hours, rate: item.rate, amount: item.amount,
        })
        if (error) throw new Error(`Failed to insert WH/Signs transaction for "${res.rawName}": ${error.message}`)
        txnCount++
        if (onTxnProgress && confirmedTxnTotal > 0 && (txnCount % updateEvery === 0 || txnCount === confirmedTxnTotal)) {
          onTxnProgress(txnCount, confirmedTxnTotal)
        }
      }
      if (emp.taxAmount > 0) {
        const { error } = await supabase.from('payroll_taxes').insert({
          import_id: importId, employee_id: res.employeeId, entity_id: entityId,
          business_tag: res.businessTag as 'western_highways' | 'signs',
          period_date: periodDate, amount: emp.taxAmount,
        })
        if (error) throw new Error(`Failed to insert WH/Signs tax for "${res.rawName}": ${error.message}`)
        taxCount++
      }
      continue
    }

    if (res.payrollCodeId === null) {
      // Employee pending — stage everything regardless of item status
      pendingCount++
      for (const item of emp.lineItems) {
        const ri = itemNameToId.get(item.itemName) ?? { id: null, isConfirmed: false }
        const { error } = await supabase.from('payroll_staged_transactions').insert({
          assignment_id: res.assignmentId, import_id: importId, entity_id: entityId,
          period_date: periodDate, payroll_item_id: ri.id,
          hours: item.hours, rate: item.rate, amount: item.amount,
        })
        if (error) throw new Error(`Failed to stage transaction for "${res.rawName}": ${error.message}`)
      }
      if (emp.taxAmount > 0) {
        const { error } = await supabase.from('payroll_staged_taxes').insert({
          assignment_id: res.assignmentId, import_id: importId, entity_id: entityId,
          period_date: periodDate, amount: emp.taxAmount,
        })
        if (error) throw new Error(`Failed to stage tax for "${res.rawName}": ${error.message}`)
      }
    } else {
      // Employee confirmed — insert live, but stage if item is unconfirmed
      for (const item of emp.lineItems) {
        const ri = itemNameToId.get(item.itemName) ?? { id: null, isConfirmed: true }
        if (!ri.isConfirmed && ri.id !== null) {
          // Stage by item — employee is confirmed, item needs review
          const { error } = await supabase.from('payroll_item_staged_transactions').insert({
            payroll_item_id: ri.id, import_id: importId,
            employee_id: res.employeeId, entity_id: entityId,
            payroll_code_id: res.payrollCodeId, period_date: periodDate,
            hours: item.hours, rate: item.rate, amount: item.amount,
          })
          if (error) throw new Error(`Failed to stage item transaction for "${item.itemName}": ${error.message}`)
          stagedItemTxnCount++
          if (!newItemNames.includes(item.itemName)) newItemNames.push(item.itemName)
        } else {
          // Confirmed item or null-id fallback → insert live
          const { error } = await supabase.from('payroll_transactions').insert({
            import_id: importId, employee_id: res.employeeId, entity_id: entityId,
            payroll_code_id: res.payrollCodeId, period_date: periodDate,
            payroll_item_id: ri.id, hours: item.hours, rate: item.rate, amount: item.amount,
          })
          if (error) throw new Error(`Failed to insert payroll transaction: ${error.message}`)
          txnCount++
          if (onTxnProgress && confirmedTxnTotal > 0 && (txnCount % updateEvery === 0 || txnCount === confirmedTxnTotal)) {
            onTxnProgress(txnCount, confirmedTxnTotal)
          }
        }
      }
      if (emp.taxAmount > 0) {
        const { error } = await supabase.from('payroll_taxes').insert({
          import_id: importId, employee_id: res.employeeId, entity_id: entityId,
          period_date: periodDate, amount: emp.taxAmount,
        })
        if (error) throw new Error(`Failed to insert payroll tax: ${error.message}`)
        taxCount++
      }
    }
  }
  return { txnCount, taxCount, pendingCount, stagedItemTxnCount, newItemNames }
}

export function triggerAiForPayroll(
  newEmployees: ResolvedEmployee[], entityId: string,
  newItemNames: string[], supabase: SupabaseClient
): void {
  void runAiForPayroll(newEmployees, entityId, newItemNames, supabase)
    .catch((err) => console.error('[AI] triggerAiForPayroll failed:', err))
}

async function runAiForPayroll(
  newEmployees: ResolvedEmployee[], entityId: string,
  newItemNames: string[], supabase: SupabaseClient
): Promise<void> {
  const { data: allAssignments } = await supabase.from('employee_entity_assignments')
    .select('employee_id, raw_name_in_report').eq('entity_id', entityId)
  const { data: allEmployees } = await supabase.from('employees').select('id, first_name, last_name')
  const empNameMap = new Map((allEmployees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]))
  const newIds = new Set(newEmployees.map((n) => n.employeeId))
  const existingCtx = (allAssignments ?? []).filter((a) => !newIds.has(a.employee_id))
    .reduce<Array<{ displayName: string; knownRawNames: string[] }>>((acc, a) => {
      const display = empNameMap.get(a.employee_id) ?? ''
      const found = acc.find((x) => x.displayName === display)
      if (found) found.knownRawNames.push(a.raw_name_in_report)
      else acc.push({ displayName: display, knownRawNames: [a.raw_name_in_report] })
      return acc
    }, [])
  for (const emp of newEmployees) {
    if (existingCtx.length === 0) break
    const matches = await matchEmployeeName(emp.rawName, existingCtx)
    if (matches.length > 0) {
      await supabase.from('employee_entity_assignments')
        .update({ ai_match_candidate: matches[0].candidateName, ai_match_score: matches[0].score })
        .eq('employee_id', emp.employeeId).eq('entity_id', entityId)
    }
  }
  if (newItemNames.length > 0) {
    const { data: ei } = await supabase.from('payroll_items').select('name, group_id')
    const { data: groups } = await supabase.from('payroll_item_groups').select('id, name')
    const gMap = new Map((groups ?? []).map((g) => [g.id, g.name]))
    const ctx = (ei ?? []).map((i) => ({ name: i.name, groupName: gMap.get(i.group_id) ?? 'Other' }))
    for (const itemName of newItemNames) {
      const s = await suggestPayrollItemGroup(itemName, ctx)
      await supabase.from('payroll_items')
        .update({ ai_suggested_group: s.suggestedGroup, ai_confidence: s.confidence }).eq('name', itemName)
    }
  }
}
