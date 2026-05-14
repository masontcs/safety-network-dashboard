/**
 * Database cleanup script — run once to fix two known data issues:
 *
 * 1. Duplicate payroll_transactions: the import code produced duplicate rows for
 *    some employees (same import_id, employee_id, payroll_code_id, payroll_item_id,
 *    period_date, hours, amount). Keep the minimum id in each group, delete the rest.
 *
 * 2. Revenue total_revenue includes sales_tax: the parser incorrectly computed
 *    total_revenue = labor + rental + one_time_charges + sales_tax.
 *    Fix: set total_revenue = labor + rental + one_time_charges.
 *
 * Run: node scripts/cleanup.mjs
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync } from 'fs'

function loadEnv() {
  try {
    const raw = readFileSync('.env.local', 'utf8')
    for (const line of raw.split('\n')) {
      const eq = line.indexOf('=')
      if (eq < 0 || line.trim().startsWith('#')) continue
      process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
  } catch { /* no .env.local */ }
}
loadEnv()

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!BASE_URL || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
}

async function get(table, params = '') {
  const rows = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const res = await fetch(`${BASE_URL}/rest/v1/${table}?${params}&offset=${from}&limit=${PAGE}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GET ${table} failed: ${text}`)
    }
    const page = await res.json()
    if (!Array.isArray(page) || page.length === 0) break
    rows.push(...page)
    if (page.length < PAGE) break
    from += PAGE
  }
  return rows
}

async function del(table, ids) {
  if (ids.length === 0) return 0
  // Delete in batches of 100 to avoid URL length limits
  let deleted = 0
  const BATCH = 100
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const res = await fetch(`${BASE_URL}/rest/v1/${table}?id=in.(${batch.join(',')})`, {
      method: 'DELETE',
      headers: HEADERS,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`DELETE ${table} failed: ${text}`)
    }
    deleted += batch.length
  }
  return deleted
}

async function patch(table, id, body) {
  const res = await fetch(`${BASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PATCH ${table}/${id} failed: ${text}`)
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// ── 1. Fix payroll duplicate transactions ─────────────────────────────────────

console.log('\n=== Step 1: Finding duplicate payroll transactions ===\n')

const txns = await get(
  'payroll_transactions',
  'select=id,import_id,employee_id,payroll_code_id,payroll_item_id,period_date,hours,amount&order=id.asc'
)

console.log(`Fetched ${txns.length.toLocaleString()} payroll transactions`)

// Group by the full duplicate key
const groups = new Map()
for (const t of txns) {
  // Normalize nulls so they group correctly
  const key = [
    t.import_id ?? '',
    t.employee_id ?? '',
    t.payroll_code_id ?? 'NULL',
    t.payroll_item_id ?? 'NULL',
    t.period_date ?? '',
    t.hours ?? 'NULL',
    t.amount,
  ].join('|')
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(t.id)
}

const dupGroups = [...groups.values()].filter((ids) => ids.length > 1)
console.log(`Found ${dupGroups.length} duplicate groups`)

if (dupGroups.length > 0) {
  // Keep the minimum id in each group, delete the rest
  const toDelete = []
  let totalInflation = 0

  for (const ids of dupGroups) {
    ids.sort((a, b) => a.localeCompare(b))
    const keep = ids[0]
    const remove = ids.slice(1)
    toDelete.push(...remove)
    // Find the amount for reporting
    const txn = txns.find((t) => t.id === keep)
    if (txn) totalInflation += txn.amount * remove.length
  }

  console.log(`IDs to delete: ${toDelete.length}`)
  console.log(`Estimated inflation removed: $${totalInflation.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)

  // Show first 10 groups for verification
  console.log('\nSample duplicate groups (keeping first, deleting rest):')
  for (const ids of dupGroups.slice(0, 10)) {
    ids.sort()
    const txn = txns.find((t) => t.id === ids[0])
    console.log(`  Period ${txn?.period_date} | $${txn?.amount} — keeping ${ids[0]}, deleting ${ids.slice(1).join(', ')}`)
  }

  console.log(`\nDeleting ${toDelete.length} duplicate transactions...`)
  const deleted = await del('payroll_transactions', toDelete)
  console.log(`Deleted ${deleted} rows ✓`)
} else {
  console.log('No duplicate payroll transactions found — nothing to delete.')
}

// ── 2. Fix revenue total_revenue (remove sales_tax) ──────────────────────────

console.log('\n=== Step 2: Fixing revenue total_revenue (removing incorrectly included sales_tax) ===\n')

const revTxns = await get(
  'revenue_transactions',
  'select=id,period_date,branch_id,labor,rental,one_time_charges,sales_tax,total_revenue'
)

console.log(`Fetched ${revTxns.length.toLocaleString()} revenue transactions`)

let fixCount = 0
let totalDiff = 0

for (const r of revTxns) {
  const correct = round2(r.labor + r.rental + r.one_time_charges)
  const diff = Math.abs(r.total_revenue - correct)
  if (diff > 0.005) {
    fixCount++
    totalDiff += diff
    console.log(
      `  ${r.period_date} branch ${r.branch_id}: ` +
      `stored=${r.total_revenue.toFixed(2)} correct=${correct.toFixed(2)} diff=${diff.toFixed(2)} ` +
      `(sales_tax was ${r.sales_tax.toFixed(2)})`
    )
    await patch('revenue_transactions', r.id, { total_revenue: correct })
  }
}

if (fixCount === 0) {
  console.log('All revenue totals are already correct — nothing to fix.')
} else {
  console.log(`\nFixed ${fixCount} revenue rows ✓`)
  console.log(`Total revenue corrected by: -$${totalDiff.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log('(Revenue was being overstated by the sales_tax amount in each affected row)')
}

console.log('\n=== Cleanup complete ===\n')
