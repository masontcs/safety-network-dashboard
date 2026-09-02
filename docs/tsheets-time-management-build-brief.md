# Time Management + TSheets Export + Shift Dispatch — Build Brief

Status: **DRAFT — final review.** Ready to start Phase A on Mason's go-ahead.
Author: Claude · Updated: 2026-08-26

Three interlocking pieces:
- **A. Time Management + TSheets export** — approval layer between tech-submitted times and the export file.
- **B. Shift dispatch (staging → publish)** — the dispatch unit; publishing creates tickets + crew and notifies techs.
- **C. Times single-source-of-truth** — techs enter once; times appear on the ticket and in Time Management; **admins edit only in Time Management**.

---

## 1. Goal

Times now serve **billing** (already wired) and **payroll** (new). Nothing exports until a branch approver signs off. The export CSV matches the existing TSheets format **exactly** — no new columns.

## 2. Decisions locked

| Topic | Decision |
|---|---|
| Payroll math (OT/DT/PW) | QB/TSheets computes. We export clean, dated, classified punches + flags. |
| Approval ↔ ticket lifecycle | Separate parallel track: independent time-approval status + note on the ticket. |
| PW | Job attribute (auto). Transit = driver, so PW-eligible; riders log Passenger Travel. |
| Job number in note | Our job number (`…BKJ`). |
| Yard jobcode (col 5) | `SAFETY NETWORK TRAFFIC SIGNS, INC.` |
| Billable | Everything except **Admin** and **Yard** (those export `Billable = No`). |
| Per Diem | Yes/no flag, no dollar; rolls into a weekly payout list; may be pre-approved at dispatch. |
| Approver scope | Per-branch for everyone, admins included — no implicit override. |
| Export filename | `tsheets_daily_<branch>_<workdate>_exported-<YYYYMMDD-HHMM>.csv` |
| Job Type | Multiselect (list in §10). |
| Timeline | A **plan only** — does not pre-seed time entries. |
| Tech acceptance | **Acknowledgement**, no real decline. |
| Time edits (admin) | **Only in Time Management**, never from the ticket. |
| 4-10 schedule | Job attribute; shown to techs on accept **and** injected into the export note. |
| Meal type | **Standard Lunch** default; dispatcher sets per shift. |

## 3. Export format (decoded from `tsheets_daily_STS_2026-08-03.csv`)

10 double-quoted columns, one row per entry:

| # | Column | Value |
|---|---|---|
| 1 | `username` | Tech's name |
| 2 | `in_time` | `MM/DD/YYYY hh:mm am/pm` |
| 3 | `out_time` | `MM/DD/YYYY hh:mm am/pm` |
| 4 | `tz` | `-8` |
| 5 | `jobcode` | QB name of the billing profile. Yard = `SAFETY NETWORK TRAFFIC SIGNS, INC.` |
| 6 | `notes` | Composed note (grammar below) |
| 7 | `custom field name` | `Billable` |
| 8 | `custom field value` | `Yes` for Labor/Transit; `No` for Yard/Admin |
| 9 | `custom field name` | `Service Item` |
| 10 | `custom field value` | Activity export string (e.g. `LABOR-FIELD TIME`) |

**Notes grammar (final):**

```
<activity keyword> | <our job number> [| <shift schedule label>] [| PW] [| <tech note>] [| OVERNIGHT SHIFT (part x of y)]
```

Auto-inserted: activity keyword; the schedule label (e.g. `10-Hour Shift (4-10 Schedule)`) when the job has one; `PW` for PW jobs; `OVERNIGHT SHIFT (part x of y)` on a midnight split. The tech's free text sits between those.

**Overnight split:** crossing midnight → two rows; part 1 ends `11:59 pm` (start date), part 2 starts `12:00 am` (next date); tagged `(part 1 of 2)` / `(part 2 of 2)`.

**File scope:** one export = one branch, one day, approved entries only.

## 4. Activities & jobcodes

| Tech-facing | Note keyword | Service Item | Exported? | Paid? | Billable? | PW-eligible? |
|---|---|---|---|---|---|---|
| Labor | `labor` | `LABOR-FIELD TIME` | Yes | Yes | Yes | Yes |
| Transit | `transit` | `TRANSIT TIME` | Yes | Yes | Yes | Yes (driver) |
| Yard Time | `yard` | `YARD TIME` | Yes | Yes | No | No |
| Admin | `admin` | `ADMIN TIME` | Yes | Yes | No | No |
| Passenger Travel | — | — | No | No | No | No |
| Lunch break | — | — | No | No | No | No |
| Break | — | — | No | No | No | No |

Migration keeps existing rows: **Onsite → Labor**, **Yard → Yard Time** (same IDs); new rows for the rest.

## 5. Data model changes

**Feature A / C:**
- `billing_profiles.qb_name` (text) + profile-page editor.
- `billing_activity_types` — add `note_keyword`, `service_item`, `exported`, `paid`, `billable`, `pw_eligible`, `sort_order`; expand to seven.
- `billing_ticket_labor.work_date` + `billing_yard_time.work_date` (date, defaults to ticket/shift date).
- `billing_jobs.prevailing_wage` (bool); `billing_jobs.shift_schedule` (text label, e.g. `10-Hour Shift (4-10 Schedule)`, nullable).
- `billing_per_diem` (technician_id, date, branch_id, status `pending|paid`, pre_approved_by, paid_at).
- `billing_time_approvals` (technician_id, branch_id, work_date, status `submitted|returned|approved`, note, approved_by, updated_at).
- `billing_time_approvers` (user_id, branch_id) — governs all users incl. admins.

**Feature B (Shift):**
- `billing_shifts` (id, job_id **nullable** (null = yard), branch_id, shift_date, status `staged|published`, meal_type `standard|odmp`, per_diem_preapproved bool, traffic_plan_path, created_by, published_at, ticket_id nullable).
- `billing_shift_job_types` (shift_id, job_type) — multiselect.
- `billing_shift_timeline` (shift_id, sort_order, at_time, activity_type_id) — the plan (time + activity, no free text).
- `billing_shift_crew` (shift_id, technician_id, is_lead, acknowledged_at) — crew before publish; acknowledgement tracking.

## 6. Times: single source of truth (Feature C)

- Techs enter times in the tech app → written to `billing_ticket_labor` (ticket) / `billing_yard_time` (yard). These records **are** the source.
- The ticket's Labor tab and the Time Management page both **read** them.
- The ticket Labor tab becomes **read-only for admins** (no add/edit/delete of time there) — a note points to Time Management. Techs still enter via the tech app.
- All admin adjustments happen in **Time Management**, because they drive payroll.

## 7. Approval workflow (Feature A)

1. Tech submits the day's times.
2. Ticket(s) show **In review** + note "times: submitted" (parallel track; billing status untouched).
3. Branch approver reviews that branch's days per tech in **Time Management**.
4. **Approve** → export-eligible, note "times: approved". **Return to adjust** → back to tech with a note, "times: returned".
5. Editing after submit resets status; tickets reflect it.
6. Only **approved** entries export. Approver rights require a per-branch grant (everyone, incl. admins).
7. Live via the existing `billing` broadcast channel.

## 8. Export generator

- One CSV per branch per day, approved entries only, exact 10-column format, note grammar, overnight split.
- Filename `tsheets_daily_<branch>_<workdate>_exported-<YYYYMMDD-HHMM>.csv`.
- Download from Time Management.

## 9. Payroll posture

No OT/DT/PW math here. We guarantee correct per-entry dates (incl. overnight), correct classification (paid/unpaid, billable/non-billable), PW flagged, clean punches. QB applies CA wage rules.

## 10. Shift dispatch (Feature B)

Most shift data comes from the **Job** (customer, job info, address, base notes, entity/branch, PW, 4-10 schedule). **Manual per-shift fields:**

- **Job Type** (multiselect): Set & go · Lane Closure · Shoulder Closure · Turn Pocket Closure · Double Lane Closure · Job Meeting · Flagging · Pre Stage · Job Check · CAS · USA · No Parking Signs · Maintain · Road Closure · Deliver Equipment · Pickup Equipment · CalTrans.
- **Techs + Lead** — assign crew, mark one lead.
- **Timeline** — ordered (time, activity type) rows, no free text. A plan the tech sees; does **not** create time entries.
- **Traffic plan** — file upload, visible to techs.
- **Meal Type** — Standard Lunch (default) or Approved ODMP (No Lunch Required); tech must acknowledge before accepting.
- **Per Diem pre-approved** — toggle.

**Staged vs Published:**
- **Staged** = draft. No ticket, no notification, fully editable.
- **Published** = creates the ticket (job shift) and copies crew → `billing_ticket_assignments`; sends the shift to each tech to **acknowledge**. Yard shifts publish without a ticket (unless prepping for a job, where a ticket may be created to hold yard time).

**Acceptance** = acknowledgement only (accept/decline shown, but decline isn't allowed) — records `acknowledged_at` so we know they saw meal type, 4-10 schedule, and traffic plan. Accepting the shift is also how they accept the ticket.

**Relationship to today's dispatch:** the staged-shift flow **absorbs** the current assign dialog (assign existing / job→ticket / yard) — publishing is what creates tickets and adds crew, now with the richer fields. The board displays shifts/assignments.

## 11. Build order

- **Phase A** — migrations + `database.types.ts` (all of §5), expand-contract safe; rename Onsite→Labor / Yard→Yard Time.
- **Phase B** — Shift model + staging/publish API; dispatch UI (job type multiselect, lead, timeline builder, traffic-plan upload, meal type, per-diem pre-approve, stage/publish).
- **Phase C** — Tech app: acknowledge shift (meal type + schedule + plan + traffic plan); new 7-activity picker; overnight per-entry date.
- **Phase D** — Time Management page: branch/day/tech review, approve / return-to-adjust, admin time edits, per-diem weekly payout list, approver grants admin.
- **Phase E** — Ticket changes: Labor tab read-only for admins + time-approval status/note (live).
- **Phase F** — Export generator (branch/day CSV, note grammar, overnight split, approved-only, download).
- **Phase G** — Verify: unit-test note composer + overnight splitter against the real sample; end-to-end stage→publish→acknowledge→enter→approve→export on staging.

## 12. Remaining minor confirmations — RESOLVED

1. Display labels: the **4-10 schedule** (`10-Hour Shift (4-10 Schedule)`), plus **PW** and **ODMP** — the latter two already exist as the job PW flag and the meal type, surfaced as badges to techs on shift acceptance.
2. Traffic-plan upload — **multiple files** per shift.
