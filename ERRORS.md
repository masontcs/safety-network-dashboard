# CLAUDE.md — ERRORS
## Error Handling Standards

Consistent, predictable error handling across every layer of the stack.

---

## CORE PRINCIPLE

Errors have two audiences:
1. **Developers** — need full detail: stack trace, DB error, file name, line number
2. **Users** — need actionable guidance: what happened, what to do next

Never show developer errors to users. Never hide errors from developers.

---

## ERROR TYPES

```typescript
// Define these in /lib/utils/errors.ts

class AppError extends Error {
  constructor(
    public message: string,         // user-facing message
    public code: string,            // machine-readable code
    public status: number,          // HTTP status
    public detail?: string          // developer detail (never sent to client)
  ) { super(message) }
}

// Subclasses for common cases
class ParseError extends AppError {
  constructor(detail: string) {
    super('The file could not be parsed. Please check the format and try again.', 'PARSE_ERROR', 400, detail)
  }
}

class AuthError extends AppError {
  constructor() {
    super('You are not authorized to perform this action.', 'UNAUTHORIZED', 403)
  }
}

class DuplicateImportError extends AppError {
  constructor(public conflictData: ConflictData) {
    super('An import already exists for this period.', 'DUPLICATE_IMPORT', 409)
  }
}

class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found.`, 'NOT_FOUND', 404)
  }
}
```

---

## API ROUTES — ERROR HANDLING PATTERN

```typescript
// /lib/utils/api.ts
export function apiError(error: unknown): NextResponse {
  // Log full detail server-side always
  console.error('[API Error]', error)

  if (error instanceof AppError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status }
    )
  }

  // Unknown error — do not leak details
  return NextResponse.json(
    { success: false, error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' },
    { status: 500 }
  )
}

// Usage in every API route
export async function POST(request: Request) {
  try {
    // ... route logic
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return apiError(error)
  }
}
```

---

## FILE PARSERS — ERROR HANDLING PATTERN

Parsers return structured results — they never throw for data issues:

```typescript
type ParseResult<T> =
  | { success: true; data: T; warnings: string[] }
  | { success: false; error: string; warnings: string[] }

// Usage
const result = await parsePayrollFile(buffer, 'INC')
if (!result.success) {
  // Return 400 to the user with result.error
  throw new ParseError(result.error)
}
// Proceed with result.data
// Log result.warnings if any
```

Only throw from parsers for truly unexpected runtime errors (out of memory, etc.).
Use `{ success: false, error: string }` for all expected failure cases.

---

## DATABASE ERRORS — HANDLING PATTERN

```typescript
const { data, error } = await supabase.from('payroll_transactions').select('...')

if (error) {
  // Log with context
  console.error('[DB Error] payroll_transactions query failed:', {
    message: error.message,
    code: error.code,
    hint: error.hint,
  })
  // Throw AppError — never expose raw Supabase error to client
  throw new AppError('Failed to retrieve payroll data.', 'DB_ERROR', 500, error.message)
}

if (!data || data.length === 0) {
  // Not an error — return empty state
  return { success: true, data: [] }
}
```

---

## CLIENT-SIDE — ERROR HANDLING PATTERN

```typescript
// Every fetch in a client component needs error handling
async function fetchPayrollSummary(params: Params) {
  try {
    const res = await fetch(`/api/payroll/summary?${new URLSearchParams(params)}`)
    const json = await res.json()

    if (!res.ok || !json.success) {
      setError(json.error ?? 'Failed to load payroll data')
      return
    }

    setData(json.data)
  } catch (err) {
    // Network error
    setError('Unable to connect. Please check your connection and try again.')
    console.error('Fetch error:', err)
  }
}
```

UI for errors: always show an error message with a Retry button. Never show a blank state for errors.

---

## IMPORT-SPECIFIC ERRORS

Imports have specific user-facing error messages for each failure mode:

| Situation | User sees |
|---|---|
| File is wrong format | "This file doesn't match the expected format for [type] imports. Please check you selected the right file." |
| File is corrupt/unreadable | "The file could not be opened. Please try re-exporting from QuickBooks." |
| Date not found in file | "Could not find the pay period date in this file. Expected 'Week of [date]' in row 2." |
| Duplicate period | "A [Entity] payroll import for [Date] already exists. Would you like to replace it?" |
| No employees found | "No employee data was found in this file. The file may be empty or formatted incorrectly." |
| Unknown company code | "Unrecognized company code '[CODE]' found in revenue file. This row was skipped." |

These messages appear in the import UI, not just in console logs.

---

## LOGGING STANDARDS

```typescript
// Use structured logging with consistent prefix tags
console.error('[API Error]', { route, error, userId })
console.warn('[Parse Warning]', { file, warning, row })
console.info('[Import]', { entity, periodDate, employeeCount, duration })

// Never log:
// - Passwords, tokens, API keys
// - Full payroll records (financial PII)
// - Full employee records
```

---

## WHAT NEVER TO DO

- Never swallow errors silently (`catch (e) {}`)
- Never show stack traces to users
- Never show raw DB error messages to users
- Never throw inside a `.map()` or `.forEach()` — the error won't be caught properly; collect errors and throw after
- Never use `process.exit()` — let Next.js/Vercel handle crashes

---

## VERIFICATION CHECKLIST

- [ ] Every API route is wrapped in try/catch using `apiError()`
- [ ] No raw Supabase errors returned to clients
- [ ] Parsers return `{ success: false, error }` for all expected failures
- [ ] Client components show error state + retry button (never blank on error)
- [ ] Import errors have user-friendly messages per the table above
- [ ] No `catch (e) {}` empty catches anywhere (grep: `catch.*\{\s*\}`)
- [ ] Secrets never appear in log output
