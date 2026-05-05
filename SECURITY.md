# CLAUDE.md — SECURITY
## Security Standards for Auth, API, and Data Access

These rules are non-negotiable and apply to every route, component, and query.

---

## AUTHENTICATION

### Session validation
Every API route must validate the session as its first action:
```typescript
const { data: { session } } = await supabase.auth.getSession()
if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
```

Never trust session data embedded in the request body or headers from the client.
Always re-fetch the session server-side using the Supabase server client.

### Server-side Supabase client
```typescript
// For API routes — use service role, enforce access manually
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// For Server Components — use the cookie-based client
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
const supabase = createServerComponentClient({ cookies })
```

Never use the anon key in API routes — use the service role key.
Never use the service role key in client components or NEXT_PUBLIC_ env vars.

---

## AUTHORIZATION — DEFENSE IN DEPTH

Three layers of protection. All three must be in place.

### Layer 1: Middleware (route-level)
```typescript
// middleware.ts — protect all dashboard routes
export function middleware(request: NextRequest) {
  const session = getSession(request)
  if (!session) return redirect('/login')
  // Redirect to correct dashboard if on wrong role's route
}
export const config = { matcher: ['/admin/:path*', '/executive/:path*', '/district/:path*', '/manager/:path*'] }
```

### Layer 2: RLS (database-level)
Supabase Row Level Security policies on every table. These cannot be bypassed by
application code — they are enforced at the database level.
See /supabase/CLAUDE.md for the full policy patterns.

### Layer 3: API route checks (application-level)
Every API route explicitly checks role and branch access before executing any query.
RLS is the safety net — the API check is the primary gate.

**If RLS and API checks seem redundant, that is intentional.**
A bug in one layer does not compromise security if the other layer is correct.

---

## SECRETS MANAGEMENT

```
NEVER in client code:
  SUPABASE_SERVICE_ROLE_KEY
  ANTHROPIC_API_KEY
  Any database password or connection string

SAFE to expose (NEXT_PUBLIC_ prefix):
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY

Verification:
  grep -r "SERVICE_ROLE" app/     → must return 0 results
  grep -r "ANTHROPIC_API" app/    → must return 0 results
  grep -r "SERVICE_ROLE" components/  → must return 0 results
```

Never log secrets. Never include secrets in error messages.
Never commit `.env` files — only `.env.example` with placeholder values.

---

## INPUT VALIDATION

Validate ALL inputs at the API boundary before any processing:

```typescript
// Validate file uploads
if (!file || file.size === 0) return error('No file provided', 400)
if (file.size > 10_000_000) return error('File too large (max 10MB)', 400)

const ALLOWED_EXTENSIONS = { payroll: ['xlsm'], revenue: ['xls'], fuel: ['csv', 'xlsx'] }
const ext = file.name.split('.').pop()?.toLowerCase()
if (!ALLOWED_EXTENSIONS[type].includes(ext)) return error('Invalid file type', 400)

// Validate UUIDs before DB queries
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
if (!UUID_REGEX.test(branchId)) return error('Invalid branch ID', 400)

// Validate dates
const date = parseISO(periodDate)
if (!isValid(date)) return error('Invalid date format', 400)
```

Never pass user input directly into SQL queries — always use Supabase parameterized queries.

---

## PAYROLL DATA SENSITIVITY

The admin payroll sum rule is a security control, not just a UX choice.
District and branch managers must never receive individual admin employee payroll data.

Enforcement checklist:
- [ ] RLS policy blocks admin payroll rows for district_manager and branch_manager
- [ ] API route returns only `{ total: number }` for admin payroll to these roles (no detail array)
- [ ] Employee detail endpoint returns 403 for admin-coded employees when role is manager
- [ ] No client-side filtering of payroll rows — the data must never reach the client in the first place

---

## FILE UPLOAD SECURITY

- Parse files server-side only — never process uploaded files in browser/client code
- Do not trust the file's MIME type from the client — validate by extension and by attempting to parse
- Reject files that fail to parse rather than trying to handle corrupt data
- Do not store raw uploaded files — parse and discard the buffer after extraction
- Maximum file size: 10MB per upload

---

## API RATE LIMITING

Protect import endpoints from abuse:
```typescript
// Simple in-memory rate limit for import routes
// Allow max 10 import requests per user per hour
// Implement via Supabase edge function or Vercel middleware
```

---

## ERROR MESSAGES — NEVER LEAK INTERNALS

```typescript
// Bad — leaks schema/implementation details
return error(`relation "payroll_transactions" does not exist`, 500)

// Good — generic message, log the real error server-side
console.error('DB error:', err)
return error('An internal error occurred. Please try again.', 500)
```

Log full error details server-side. Return generic messages to the client.

---

## CORS

Next.js API routes are same-origin by default. Do not add permissive CORS headers.
If you need to open an endpoint to another origin, require explicit justification.

---

## VERIFICATION CHECKLIST

- [ ] No server secrets in NEXT_PUBLIC_ env vars
- [ ] No secrets in client components (grep check above)
- [ ] Middleware protects all dashboard routes
- [ ] Every API route validates session before any logic
- [ ] RLS enabled on all tables
- [ ] Admin payroll data never reaches manager-role clients
- [ ] File uploads validated by extension and parse attempt
- [ ] Error messages don't leak DB schema or internal details
- [ ] No raw user input in DB queries
- [ ] `.env` files in .gitignore, `.env.example` committed instead
