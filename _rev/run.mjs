import * as parserMod from './parser.mjs'
import fs from 'fs'
const buf = fs.readFileSync(process.argv[2])
const fn = parserMod.parseRevenueFile || parserMod.default
const res = fn(buf)
const r = res.data ?? res
console.log('periodDate:', r.periodDate)
console.log('records:', (r.records||[]).length, ' warnings:', (r.warnings||[]).length)
const byKey = {}
for (const rec of (r.records||[])) {
  const k = rec.branchName + ' | ' + rec.entityCode
  byKey[k] = (byKey[k]||0) + rec.totalRevenue
}
console.log('--- parsed (branch | entity : total) ---')
for (const k of Object.keys(byKey).sort()) console.log(k, ':', byKey[k].toFixed(2))
console.log('--- warnings ---')
for (const w of (r.warnings||[])) console.log('•', w)
