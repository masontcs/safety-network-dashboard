# CLAUDE.md — Safety Network Operations Dashboard
## Root Configuration (applies to entire project)

> **ALWAYS read SESSION.md first before anything else.** It contains the current build state and will get you up to speed instantly. It is updated at the end of every work session.

---

## WHAT THIS PROJECT IS

A private, role-scoped operations dashboard for Safety Network management.
Ingests weekly payroll (3 entities), revenue, and fuel (2 vendors) and presents
analytics dashboards locked to each user's assigned branches.

**Three entities:** INC | TCS | STS
**Three businesses:** Safety Network | Western Highways | Signs Fabrication
**Seven revenue-generating branches:** Arroyo Grande, Bakersfield, Fresno, Modesto, Orange County, Sacramento, Visalia

---

## TECH STACK — DO NOT DEVIATE

| Layer | Technology |
|---|---|
| Frontend + Backend | Next.js 14 App Router (TypeScript) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Hosting | Vercel |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) |
| File parsing | xlsx, csv-parse (server-side only) |
| Styling | Tailwind CSS |
| Charts | Recharts |

Never introduce: Redux, Prisma, tRPC, React Query, Zustand, or any ORM.

---

## USER ROLES — FOUR LEVELS

```
admin            → All branches + full employee detail + imports + user management
executive        → All SN branches + full employee detail + full allocation
district_manager → Multiple assigned branches + direct labor detail + admin payroll SUM ONLY
branch_manager   → Single assigned branch + direct labor detail + admin payroll SUM ONLY
```

Role: `public.user_profiles.role`
Branch access: `public.user_branch_assignments` (one-to-many)

---

## EMPLOYEE NAME FIELDS — CRITICAL

Every employee has THREE name-related fields. Understand the distinction:

```
legal_name    → Raw name exactly as imported from QuickBooks. NEVER editable. Used only
                for AI matching. Stored on employee_entity_assignments.raw_name_in_report.

first_name    → Preferred first name. Defaults to auto-split from legal_name on first import.
                Admin can override at any time. This is what shows in the UI.

last_name     → Preferred last name. Same rules as first_name.

display_name  → COMPUTED, never stored. Always: first_name + ' ' + last_name.
                Used everywhere in UI as the employee's name.
```

### Name display rules:
- **Everywhere** (dashboards, tables, reports, review queue, search): show `display_name` = `first_name + ' ' + last_name`
- **Employee detail page**: show preferred name prominently, legal name in small muted text underneath
- **AI matching**: always uses `raw_name_in_report` (legal name) — never the preferred name
- **Import/matching logic**: compares incoming raw names against `raw_name_in_report` only

### Auto-split logic on first import:
QuickBooks exports names as "LAST, FIRST MIDDLE" or "LAST, FIRST".
```
"AGUILAR, MARC A"   → first_name: "Marc", last_name: "Aguilar"
"AGUILAR, OBED G"   → first_name: "Obed", last_name: "Aguilar"
"BETTENCOURT, LUIS A" → first_name: "Luis", last_name: "Bettencourt"
```
Strip middle initials from first_name. Title-case both fields.
If the format is unexpected (no comma), store full name in last_name, leave first_name blank,
and flag for admin review.

---

## PAYROLL VISIBILITY RULES

### Direct Labor (labor_type = 'direct')
All four roles see full employee detail for their accessible branches.

### Admin Payroll (labor_type IN ('admin_hourly', 'admin_salary'))
- admin / executive: full employee detail
- district_manager / branch_manager: **LUMP SUM ONLY** — no names, no rows, single total

### Corp / HQ Overhead
- admin / executive: full detail + allocation breakdown
- district_manager / branch_manager: allocated amount as a single cost line only

The API response shape enforces this — admin payroll returns `{ total: number }` only
(no detail array) for manager roles. This is a security control, not just UX.

---

## BRANCH ACCESS

```
admin / executive    → branchIds = null (no filter, all access)
district_manager     → branchIds = array from user_branch_assignments (2+ branches)
branch_manager       → branchIds = array from user_branch_assignments (exactly 1)
```

---

## NON-NEGOTIABLE SECURITY RULES

- ALL data fetching through Next.js API routes — never from client components
- ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY are SERVER ONLY — never NEXT_PUBLIC_
- RLS is the real security layer — UI filtering is cosmetic
- Every API route: validate session → role → branch access before returning data
- Admin payroll detail NEVER returned to district_manager or branch_manager

---

## FINANCIAL CALCULATION RULES

- `total_revenue = labor + rental + one_time_charges` (sales_tax stored separately, never added)
- `gross_profit = total_revenue - total_payroll - total_fuel`
- `gross_profit_pct = (gross_profit / total_revenue) * 100` — guard division by zero
- Corp allocation: `total_corp_payroll × (branch_revenue / total_sn_revenue)`
- HQ step 1: `sn_hq_share = total_hq_payroll × 0.7813`
- HQ step 2: `branch_hq = sn_hq_share × (branch_revenue / total_sn_revenue)`
- If `total_sn_revenue = 0`: skip allocation, flag period, NEVER divide by zero

---

## PAYROLL DATE RULE

"Week of [date]" in row 2 → subtract 1 day → store as period_date (always a Saturday).
"Week of Mar 29, 2026" → 2026-03-28.

---

## DUPLICATE IMPORT RULE

1. Check for existing import with same identifiers → 409 if found
2. UI shows confirmation modal — do NOT auto-replace
3. On explicit admin confirmation: hard delete previous transactions → re-import
4. Cancelled → abort, no changes

---

## WESTERN HIGHWAYS & SIGNS

Import and tag (business_tag = 'western_highways' or 'signs').
Exclude from all SN dashboard queries (WHERE business_tag IS NULL).
No WH/Signs dashboards in V1.

---

## AI INTEGRATION

- Model: `claude-sonnet-4-20250514` | max_tokens: 1000 (matching), 500 (grouping)
- Non-blocking — never hold up an import for AI results
- AI matching uses legal names (raw_name_in_report) only — never preferred names
- Store suggestions in DB, require human confirmation before acting
- Prompt templates in `/lib/ai/prompts.ts` only

---

## PRE-COMPLETION CHECKLIST

- [ ] RLS tested for all four roles
- [ ] Admin payroll detail never returned to district/branch managers
- [ ] display_name computed as first_name + ' ' + last_name everywhere — never stored
- [ ] Legal name (raw_name_in_report) only used for AI matching, never shown as primary label
- [ ] Employee detail page shows preferred name + legal name underneath
- [ ] Auto-split handles "LAST, FIRST" QuickBooks format correctly
- [ ] District manager blocked from non-assigned branches
- [ ] TypeScript: zero errors (`tsc --noEmit`)
- [ ] No hardcoded branch/entity names in logic

---

## DESIGN SYSTEM — LOCKED

This project uses a dark dashboard aesthetic matching the approved design reference.
Do not deviate from these values. Every UI decision starts here.

### Core Colors
```
Background base:      #111111   (page/app background)
Card surface:         #1e1e1e   (all cards and panels)
Secondary surface:    #2a2a2a   (inputs, pills, icon backgrounds)
Border default:       #2a2a2a   (card borders)
Border emphasis:      #333333   (hover borders, separators)

Accent orange:        #ff6b00   (primary accent — CTAs, highlights, active states, positive deltas)
Accent orange dark:   #cc5500   (hover state on orange elements)
Cost/negative red:    #cc4444   (cost bars, negative deltas, warnings)

Text primary:         #ffffff
Text secondary:       #cccccc
Text muted:           #888888
Text faint:           #555555   (axis labels, timestamps)
```

### The One Rule on Color
Orange (#ff6b00) is the ONLY accent color. It is used for:
- Active nav items and sidebar icons
- Positive delta indicators (↑ 18.6%)
- Progress bar fills
- Chart bars for revenue (primary metric)
- Icons in metric cards
- CTA buttons and arrow buttons
- Branch names in tables (orange text = clickable/highlighted)
- The hero Revenue card background

Red (#cc4444) is used ONLY for:
- Cost/expense bars in charts (fuel, payroll as cost)
- Negative delta indicators (↓ -2.1%)
- Never for UI chrome

Everything else is a shade of dark gray.

### Hero Revenue Card
The top-left revenue card has a FULL orange (#ff6b00) background.
All text on it is white. Bar charts use rgba(255,255,255,0.3) for previous months
and rgba(255,255,255,0.9) for the current month.
This is the only card with a colored background — all others are #1e1e1e.

### Typography
```
Font:             var(--font-sans) / system-ui
Page title:       22px, weight 500, #ffffff
Section title:    14px, weight 500, #ffffff
Card label:       11px, weight 400, #888888, uppercase, letter-spacing 0.04em
Card sub-label:   11px, weight 400, #666666
Card value:       26px, weight 500, #ffffff (hero card: 28px)
Delta positive:   11-12px, #ff6b00
Delta negative:   11-12px, #cc4444
Table header:     11px, weight 400, #666666
Table body:       12px, weight 400, #cccccc
Muted/legal text: 11px, #555555 (used for legal names under preferred names)
```

### Cards
```css
background: #1e1e1e;
border-radius: 12px;
border: 1px solid #2a2a2a;
padding: 16px;
```

### Top Nav Bar
```css
background: #1a1a1a;
border-bottom: 1px solid #2a2a2a;
height: 48px;
```
Active nav item: orange pill background (#ff6b00), white text.
Inactive: #999999 text, transparent background.

### Sidebar
```css
width: 48px;
background: #1a1a1a;
border-right: 1px solid #2a2a2a;
```
Active icon: #ff6b00 background, white icon.
Inactive icon: #666666 icon, transparent background, hover → #2a2a2a bg + #ff6b00 icon.

### Progress Bars (% of Revenue indicators)
```css
track:  height 4px, background #2a2a2a, border-radius 2px
fill:   background #ff6b00, border-radius 2px
```

### Donut Chart (Profit Margin)
Outer ring: #2a2a2a (empty). Fill ring: #ff6b00.
Center text: percentage in white, "Margin" label in #888888.

### Sparklines (side cards)
Single line, stroke #ff6b00, stroke-width 1.5, no fill, no axes.

### Waterfall Chart (Profit Breakdown)
Revenue bar: #ff6b00 (tall, full height)
Cost bars (fuel, payroll, other): #cc4444 at 80% opacity
Net profit bar: #ff6b00 at 70% opacity with dashed border
Values above bars: white for positive, #aaaaaa for negative in parentheses

### Status Pills (transactions table)
```
Paid:    background #1a3a1a, color #4caf50, border-radius 4px, padding 2px 8px
Pending: background #3a2a1a, color #ff9800
```

### Three-dot menu (card overflow)
Three 3px circles at #555555. Always positioned top-right of card.

### Icon Buttons / Mini Icons
```css
width: 36px; height: 36px;
background: #2a2a2a;
border-radius: 8px;
icon color: #ff6b00;
```

### Orange Arrow Button (Open Invoices card)
```css
width: 32px; height: 32px;
background: #ff6b00;
border-radius: 8px;
arrow icon: white;
```

### Date Pill / Filter Button
```css
background: #2a2a2a;
border: 1px solid #333333;
border-radius: 8px;
padding: 5px 12px;
font-size: 12px;
color: #cccccc;
```

### Dashboard Grid Layout
```
Top row:    1.4fr 1fr 1fr 1fr   (revenue hero + 3 metric cards)
Middle row: 1.1fr 1fr 0.7fr    (performance chart + profit breakdown + 3 side cards)
Bottom:     full width          (transactions table)
Gap:        12px everywhere
```

### Employee Detail Page — Name Display
```
Preferred name:  font-size 22px, weight 500, color #ffffff
Legal name line: font-size 11px, color #555555
                 "Legal name: LAST, FIRST M"
                 Positioned immediately below preferred name, no margin
```

### Branch Names in Tables
Branch names are always rendered in #ff6b00 — they are the primary
navigational element and the orange color signals "clickable / filterable."
