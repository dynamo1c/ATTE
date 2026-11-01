# MEI Polytechnic — Attendance, Marks & Parent Alerts System

Living spec. Last updated 2026-10-31. Items marked **[OPEN]** wait on the college.

---

## 1. Context

- **College:** MEI Polytechnic, Rajajinagar, Bengaluru-10. Aided by DTE Karnataka (Department of Collegiate and Technical Education), AICTE approved.
- **Departments (7):** CE Civil, CS Computer Science, EE Electrical & Electronics, EC Electronics & Communication, EI Electronics Instrumentation & Control, ME Mechanical, CG Cloud Computing.
- **Structure:** 3-year diploma = 6 semesters. 1 section per department per year. Each class is split into 2 batches (B1, B2).
- **Terms:** Odd term (sem 1, 3, 5) and even term (sem 2, 4, 6) run in parallel across years. Current: odd semester 2026-27.
- **Status:** Official college project. Prototype/demo phase now, under the student developer's name. Handed to a college lecturer for maintenance later.

### Register number

`204CS25012` = college `204` + department `CS` + admission year `25` + allotted roll `012`.

- Validation: `^204(CE|CS|EE|EC|EI|ME|CG)\d{2}\d{3}$` (college code configurable).
- The register number is the student's permanent ID. It never changes.
- **Important:** the year inside the register number is the *admission* year, not the current class. A detained student (year back) or a lateral-entry student sits in a class whose admission year differs. So class membership is stored separately and never derived from the register number at runtime. It is only used as a default during import.

---

## 2. What the CS timetable told us

Source: `Time Table of Odd sem 1,3,5.pdf` (CS, 2026-27).

| Fact | Impact on design |
|---|---|
| Periods: 9–10, 10–11, 11–12, 12–1, lunch, 1:30–2:30, 2:30–3:30, 3:30–4:30. Saturday till 1 pm. | Period grid is configurable per college, not hardcoded. |
| **Theory classes are also split by batch** (e.g. Wed 10–11: MATHS (B1) and BDLCO (B2) in parallel). Some slots are whole class (MATHS Tue 9–10, EVS). | Every timetable slot targets ALL, B1 or B2. Attendance % only counts sessions the student was supposed to attend. |
| Labs span 2–3 periods (e.g. Fri 1:30–4:30). | A lab block = **one session = one attendance**, whatever its length (confirmed). |
| Each main subject has theory + lab sessions (Sem I: Maths, BDLCO, FEEE, IT Skills; Sem III: DSP, S&NA, DC&T, CN). 5th subject is theory-only (EVS, Kannada, English). | Subject = one course with components (theory, practical). Matches "4 internals: 2 theory + 2 practical + final". |
| "ACTIVITY PERIOD" slots. | Not an academic subject. **[OPEN]** Track attendance for these or not? Default: not tracked. |
| **Sem V is "Programme Specialization (Cyber Security)" all day, every day.** | Sem V does not fit the 5-subject pattern. Model must allow any number of courses per semester with any assessment scheme. **[OPEN]** see §14. |
| Timetable is signed by HOD + Principal per semester. | Timetables are versioned with an effective-from date. Mid-semester changes create a new version and never rewrite past attendance. |

Rule that follows: **nothing about "5 subjects", "4 internals" or "2 batches" is hardcoded.** These are default *templates*. Data drives everything, so Sem V, Sem VI or a future syllabus change needs zero code changes.

---

## 3. Users & roles

| Role | Scope | Can do |
|---|---|---|
| Admin | Whole college | Everything: setup, users, calendar, imports, message settings, audit log |
| Principal | Whole college | View all dashboards & reports, approve escalations, broadcast notices |
| HOD | Own department | Manage department subjects, timetables, faculty assignment; approve late edits & leaves; see compliance |
| Faculty | Assigned subject + batch combos | Mark attendance, enter marks for their assessments, view their classes |
| Class teacher | One class (dept + semester) | Everything faculty can for that class + leave/OD entry, student/parent contact edits, class reports |
| Parent | Own child(ren) | View attendance + marks, receive WhatsApp/SMS |

- Roles are **scoped grants** (user × role × scope). One person can be faculty for 3 subjects *and* class teacher of CS Sem 3 *and* HOD.
- Students get no login for now (may be added later; design keeps it possible).

### Login

- **Staff:** phone number + password (demo). Phone + OTP added once a message provider exists. Forced password change on first login. Rate-limited, lockout after repeated failures.
- **Parents:** register number + phone number. Phone must match a number already on record for that student, then OTP to that phone. No match = no access (otherwise anyone who knows a register number could see a child's data).
- One phone can be linked to several students (siblings). Parent sees all their children.
- Phones stored normalized (`+91XXXXXXXXXX`, 10 digits starting 6–9).

---

## 4. Data model (core entities)

```
College ─ settings (college code, period grid, thresholds, message settings)
AcademicYear (2026-27) ─ Term (ODD/EVEN, start/end dates)
Department (code, name)
Class            = department + semester + term   (e.g. CS Sem 3, Odd 2026-27)
Student          (reg_no, name, gender, dob, status, admission_year, lateral_entry)
ClassMembership  (student, class, batch B1/B2)    ← where the student sits this term
ParentContact    (student, phone, relation, preferred_language, whatsapp_ok, consent_at)  up to 2+ per student
Course           (code, name, dept, semester, kind: INTEGRATED | THEORY_ONLY | SPECIALIZATION | ...)
CourseOffering   (course, class)                   ← the subject running this term
TeachingAssignment (offering, component THEORY/PRACTICAL, batch ALL/B1/B2, faculty)
TimetableVersion (class, effective_from, approved_by)
TimetableSlot    (version, weekday, start_period, end_period, offering, component, batch, room)
CalendarDay      (date, type: WORKING | HOLIDAY | EXAM | EVENT, follows_weekday?, note)
ClassSession     (offering, component, batch, date, start/end, status, faculty_actual, source)
AttendanceRecord (session, student, status, marked_by, marked_at, client_op_id)
LeaveNotice      (student, from_date, to_date, type, counts_as, approved_by, document)
AssessmentScheme (course kind → list of components with max marks + formula)
Assessment       (offering, kind CIE_T1/CIE_T2/CIE_P1/CIE_P2/SEE_T/SEE_P, max, date, status)
Mark             (assessment, student, value | AB | MP, entered_by)
Notification     (outbox row: recipient, template, payload, channel, status, attempts, provider_id)
AuditLog         (who, when, entity, before, after, reason)
```

Key constraints (enforced in the database, not just code):

- `UNIQUE(session_id, student_id)` on attendance: no duplicate marks.
- `UNIQUE(student_id, class_id)` on membership; one active class per student per term.
- `UNIQUE(reg_no)`; check constraint on format.
- Marks: `CHECK (value BETWEEN 0 AND max)`.
- Foreign keys everywhere; no orphan rows.
- Soft delete only for students/staff; history stays intact.

---

## 5. Attendance

### 5.1 Sessions

- Each night (and on demand), the system generates **ClassSession** rows for each class from: active timetable version + calendar.
- Holiday ⇒ no sessions. "Saturday follows Monday timetable" ⇒ calendar `follows_weekday = MON`.
- Faculty can also add an **extra class** (ad-hoc session) and mark a scheduled class as **Not held** (teacher absent, event, etc.). Not-held sessions never count in percentages.
- **Substitute:** any faculty of the department can mark a session. The real marker is recorded; the subject teacher sees it.

### 5.2 Statuses

| Status | Counts as | Notes |
|---|---|---|
| Present | present | Default |
| Absent | absent | |
| Late | present | Separate button, recorded as late (confirmed) |
| On Duty (OD) | **[OPEN]** default: present | Sports, NSS, college events. Comes from a leave notice. |
| Medical / leave | **[OPEN]** default: absent but annotated | Configurable per leave type: present / excused (removed from total) / absent |

### 5.3 Two ways to mark (both first-class)

1. **Live, on phone during class.** Opens straight to "today's classes". Everyone is Present by default; tap absentees; tap-and-hold for Late. Big roll numbers (last 3 digits) for speed. One Save.
2. **From attendance book, later (end of day or later).** Desktop or phone. "Pending" list shows every unmarked session for that faculty. Grid view: students × sessions for a day or week, keyboard friendly (type roll numbers of absentees, e.g. `3, 12, 27`).

Reliability on bad network:

- Drafts auto-save in the browser while marking. Closing the tab or losing signal loses nothing.
- Every save carries a client-generated ID (`client_op_id`). Retries never create duplicates.
- Clear on-screen state: Draft / Saving / Saved ✓ / Failed (retry).

### 5.4 Editing & lock

- Faculty can edit freely until the **lock window** (default: 3 days after the session, configurable).
- After lock: faculty submits an edit request with a reason; HOD approves. All edits audited (old → new, who, when, why).
- Concurrent edits on the same session: optimistic locking (version number). Second writer sees "changed by X, reload".

### 5.5 Calculation

- Per student per subject: `attended / counted sessions`, where counted = held sessions for that student's batch (or ALL), after the student joined the class, minus excused.
- Theory and practical shown separately and combined.
- Overall %: across all subjects.
- **Eligibility threshold: 60%** (configurable). **[OPEN]** Per subject, overall, or both? Default: per subject.
- Warning band (configurable, default 70%): "at risk".
- All math is pure functions with unit tests. Percentages rounded only for display, never stored.

### 5.6 Compliance

- HOD dashboard: sessions not marked by end of day, per faculty.
- Daily reminder to faculty with pending sessions (in-app; WhatsApp later).
- Weekly parent summary only includes **marked** sessions; unmarked are flagged to the HOD before sending.

---

## 6. Calendar

No college calendar system exists, so the system provides one:

- Term setup: start date, end date, CIE windows, SEE window.
- Mark any day as Holiday / Exam / Event / Working (with "follows weekday" for swaps).
- Bulk-add from a list (government holidays).
- **Mark this day as holiday** button on the dashboard. If attendance was already marked that day, it asks before cancelling those sessions (records kept in audit).
- Department-specific or class-specific days (e.g. only CS Sem 5 on industrial visit).

---

## 7. Marks & assessments

Per subject (confirmed):

| Course kind | Internals (CIE) | Final (SEE) |
|---|---|---|
| Integrated (main subjects) | 2 theory tests + 2 practical tests | Theory final + practical final |
| Theory-only (EVS, Kannada, English) | 4 theory tests | **[OPEN]** final? |
| Specialization (Sem V) | **[OPEN]** | **[OPEN]** |

- Max marks per assessment: **[OPEN]**.
- **Internal total formula: [OPEN]** (average / best of / scaled). Designed as a configurable formula per scheme so the answer plugs in without code changes. Formula engine supports: sum, average, best-N-of-M, scale-to-X, rounding rule.
- **SEE ownership: [OPEN].** If DTE conducts the finals, the college only enters results afterward. Pass/fail rules come from DTE.
- Attendance does **not** add to marks (confirmed).
- Mark values: number, `AB` (absent for test), `MP` (malpractice). Entry by faculty assigned to that component. Bulk entry grid + Excel upload.
- Workflow: Draft → Submitted → Published (only published marks are visible to parents and trigger messages). Edit after publish needs HOD approval and is audited.

---

## 8. Notifications (WhatsApp first, SMS fallback)

### 8.1 Triggers

| # | Trigger | When sent | Default |
|---|---|---|---|
| 1 | **Weekly attendance summary** | Sunday evening, covers Mon–Sat | On |
| 2 | Attendance falls below warning band (70%) | Once, on crossing | On |
| 3 | Attendance falls below eligibility (60%) | Once, on crossing | On |
| 4 | Absent 3 consecutive working days | Next morning | **[OPEN]** On? |
| 5 | Absent for a whole day | Evening (after lock) | **[OPEN]** Off (weekly only) |
| 6 | Marks published | When HOD/faculty publishes | On |
| 7 | Low marks (below X% of max) | With #6 | On |
| 8 | Exam schedule (CIE/SEE dates) | When announced + 1 day before | On |
| 9 | Holiday / college notice broadcast | Manual by admin/principal | Manual |
| 10 | Leave/OD recorded | When approved | Off |
| 11 | Exam eligibility warning before SEE | 2 weeks before SEE | On |
| 12 | Parent login OTP | On request | On |

All triggers can be turned on/off per college.

### 8.2 Message rules

- Send to **every registered parent number** (up to 2, or more) for the student.
- **Bilingual: English + Kannada in one message.** Kannada wording to be checked by college staff before templates are submitted to Meta.
- Short message + link to the parent portal for full details (keeps under template limits and costs down).
- No sensitive detail beyond what the parent needs.

Example weekly summary (English half):

```
MEI Polytechnic – Weekly Attendance
Week: 27 Oct – 01 Nov 2026
Student: Rahul K (204CS25012), CS Sem 3
This week: 26 of 30 classes attended
Missed: DSP (Tue), CN Lab (Thu), Kannada (Wed, Thu)
Overall: 82%   Minimum required: 60%
Details: <portal link>
```

### 8.3 Delivery pipeline (outbox pattern)

1. Event happens (e.g. marks published) → notification rows written **in the same DB transaction**. If the save fails, no message; if the save succeeds, the message is guaranteed to be queued.
2. Background worker picks rows, sends via provider, stores provider message ID.
3. Provider delivery webhooks update status: sent → delivered → read / failed.
4. Retry with backoff on temporary errors. On permanent WhatsApp failure (number not on WhatsApp) → SMS fallback (critical triggers only).
5. Deduplication key per (student, trigger, period): never sends the same alert twice.
6. Quiet hours (no sends 9 pm – 8 am), rate limiting.
7. Admin outbox screen: every message, status, retry button.

### 8.4 Providers

- **Demo (now, ₹0):** `MockProvider` shows messages in an in-app "phone preview" outbox. Plus **Meta WhatsApp Cloud API test number**: free, sends real WhatsApp messages to up to 5 verified numbers. Good enough to demo live.
- **Production:** Meta WhatsApp Cloud API directly (cheapest) or a BSP (Gupshup / AiSensy / Interakt / WATI: easier setup, small markup). Needs a Meta Business account verified in **the college's name**, a dedicated phone number, and approved "utility" templates. Per-message fee; verify current India rates before budgeting. Rough scale: ~1,300 students × ~1.5 numbers × weekly ≈ 8,000 messages/month + event alerts.
- **SMS fallback:** Indian SMS needs **TRAI DLT** registration (college as entity, sender ID header, each template pre-registered). Providers: MSG91, Fast2SMS, etc. Kannada SMS is Unicode (70 chars/segment), so SMS = short text + link.
- Code talks to an interface (`MessageProvider`); swapping providers = config change.

### 8.5 Consent & privacy

- Many diploma students are minors. India's **DPDP Act 2023** needs verifiable parental consent. Capture consent (date + method) per parent contact at admission. Contacts without consent get no messages.
- Parents can opt out of non-critical messages.

---

## 9. Reports (PDF + Excel)

- Student report card: attendance per subject + all marks.
- Class attendance register (monthly), in the familiar book layout.
- Shortage list (below threshold) per class / department / college.
- Exam eligibility list before SEE.
- Marks sheet per assessment and consolidated internal marks per class.
- Faculty compliance report (unmarked sessions).
- Message delivery report.

PDFs are rendered from HTML with headless Chromium so Kannada text shapes correctly (most PDF libraries break Kannada conjuncts). Bundled font: Noto Sans Kannada.

---

## 10. Student lifecycle & edge cases

| Case | Handling |
|---|---|
| New admission mid-term | Joins class with `joined_on`; earlier sessions not counted against them |
| Lateral entry (joins Sem 3) | Same register format; membership starts at Sem 3 |
| Batch change B1 ↔ B2 | Membership change with effective date; history kept |
| Detained / year back | New membership in junior class; register number unchanged |
| Backlog subject (re-exam only) | Marks only, no attendance |
| Dropout / TC | Status change; excluded from future sessions & messages; history kept |
| Semester promotion | Bulk "promote class" at term end with preview and exclusions |
| Pass out | Status = alumni; data retained per college policy |
| Wrong parent number | Class teacher edits; audited; WhatsApp failure shows on dashboard |
| Faculty leaves college | Deactivate user; reassign subjects; their records remain |
| Timetable change mid-term | New version from date X; past sessions untouched |
| Holiday declared after marking | Confirm, cancel sessions, audit |
| Two staff edit same session | Optimistic lock |
| Clock/timezone | All dates in Asia/Kolkata; "today" computed server-side |

---

## 11. Engineering principles

1. **Database is the referee.** Constraints, foreign keys and transactions guard correctness, not just app code.
2. **Everything audited.** Every attendance/mark/contact change: who, when, old, new, reason.
3. **Idempotent writes.** Retries never duplicate.
4. **Config over code.** Periods, thresholds, batches, schemes, formulas, triggers are data.
5. **Pure, tested rule logic.** Percentage, eligibility and marks formulas are pure functions with unit tests on edge cases.
6. **Outbox for messages.** No lost or double messages.
7. **Role scoping enforced on the server for every query.** An HOD can never fetch another department's data, even with a crafted request.
8. **Fast by default.** Indexed queries; target < 1 s page load on 4G, < 300 ms save. Scale is small: ~1,300 students ≈ 1.5–2M attendance rows/year, comfortable for PostgreSQL.
9. **Backups.** Nightly database dump, kept off-machine, restore tested.
10. **Boring, maintainable code** so a lecturer can maintain it: one language, one repo, clear folder layout, README for setup.

---

## 12. Stack (proposed, to confirm)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language front to back; type errors caught before running |
| Web app | **Next.js** (App Router, server actions) | Server-rendered = fast on cheap phones; one project for UI + API |
| UI | Tailwind CSS + shadcn/ui, TanStack Table | Clean, accessible, fast grids for attendance/marks |
| Database | **PostgreSQL** | Strong constraints, transactions, reliable |
| DB access | Drizzle ORM + SQL migrations | Typed, close to SQL, readable migrations |
| Validation | Zod | Same schema checks inputs on client and server |
| Auth | Own: scrypt passwords + DB sessions (see Progress) | No extra framework; parent OTP added in phase 7 |
| Background jobs | pg-boss (queue + cron inside PostgreSQL) | No Redis; retries, schedules (weekly summary, session generation) |
| i18n | next-intl (English / Kannada) | UI and messages in both languages |
| PDF | HTML → headless Chromium (Playwright) | Correct Kannada rendering |
| Excel | ExcelJS | Import students/timetables, export reports |
| Tests | Vitest (rules) + Playwright (end-to-end flows) | Rules can't silently break |
| Deploy | Docker Compose: app + worker + PostgreSQL + Caddy (HTTPS) | Runs the same on a laptop, a ₹500–1000/month VPS, or a college server |

Alternative considered: **Django + HTMX** (Python). Equally solid, comes with a free admin panel. Pick it instead if the lecturer who will maintain this knows Python but not JavaScript.

---

## 13. Build phases

| Phase | Deliverable |
|---|---|
| 0 | Repo, Docker setup, database schema + migrations, CI running tests |
| 1 | Dummy data generator: 7 depts × 3 classes (Sem 1/3/5) × 60 students, CS timetables from the PDF, synthetic timetables for other depts, faculty, parents, attendance history since term start, some CIE marks |
| 2 | Login + roles + admin setup screens (departments, courses, classes, faculty, calendar, timetable editor) |
| 3 | Attendance: session generation, live marking, book/bulk marking, pending list, lock & edit requests, leave/OD |
| 4 | Dashboards & calculations: student/class/department %, shortage, compliance |
| 5 | Marks: schemes, assessments, entry, publish, formula engine (once formula confirmed) |
| 6 | Notifications: outbox, mock provider + phone preview, WhatsApp Cloud API test number, weekly summary, threshold alerts |
| 7 | Parent portal (register no + phone + OTP) |
| 8 | PDF/Excel reports |
| 9 | Hardening: audit screens, backups, load test with full dummy data, security review |
| 10 | Real data import (students, subjects, timetables, faculty) + production WhatsApp/SMS |

Demo-ready after phases 0–4 + 6 (mock + test number).

**Progress:** Phase 0 and 1 done (2026-10-31). Schema with DB-level checks, pure rule logic (attendance %, calendar, timetable, reg no, phone) with 62 unit tests, 14 database-constraint tests, deterministic dummy data seed, CI workflow, status page.

**Progress:** Phase 6 done (2026-11-01).

- Built triggers: weekly summary (Sunday 17:00, Mon–Sat, catch-up until Tuesday 09:00, never stale), below warning / below minimum (once per drop, remembered in `student_alert_state`; a subject needs ≥ 8 counted classes before it can alert), absent N working days in a row (Settings; days with unentered classes never count as absent), absent all day (off), leave/OD approved (off, queued in the approval transaction), notices from principal/admin to college / department / class.
- On/off per trigger in Settings (`notification_setting`). Marks triggers wait for phase 5, OTP for phase 7.
- Consent required for every message (DPDP). Opt-out stops everything except shortage / consecutive-absence / eligibility / OTP. Same number saved twice = one message.
- Quiet hours 21:00–08:00 IST: messages wait until 08:00.
- Sender: claims rows with SKIP LOCKED, retries temporary errors (1/4/16/64 min, 5 tries), "not on WhatsApp" on a critical message → SMS copy. Stuck "sending" rows requeue after 10 min (at-least-once).
- Providers: mock (default), WhatsApp Cloud API (text messages; templates needed for production), SMS not configured yet. Test-mode allow-list `NOTIFY_ALLOWED_NUMBERS`.
- Webhook `/api/whatsapp/webhook`: signature-checked delivery statuses, forward-only.
- **[OPEN]** Kannada wording to be checked by college staff. Whether parents should get the day-absence alert.

**Progress:** Phase 4 done (2026-11-01).

- Percentages are never stored: every page computes them from the raw marks with the tested rules, so a corrected mark or leave notice shows at once. Unentered classes are left out and counted separately.
- Shortage rule used: **below the minimum in any subject** (theory + lab of a subject combined), per the default in §5.5 until the college confirms. Overall % is shown alongside.
- Standing is decided from the counts (attended × 100 ≥ min × counted), not from a rounded float.
- Student page: % per subject (theory, lab, total), "must attend the next N in a row" / "can miss N more", recent absences with leave/OD tags.
- Class page → Attendance %: every student × subject, date range filter, shortage/at-risk filter.
- Reports → Attendance shortage (class / department / college, filter by department, semester, level) and Not yet entered (per teacher, HOD/principal/admin only).
- Whole-college shortage list: ~0.5 s in a production build with full dummy data (21 classes, ~233k marks).

**Progress:** Phase 3 done (2026-11-01). How it behaves:

- Sessions are created from timetable + calendar on demand (attendance pages, dashboard) and by `npm run sessions:generate` nightly. Idempotent.
- Marking screen: everyone Present by default (students on approved leave/OD start Absent and show a hint); tap to toggle, small L for late; or type roll numbers from the book ("3, 12, 27", "5-8"). Where two students share a roll (detained student), both show and accept the 5-digit year+roll.
- Saves are all-or-nothing for the whole class list, idempotent (retry-safe id), and version-checked (two people saving at once: second is refused, marks kept as a draft on the phone to restore).
- Drafts survive reloads and lost connections (stored per class in the browser).
- Edit window (Settings, default 3 days): after it, teacher changes become requests with a reason; HOD/admin approves and they apply only if nothing changed since. HOD/admin may edit locked classes directly (audited).
- "Not held" with reason (removes marks, kept in audit); can be reopened.
- Leave/OD notices: class teacher records → HOD approves; HOD/admin entries are approved at once. Overlapping notices are blocked.

**Progress:** Phase 2 done (2026-11-01). Decisions taken while building it:

- **Own auth instead of Better Auth.** Staff already live in our `staff` table. Passwords use Node's built-in scrypt; sessions are random tokens stored only as SHA-256 hashes, 30-day cookies. Login is rate-limited (5 failures per phone / 30 per IP in 15 min) and always runs one hash check so timing doesn't reveal which phones exist. New staff and resets get a one-time temporary password and must change it at first sign-in. Fewer moving parts for a lecturer to maintain.
- **Next.js Cache Components turned off.** Every page is per-user and attendance must be live; pages render on each request.
- **Timetable versions lock** once any class is recorded against them. Changes go into a new version starting tomorrow or later. Clashes are blocked for the same batch, and for the same teacher across classes.
- **Calendar holiday/exam on a day with recorded attendance** needs explicit confirmation; those classes become CANCELLED (marks kept). Deleting the entry restores them.
- **Batch changes** start today or later (backdating would re-assign already-marked classes).
- Every change writes an audit log row in the same transaction.

Assumptions made while building (change when the college answers):

- Sem V specialization: one morning (P1–P4) and one afternoon (P5–P7) session per day.
- Lateral-entry register numbers: admission year of lateral entry + roll from 301 (e.g. `204CS26301`).
- Leave policy defaults: OD = present, medical/personal/other = absent (annotated).
- Max marks placeholders: CIE 50, SEE 100.
- Activity periods not tracked.

---

## 14. Open questions

From the college:

1. Final internal mark formula (avg / best-of / scaling). *(student asking)*
2. Are finals (SEE) conducted by DTE? Who enters results, and are pass/fail rules needed? *(student asking)*
3. Max marks for each CIE test and SEE (theory and practical).
4. Sem V (specialization all day): how is attendance taken? One session per day, per period, or per module? Are there other specializations besides Cyber Security (students split by choice)?
5. Sem VI: classes, internship, or project? Attendance needed?
6. Attendance threshold 60%: per subject, overall, or both?
7. OD and medical leave: do they count as present, get excused, or stay absent?
8. Activity periods: track attendance?
9. How are students split into B1 / B2? (e.g. first half of roll numbers)
10. Students per class (intake): 60?
11. Instant alert for 3 consecutive absent days, or strictly weekly only?
12. Low-marks threshold for alert (e.g. below 40% of max)?
13. Does theory-only subject (EVS/Kannada/English) have a final exam?
14. ~~Will the maintaining lecturer prefer JavaScript/TypeScript or Python?~~ Decided: TypeScript stack (§12).
15. Lateral-entry students: what roll numbers do they get?
16. Are Maths, EVS and Kannada taught by a common Science & Humanities staff pool, or by each department's own staff?
17. Odd term real start and end dates for 2026-27, and the official holiday list.

Data to collect later: student list (reg no, name, parent phones, consent), subjects per dept/sem with codes, faculty list + phone, timetables for all depts.
