# CLAUDE.md — STANDARDS
## Next.js + TypeScript + Supabase Engineering Standards

These rules apply to every file in this project regardless of which feature is being built.

---

## TYPESCRIPT

### Strictness
- `tsconfig.json` must have `"strict": true` — never relax this
- No `any` types — use `unknown` and narrow it, or define a proper type
- No `// @ts-ignore` or `// @ts-expect-error` without a written explanation in the same comment
- No type assertions (`as SomeType`) unless you have verified the shape — add a comment explaining why it's safe

### Naming Conventions
```typescript
PascalCase    → types, interfaces, components, classes
camelCase     → variables, functions, hooks
SCREAMING_SNAKE_CASE → constants
kebab-case    → file names (e.g. payroll-summary.ts)
```

### Types over Interfaces for data shapes
```typescript
// Prefer type aliases for data shapes
type PayrollSummary = { ... }

// Use interfaces only when you need extension/implementation
interface PayrollParser { parse(buffer: Buffer): Promise<ParseResult> }
```

### Enums — avoid, use const objects instead
```typescript
// Bad
enum Role { Admin = 'admin', Executive = 'executive' }

// Good
const ROLES = { ADMIN: 'admin', EXECUTIVE: 'executive' } as const
type Role = typeof ROLES[keyof typeof ROLES]
```

---

## NEXT.JS APP ROUTER

### Server vs Client components
- Default to Server Components — only add `'use client'` when you need browser APIs, event handlers, or hooks
- Never fetch data in client components — use Server Components or API routes
- Keep client components small and focused on interactivity only

### File organization
```
page.tsx        → Server component, handles data fetching
layout.tsx      → Shared layout, authentication guard
loading.tsx     → Automatic Suspense fallback (skeleton)
error.tsx       → Error boundary for this route
components/     → Client components for this route's UI
```

### Data fetching patterns
```typescript
// Server Component — direct
const data = await fetch('/api/...', { cache: 'no-store' })

// Client Component — SWR pattern
const [data, setData] = useState(null)
useEffect(() => { fetch('/api/...').then(r => r.json()).then(setData) }, [deps])
```

### Route handlers
```typescript
// /app/api/example/route.ts
export async function GET(request: Request) {
  // Always return NextResponse.json()
  return NextResponse.json({ success: true, data: result })
}
```

---

## COMPONENT PATTERNS

### Props — always typed, never `any`
```typescript
type SummaryCardProps = {
  title: string
  value: number
  trend?: number
  isLoading?: boolean
}

export function SummaryCard({ title, value, trend, isLoading = false }: SummaryCardProps) { ... }
```

### Conditional rendering — be explicit
```typescript
// Bad — falsy 0 renders "0" in JSX
{count && <Badge>{count}</Badge>}

// Good
{count > 0 && <Badge>{count}</Badge>}
```

### Lists — always use stable keys
```typescript
// Bad
{items.map((item, i) => <Row key={i} ... />)}

// Good
{items.map(item => <Row key={item.id} ... />)}
```

---

## SUPABASE PATTERNS

### Never use `select *`
```typescript
// Bad
const { data } = await supabase.from('payroll_transactions').select('*')

// Good
const { data } = await supabase
  .from('payroll_transactions')
  .select('id, employee_id, period_date, amount, payroll_code_id')
```

### Always handle errors
```typescript
const { data, error } = await supabase.from('...').select('...')
if (error) throw new Error(`DB query failed: ${error.message}`)
if (!data) throw new Error('No data returned')
```

### Use RPC for multi-table operations
```typescript
// Multi-step operations that must be atomic → use Supabase RPC (PostgreSQL function)
const { error } = await supabase.rpc('replace_payroll_import', {
  p_old_import_id: oldId,
  p_new_data: newData
})
```

---

## FINANCIAL FORMATTING

```typescript
// Always format currency the same way across the app
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

// Always format percentages the same way
function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

// Never use toFixed() for arithmetic — only for display
// For arithmetic rounding: Math.round(val * 100) / 100
```

---

## DATE HANDLING

Always use `date-fns`. Never use raw JS Date arithmetic.

```typescript
import { subDays, format, parseISO, startOfMonth, startOfYear } from 'date-fns'

// Period date from report
const periodDate = subDays(parseDate(reportDate), 1)

// Validate it's a Saturday
if (getDay(periodDate) !== 6) throw new Error('Period date is not a Saturday')

// Always store dates as ISO strings in state/API
const isoDate = format(date, 'yyyy-MM-dd')
```

---

## CODE ORGANIZATION

- One exported component/function per file (default export for components, named for utilities)
- File length limit: 200 lines — if a file exceeds this, split it
- No commented-out code — use git history instead
- No console.log in committed code — use a logger utility
- Constants at the top of the file or in a `/lib/constants.ts` file

---

## VERIFICATION CHECKLIST

Run these before any commit:
- [ ] `tsc --noEmit` — zero TypeScript errors
- [ ] `eslint .` — zero linting errors  
- [ ] No `any` types introduced (grep: `grep -r ": any" src/`)
- [ ] No `select *` in Supabase queries (grep: `.select('*')`)
- [ ] No `console.log` in committed code
- [ ] All new components have typed props
- [ ] All Supabase queries handle the error case
