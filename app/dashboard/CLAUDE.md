# CLAUDE.md — /app/(dashboard)
## Dashboard UI Rules

---

## FOUR DASHBOARDS

```
/admin      → All data + full detail + imports + user management
/executive  → All branches + full detail + full allocation
/district   → Multiple assigned branches + direct detail + admin sum
/manager    → Single branch + direct detail + admin sum
```

Middleware redirects to correct dashboard on login. Wrong-role navigation → redirect.

---

## EMPLOYEE NAME DISPLAY — APPLIES EVERYWHERE

**Always show:** `firstName + ' ' + lastName` (the preferred name)
**Never show** `raw_name_in_report` as a primary label anywhere in the UI.

### Employee detail page only:
```
Jordan Johnson                    ← preferred name, large/prominent
Legal name: JOHNSON, JORDAN R     ← muted, small text underneath
```

### Everywhere else (tables, charts, reports, review queue, search):
Show preferred `displayName` only. No legal name visible.

### Review queue (matching context):
```
Import name: "JOHNSON, JORDAN R"        ← raw from report, shown for matching context
Suggested match: Jordan Johnson [97%]   ← preferred name of matched employee
```
Even in the review queue, the matched employee is identified by their preferred name.
The import name is shown only to help you confirm the match is correct.

---

## EMPLOYEE NAME EDITING (admin only)

Admin can edit first_name and last_name on any employee profile.
Accessible from: employee detail page → Edit Name button.

```
[ First Name  ] [ Last Name  ]  [ Save ]  [ Cancel ]
   Jordan          Johnson

Legal name (from QuickBooks): JOHNSON, JORDAN R  ← always shown, never editable
```

Rules:
- Both fields required, non-empty
- Max 100 characters each
- Changes take effect immediately everywhere in the UI
- Legal name field is display-only — no edit control near it
- Show confirmation on save: "Name updated to Jordan Johnson"

---

## DATA FETCHING

All components fetch from API routes only. Never import from /lib/ in client components.

---

## METRIC DISPLAY — ALL DASHBOARDS

Every metric has three time views:
```
[ Weekly ]  [ MTD ]  [ YTD ]
```
Default to most recent Saturday with imported data.

---

## PAYROLL DISPLAY RULES BY ROLE

### Admin / Executive:
- Direct Labor: employee detail table (displayName, items, hours, rate, amount)
- Admin Payroll: employee detail table (same structure)
- Can access any employee detail page

### District / Branch Manager:
- Direct Labor: full employee detail table (displayName only — no legal name)
- Admin Payroll: single line — "Admin Payroll: $X,XXX.XX"
- No link to admin employee detail pages
- Allocated overhead: single cost line only

---

## REQUIRED METRICS — BRANCH/DISTRICT VIEW

| Metric | Formula | Views |
|---|---|---|
| Total Revenue | labor + rental + one_time_charges | Weekly/MTD/YTD |
| Direct Payroll | direct labor detail | Weekly/MTD/YTD |
| Admin Payroll | lump sum only | Weekly/MTD/YTD |
| Total Fuel | sum total_with_tax | Weekly/MTD/YTD |
| Gross Profit $ | Revenue - Direct - Admin - Fuel | Weekly/MTD/YTD |
| Gross Profit % | (Gross Profit / Revenue) × 100 | Weekly/MTD/YTD |

---

## ANALYTICS FEATURES

- **Trend Lines:** 13-week rolling window — Revenue, Payroll, Fuel, Gross Profit %
- **Month-over-Month:** Current MTD vs prior month, vs same month last year
- **Variance from Target:** Target | Actual | Variance $ | % — green ≤5% / yellow 5-15% / red >15%
- **Anomaly Flag:** Employee payroll >3x their 4-week average → tooltip warning
- **Drill-down:** Click payroll group → line items. Click fuel total → transactions.

---

## DISTRICT MANAGER DASHBOARD

Branch selector: all assigned branches + "All Assigned Branches" aggregate.
Single branch view: identical to branch manager layout.

---

## EXECUTIVE / ADMIN ADDITIONS

- Full admin payroll employee detail
- Corp + HQ allocation breakdown
- Net profit after full allocation
- All-branch summary table
- Missing revenue alerts ($0 revenue weeks)

---

## CHART STANDARDS

Recharts only. Always use `<ResponsiveContainer>`. No fixed pixel widths.

```typescript
const CHART_COLORS = {
  revenue: '#1B4F8A', payroll: '#E85D04',
  fuel: '#F4A261',    profit:  '#2D6A4F', warning: '#F4D03F',
}
```

---

## LOADING / EMPTY / ERROR STATES

Every data section needs all three:
- Skeleton placeholder (not spinner)
- Empty state message when no data for period
- Error state with retry button

---

## IMPORT UI — /admin/import

Three upload zones: Payroll (entity + .xlsm), Revenue (.xls), Fuel (.csv or .xlsx)
Flow: Upload → Preview → [Duplicate warning] → Confirm → Processing → Summary

---

## REVIEW QUEUE — /admin/review

Badge on nav. Three sections:

**Employee Matches:**
```
Import name: "AGUILAR, MARC A" (STS)
Suggested match: Marc Aguilar [98%] — "Same person, name order"
[ Confirm Match ]  [ New Employee ]  [ Skip ]
```

**Unknown Payroll Items:**
```
"NorCal Safety Training Fringe" → Suggested: Fringes [91%]
[ Confirm ]  [ Change Group ]
```

**Unassigned Fuel Cards:**
```
"ARROYO GRANDE" (Interstate) → [ Assign to Branch ]
"JORDAN JOHNSON" (Flyers) → Suggested: Jordan Johnson [97%]
[ Confirm ]  [ New Employee ]  [ Skip ]
```

---

## VERIFICATION CHECKLIST

- [ ] All employee names shown as displayName (first + last) — no legal names as primary labels
- [ ] Employee detail page shows legal name in muted text underneath preferred name
- [ ] Edit Name UI only edits first_name/last_name — no legal name field is editable
- [ ] Review queue shows import name for context + preferred name for matched employee
- [ ] Admin payroll never shown as detail to district/branch managers
- [ ] District manager branch selector shows only assigned branches
- [ ] Charts wrapped in ResponsiveContainer
- [ ] Skeleton loading states render before data arrives
- [ ] Middleware redirects wrong-role users

---

## DESIGN IMPLEMENTATION — REQUIRED READING

All design tokens are defined in the root CLAUDE.md under "DESIGN SYSTEM — LOCKED".
Read those values before writing any component. This section covers implementation specifics.

### Global CSS (globals.css or layout.tsx)
```css
body {
  background: #111111;
  color: #ffffff;
  font-family: var(--font-sans), system-ui, sans-serif;
}

/* Card base — apply to every dashboard card */
.card {
  background: #1e1e1e;
  border-radius: 12px;
  border: 1px solid #2a2a2a;
  padding: 16px;
}

/* Metric label above a big number */
.metric-label {
  font-size: 11px;
  color: #888888;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 2px;
}

/* The big number itself */
.metric-value {
  font-size: 26px;
  font-weight: 500;
  color: #ffffff;
  line-height: 1.1;
}

/* Delta indicators */
.delta-up   { font-size: 11px; color: #ff6b00; }
.delta-down { font-size: 11px; color: #cc4444; }

/* Branch name in any table or list */
.branch-name { color: #ff6b00; }
```

### Recharts Configuration
```typescript
// All chart backgrounds must be transparent
<ResponsiveContainer width="100%" height={130}>

// Revenue bars (primary metric)
<Bar dataKey="revenue" fill="#ff6b00" radius={[3,3,0,0]} />

// Cost bars (fuel, payroll shown as costs)
<Bar dataKey="fuel" fill="#cc4444" fillOpacity={0.8} radius={[3,3,0,0]} />

// Trend lines
<Line dataKey="revenue" stroke="#ff6b00" strokeWidth={2} dot={false} />
<Line dataKey="payroll" stroke="#888888" strokeWidth={1.5} dot={false} />

// Axis styling — always muted
<XAxis tick={{ fill: '#555555', fontSize: 10 }} axisLine={false} tickLine={false} />
<YAxis tick={{ fill: '#555555', fontSize: 9 }} axisLine={false} tickLine={false} />

// Grid lines — very subtle
<CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />

// Tooltip
<Tooltip
  contentStyle={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
  labelStyle={{ color: '#888' }}
  itemStyle={{ color: '#fff' }}
/>

// Legend
<Legend
  iconSize={8}
  wrapperStyle={{ fontSize: 11, color: '#888888' }}
/>
```

### Metric Card Component Pattern
```tsx
function MetricCard({ label, sub, value, delta, deltaType, progress, progressLabel, icon }) {
  return (
    <div className="card">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div className="metric-label">{label}</div>
          <div style={{ fontSize:11, color:'#666' }}>{sub}</div>
        </div>
        {icon && <div style={{ width:36, height:36, background:'#2a2a2a', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>{icon}</div>}
      </div>
      <div className="metric-value" style={{ marginTop:8 }}>{value}</div>
      {delta && <div className={deltaType === 'up' ? 'delta-up' : 'delta-down'}>{delta}</div>}
      {progress !== undefined && (
        <>
          <div style={{ height:4, background:'#2a2a2a', borderRadius:2, marginTop:8 }}>
            <div style={{ width:`${progress}%`, height:'100%', background:'#ff6b00', borderRadius:2 }} />
          </div>
          <div style={{ fontSize:11, color:'#666', marginTop:4 }}>{progressLabel}</div>
        </>
      )}
    </div>
  )
}
```

### Revenue Hero Card
```tsx
// The only card with a colored background
<div style={{ background:'#ff6b00', borderRadius:12, padding:16, border:'none' }}>
  {/* All text is white. Bar charts use rgba(255,255,255,0.3) and rgba(255,255,255,0.9) */}
</div>
```

### Status Pills (transactions)
```tsx
const STATUS_STYLES = {
  paid:    { background:'#1a3a1a', color:'#4caf50' },
  pending: { background:'#3a2a1a', color:'#ff9800' },
  overdue: { background:'#3a1a1a', color:'#cc4444' },
}

<span style={{ ...STATUS_STYLES[status], padding:'2px 8px', borderRadius:4, fontSize:10, fontWeight:500 }}>
  {status}
</span>
```

### Employee Name Display (detail page)
```tsx
<div>
  <h1 style={{ fontSize:22, fontWeight:500, color:'#ffffff', margin:0 }}>
    {employee.firstName} {employee.lastName}
  </h1>
  <p style={{ fontSize:11, color:'#555555', margin:'2px 0 0 0' }}>
    Legal name: {employee.legalName}
  </p>
</div>
```

### NEVER DO
- Never use a light background on any component
- Never use a color other than #ff6b00 or #cc4444 as an accent
- Never render a chart with a white or light background
- Never show legal name as a primary label — always in muted #555555 beneath preferred name
- Never use border-radius less than 8px on cards or buttons
- Never show admin payroll employee rows to district_manager or branch_manager roles
