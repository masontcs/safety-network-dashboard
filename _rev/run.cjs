const parserMod = require('./parser.cjs')
const fs = require('fs')
const buf = fs.readFileSync(process.argv[2])
const fn = parserMod.parseRevenueFile || parserMod.default
const res = fn(buf)
const r = res.data ?? res
console.log('periodDate:', r.periodDate)
console.log('records:', (r.records||[]).length, ' warnings:', (r.warnings||[]).length)
const byEntity = {}
for (const rec of (r.records||[])) byEntity[rec.entityCode]=(byEntity[rec.entityCode]||0)+rec.totalRevenue
console.log('--- by entity ---'); for(const k of Object.keys(byEntity).sort()) console.log(k, byEntity[k].toFixed(2))
console.log('--- by branch|entity ---')
const byKey={}; for(const rec of (r.records||[])) byKey[rec.branchName+' | '+rec.entityCode]=(byKey[rec.branchName+' | '+rec.entityCode]||0)+rec.totalRevenue
for(const k of Object.keys(byKey).sort()) console.log(k, ':', byKey[k].toFixed(2))
console.log('--- warnings ---'); for(const w of (r.warnings||[])) console.log('•', w)
