/**
 * Data integrity audit script.
 * Run with: node scripts/audit.mjs
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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

async function sql(query) {
  const res = await fetch(`${URL}/rest/v1/rpc/execute_sql`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    // Fall back to direct table API for simple queries
    return null
  }
  return res.json()
}

// Use Supabase PostgREST directly for table queries
async function q(table, params = '') {
  const res = await fetch(`${URL}/rest/v1/${table}?${params}&limit=2000`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Prefer': 'count=exact',
    },
  })
  const count = res.headers.get('content-range')?.split('/')[1] ?? '?'
  const data = await res.json()
  return { data, count }
}

// Paginate through all rows
async function all(table, params = '') {
  const rows = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const res = await fetch(`${URL}/rest/v1/${table}?${params}&offset=${from}&limit=${PAGE}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    const page = await res.json()
    if (!Array.isArray(page) || page.length === 0) break
    rows.push(...page)
    if (page.length < PAGE) break
    from += PAGE
  }
  return rows
}

function section(title) {
  console.log('\n' + '═'.repeat(60))
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

function ok(msg) { console.log(`  ✓  ${msg}`) }
function warn(msg) { console.log(`  ⚠  ${msg}`) }
function fail(msg) { console.log(`  ✗  ${msg}`) }
function info(msg) { console.log(`     ${msg}`) }

// ── Run all checks ────────────────────────────────────────────────────────────

console.log('\nSafety Network — Data Integrity Audit')
console.log(new Date().toLocaleString())

// ── 1. Import Status ─────────────────────────────────────────────────────────
section('1. Import Status')

const { data: payrollImports } = await q('payroll_imports', 'select=id,status,period_date,entity_id&order=period_date.desc')
const { data: revenueImports } = await q('revenue_imports', 'select=id,status,period_date&order=period_date.desc')
const { data: fuelImports } = await q('fuel_imports', 'select=id,status,vendor,date_range_end&order=date_range_end.desc')

const piByStatus = {}
for (const i of payrollImports) piByStatus[i.status] = (piByStatus[i.status] ?? 0) + 1
info(`Payroll imports: ${JSON.stringify(piByStatus)}`)

const riByStatus = {}
for (const i of revenueImports) riByStatus[i.status] = (riByStatus[i.status] ?? 0) + 1
info(`Revenue imports: ${JSON.stringify(riByStatus)}`)

const fiByStatus = {}
for (const i of fuelImports) fiByStatus[i.status] = (fiByStatus[i.status] ?? 0) + 1
info(`Fuel imports:    ${JSON.stringify(fiByStatus)}`)

const pendingPayroll = payrollImports.filter(i => i.status === 'pending')
if (pendingPayroll.length > 0) {
  warn(`${pendingPayroll.length} payroll imports still in 'pending' status`)
  for (const p of pendingPayroll.slice(0, 10)) info(`  period ${p.period_date} (id: ${p.id})`)
} else ok('All payroll imports confirmed')

// ── 2. Transaction counts per payroll period ──────────────────────────────────
section('2. Payroll Transaction Counts by Period')

const allPayTxns = await all('payroll_transactions', 'select=period_date,amount,employee_id')
const byPeriod = {}
for (const t of allPayTxns) {
  if (!byPeriod[t.period_date]) byPeriod[t.period_date] = { count: 0, total: 0, employees: new Set() }
  byPeriod[t.period_date].count++
  byPeriod[t.period_date].total += t.amount
  byPeriod[t.period_date].employees.add(t.employee_id)
}

const periods = Object.entries(byPeriod).sort(([a], [b]) => b.localeCompare(a))
const counts = periods.map(([, v]) => v.count)
const avgCount = counts.reduce((s, c) => s + c, 0) / counts.length

info(`${periods.length} payroll periods found`)
info(`Total transactions: ${allPayTxns.length.toLocaleString()}`)
info(`Avg transactions/period: ${Math.round(avgCount)}`)
info('')
info('Period            Txns   Employees   Total Amount')
info('─'.repeat(55))
for (const [period, v] of periods.slice(0, 20)) {
  const flag = v.count < avgCount * 0.5 ? ' ⚠ LOW' : ''
  info(`${period}      ${String(v.count).padStart(5)}   ${String(v.employees.size).padStart(9)}   $${v.total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}${flag}`)
}

const lowPeriods = periods.filter(([, v]) => v.count < avgCount * 0.5)
if (lowPeriods.length > 0) warn(`${lowPeriods.length} periods have fewer than half the average transaction count`)
else ok('No unusually low-count periods detected')

// ── 3. Duplicate payroll transactions ────────────────────────────────────────
section('3. Duplicate Payroll Transactions')

const dupMap = {}
for (const t of allPayTxns) {
  // Can't check payroll_code_id without fetching it, use employee+period+amount as key
  const k = `${t.employee_id}|${t.period_date}|${t.amount}`
  dupMap[k] = (dupMap[k] ?? 0) + 1
}
const dups = Object.entries(dupMap).filter(([, c]) => c > 1)
if (dups.length === 0) {
  ok('No duplicate transactions detected (same employee + period + amount)')
} else {
  fail(`${dups.length} potential duplicate groups found`)
  for (const [key, count] of dups.slice(0, 10)) {
    const [empId, period, amount] = key.split('|')
    info(`  Employee ${empId} | ${period} | $${amount} — appears ${count}x`)
  }
}

// ── 4. Revenue completeness ───────────────────────────────────────────────────
section('4. Revenue Completeness (all SN branches present per period)')

const allRevTxns = await all('revenue_transactions', 'select=period_date,branch_id,total_revenue')
const { data: snBranches } = await q('branches', 'select=id,name&is_revenue_generating=eq.true&is_active=eq.true')

const revByPeriod = {}
for (const t of allRevTxns) {
  if (!revByPeriod[t.period_date]) revByPeriod[t.period_date] = new Set()
  revByPeriod[t.period_date].add(t.branch_id)
}

const branchIds = new Set(snBranches.map(b => b.id))
const branchNameMap = {}
for (const b of snBranches) branchNameMap[b.id] = b.name

info(`${snBranches.length} SN revenue-generating branches, ${Object.keys(revByPeriod).length} revenue periods`)

let missingCount = 0
for (const [period, presentBranches] of Object.entries(revByPeriod).sort(([a], [b]) => b.localeCompare(a))) {
  const missing = [...branchIds].filter(id => !presentBranches.has(id))
  if (missing.length > 0) {
    missingCount++
    const names = missing.map(id => branchNameMap[id] ?? id).join(', ')
    warn(`${period}: missing revenue for — ${names}`)
  }
}
if (missingCount === 0) ok('All SN branches have revenue for every imported period')

// ── 5. Revenue vs Payroll period alignment ───────────────────────────────────
section('5. Revenue vs Payroll Period Alignment')

const payrollPeriods = new Set(Object.keys(byPeriod))
const revenuePeriods = new Set(Object.keys(revByPeriod))

const payOnlyPeriods = [...payrollPeriods].filter(p => !revenuePeriods.has(p)).sort()
const revOnlyPeriods = [...revenuePeriods].filter(p => !payrollPeriods.has(p)).sort()

if (payOnlyPeriods.length > 0) warn(`Periods with payroll but NO revenue: ${payOnlyPeriods.join(', ')}`)
else ok('Every payroll period has a matching revenue period')

if (revOnlyPeriods.length > 0) warn(`Periods with revenue but NO payroll: ${revOnlyPeriods.join(', ')}`)
else ok('Every revenue period has a matching payroll period')

// ── 6. Payroll period dates — must all be Saturdays ──────────────────────────
section('6. Payroll Period Date Validity (must be Saturdays)')

const nonSaturdays = []
for (const period of payrollPeriods) {
  const d = new Date(period + 'T00:00:00')
  if (d.getDay() !== 6) nonSaturdays.push({ period, day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] })
}
if (nonSaturdays.length === 0) ok('All payroll period_dates are Saturdays')
else {
  fail(`${nonSaturdays.length} period dates are NOT Saturdays:`)
  for (const { period, day } of nonSaturdays) info(`  ${period} is a ${day}`)
}

// ── 7. Business tag leak check ───────────────────────────────────────────────
section('7. Business Tag Leak Check')

const { data: taxRows } = await q('payroll_taxes', 'select=business_tag,amount&business_tag=not.is.null')
const tagTotals = {}
for (const t of taxRows) {
  tagTotals[t.business_tag] = (tagTotals[t.business_tag] ?? 0) + t.amount
}
if (Object.keys(tagTotals).length === 0) {
  ok('No tax rows with business_tag — WH/Signs taxes correctly excluded from SN')
} else {
  ok(`business_tag breakdown in payroll_taxes (these are correctly EXCLUDED from SN dashboards):`)
  for (const [tag, total] of Object.entries(tagTotals)) {
    info(`  ${tag}: $${total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`)
  }
}

// Also check fuel_transactions
const { data: fuelTagged } = await q('fuel_transactions', 'select=business_tag,total_with_tax&business_tag=not.is.null')
const fuelTagTotals = {}
for (const t of fuelTagged) {
  fuelTagTotals[t.business_tag] = (fuelTagTotals[t.business_tag] ?? 0) + t.total_with_tax
}
if (Object.keys(fuelTagTotals).length === 0) {
  info('No fuel_transactions with business_tag')
} else {
  ok(`business_tag breakdown in fuel_transactions (correctly excluded from SN):`)
  for (const [tag, total] of Object.entries(fuelTagTotals)) {
    info(`  ${tag}: $${total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`)
  }
}

// ── 8. Negative amounts ───────────────────────────────────────────────────────
section('8. Negative Amount Check')

let negCount = 0
for (const t of allPayTxns) {
  if (t.amount < 0) negCount++
}
if (negCount === 0) ok('No negative amounts in payroll_transactions')
else warn(`${negCount} payroll transactions have negative amounts`)

const { data: negRev } = await q('revenue_transactions', 'select=id&total_revenue=lt.0')
if (negRev.length === 0) ok('No negative total_revenue in revenue_transactions')
else fail(`${negRev.length} revenue transactions have negative total_revenue`)

const { data: negFuel } = await q('fuel_transactions', 'select=id&total_with_tax=lt.0&business_tag=is.null')
if (negFuel.length === 0) ok('No negative total_with_tax in fuel_transactions (SN)')
else warn(`${negFuel.length} fuel transactions have negative total_with_tax`)

const { data: negTax } = await q('payroll_taxes', 'select=id&amount=lt.0&business_tag=is.null')
if (negTax.length === 0) ok('No negative amounts in payroll_taxes (SN)')
else warn(`${negTax.length} payroll_taxes rows have negative amounts`)

// ── 9. Employees with payroll but no confirmed assignment ─────────────────────
section('9. Unconfirmed Employee Assignments')

const { data: confirmedAssignments } = await q('employee_entity_assignments', 'select=employee_id&is_confirmed=eq.true')
const confirmedEmpIds = new Set(confirmedAssignments.map(a => a.employee_id))

const unconfirmedEmpIds = new Set()
for (const t of allPayTxns) {
  if (!confirmedEmpIds.has(t.employee_id)) unconfirmedEmpIds.add(t.employee_id)
}

if (unconfirmedEmpIds.size === 0) {
  ok('All employees with payroll transactions have a confirmed entity assignment')
} else {
  fail(`${unconfirmedEmpIds.size} employees have payroll transactions but NO confirmed assignment`)
  info('These employees will not be correctly attributed to a branch:')
  // Fetch names
  const ids = [...unconfirmedEmpIds].slice(0, 10)
  const { data: empDetails } = await q('employees', `select=id,first_name,last_name&id=in.(${ids.join(',')})`)
  for (const e of empDetails) info(`  ${e.first_name} ${e.last_name} (${e.id})`)
  if (unconfirmedEmpIds.size > 10) info(`  ... and ${unconfirmedEmpIds.size - 10} more`)
}

// ── 10. Employee allocation sum check ────────────────────────────────────────
section('10. Employee Allocation Integrity (active splits must sum to 100%)')

const { data: allAllocations } = await q('employee_allocations', 'select=employee_id,percentage,status,effective_to&status=eq.approved&effective_to=is.null')
const allocByEmp = {}
for (const a of allAllocations) {
  if (!allocByEmp[a.employee_id]) allocByEmp[a.employee_id] = 0
  allocByEmp[a.employee_id] += a.percentage
}

const badAllocs = Object.entries(allocByEmp).filter(([, pct]) => Math.abs(pct - 100) > 0.01)
if (badAllocs.length === 0) {
  ok(`All ${Object.keys(allocByEmp).length} employees with active allocations sum to 100%`)
} else {
  fail(`${badAllocs.length} employees have active allocations that don't sum to 100%:`)
  const ids = badAllocs.slice(0, 10).map(([id]) => id)
  const { data: empDetails } = await q('employees', `select=id,first_name,last_name&id=in.(${ids.join(',')})`)
  const nameMap = {}
  for (const e of empDetails) nameMap[e.id] = `${e.first_name} ${e.last_name}`
  for (const [id, pct] of badAllocs.slice(0, 10)) {
    info(`  ${nameMap[id] ?? id}: ${pct.toFixed(2)}%`)
  }
}

// ── 11. Fuel transactions with no branch ─────────────────────────────────────
section('11. Fuel Transactions with No Branch Assignment')

const { data: noBranchFuel } = await q('fuel_transactions', 'select=id,transaction_date,total_with_tax&branch_id=is.null&business_tag=is.null')
if (noBranchFuel.length === 0) ok('All SN fuel transactions have a branch_id')
else {
  warn(`${noBranchFuel.length} SN fuel transactions have no branch_id — excluded from branch-level reports`)
  const total = noBranchFuel.reduce((s, t) => s + t.total_with_tax, 0)
  info(`  Total amount unattributed: $${total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`)
}

// ── 12. Revenue transaction totals check ─────────────────────────────────────
section('12. Revenue Calculation Consistency')

// total_revenue should equal labor + rental + one_time_charges
const allRevFull = await all('revenue_transactions', 'select=id,period_date,branch_id,labor,rental,one_time_charges,total_revenue')
let mismatchCount = 0
for (const t of allRevFull) {
  const computed = t.labor + t.rental + t.one_time_charges
  if (Math.abs(computed - t.total_revenue) > 0.02) {
    mismatchCount++
    if (mismatchCount <= 5) warn(`  ${t.period_date} branch ${t.branch_id}: labor+rental+one_time=${computed.toFixed(2)} but total_revenue=${t.total_revenue.toFixed(2)}`)
  }
}
if (mismatchCount === 0) ok('All revenue rows: total_revenue = labor + rental + one_time_charges ✓')
else fail(`${mismatchCount} revenue rows have total_revenue ≠ labor + rental + one_time_charges`)

// ── Summary ───────────────────────────────────────────────────────────────────
section('Audit Complete')
info('Review any ⚠ or ✗ items above.')
