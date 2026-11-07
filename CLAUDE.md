@AGENTS.md

# MEI Attendance — guide for Claude

Official attendance, marks and parent-messaging system for MEI Polytechnic, Bengaluru. Built by a student,
to be maintained later by a college lecturer: code must stay plain and readable. The spec is
**docs/PLAN.md** (rules, data model, open questions, progress per phase); read the relevant section first.
README.md has commands, demo logins and run instructions.

## Working rules (from the owner)

- Quality bar: reliable, fast, must not break. Think through every edge case; enforce rules in the
  database too, not only in the UI.
- Work phase by phase from PLAN.md §13; the owner approves each phase. **Commit only when asked.**
- **Never point a live WhatsApp/SMS provider at dummy data.** Mock provider (`NOTIFY_PROVIDER=mock`) by default.
- Before finishing: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (DB tests need `npm run db:up`),
  and check the screen in the browser at desktop and phone width.

## Stack

Next 16 App Router (`src/proxy.ts`, not middleware), React 19, Drizzle 0.45 + Postgres 17 (Docker, port 5433),
Zod 4, Vitest (projects: `unit`, and `db` with `fileParallelism: false`), Tailwind. No ORM-level magic,
no UI library, no xlsx library (own writer `src/lib/xlsx.ts` and reader `src/lib/sheet-read.ts`).
Next 16 specifics: `PageProps<"/route">`, `RouteContext<"/route">`, `LayoutProps`; error.tsx gets
`{ error, retry }`. Read `node_modules/next/dist/docs/` before using an API.

## Code conventions

- **Pure rules in `src/lib/`** (domain, auth/permissions, import checks, notify templates), each with tests.
  Server code in `src/server/` starts with `import "server-only"`.
- **Every write** is a Server Action wrapped in `formAction(schema, handler)` (`src/server/action.ts`), calls
  `ensure(can…(me.actor))` from `src/lib/auth/permissions.ts`, and writes `audit(tx, …)` in the same
  transaction. UI hiding is never protection; pages check permission too.
- Friendly messages for constraint names live in `CONSTRAINT_MESSAGES` (action.ts); add one for each new constraint.
- Raw SQL: `sql\`…\`` with parameters only; cast enum arrays to `text[]`; dates are `YYYY-MM-DD` strings in
  college time (`todayIn()`); every connection runs in Asia/Kolkata.
- Parent messages go through the outbox (`notification` table) with dedupe keys; never send inline.
- Timetable / subject changes must call `forgetGeneratedSessions()` (sessions are planned on demand).
- `fieldClass` in `src/components/ui.tsx`: a caller's `w-*` / `py-*` replaces the default width / padding.
- Schema changes: edit `src/db/schema.ts`, `npm run db:generate`, never edit an applied migration.

## Current status (2026-11-03)

Phases 0–9 done. **Roles for the demo done** (PLAN.md §3 and the 2026-11-03 progress note): office role,
staff leave (`staff_leave`, the HOD decides teachers' leave, senior roles' leave is recorded without approval,
overlap refused by an exclusion constraint in migration 0008), college updates (`college_update`, outbox + parent portal), dashboard attention list and department
overview (`src/server/overview.ts`), parent Updates / Calendar pages, WhatsApp setup check and the
dummy-data send guard (`providersFor`, `college_settings.demo_data`; always use it, not providersFromEnv).
Courses are unique per (department, code). Seed has C-25 subjects (docs/c25-subjects.md).
**Role redesign (2026-11-07, PLAN.md §3):** principal view-only; HOD adds own-department staff
(`canManageStaffMember`, `canGrantRole`) and publishes own-department updates (`canPublishUpdateTo`);
Attendance opens on the department's day timetable grid (`src/components/day-timetable.tsx`, layout in
`src/lib/domain/day-grid.ts`, data `src/server/department-day.ts`; `/today` redirects there): any faculty takes an
untaken class, a saved one stays with the saver / subject teacher / HOD (`canMarkSession` + `markedBy`, first
saver kept); class teacher "My class" (`/my-class`, `src/server/class-status.ts`); the HOD picks how each
student leave counts (`leave_notice.counts_as`, migration 0009; leave policy is only the suggestion).
Marks have no approval step: the part's teacher (final exam too) saves, then "Done – show to parents"
(`publishMarks`, status PUBLISHED) and can still correct; SUBMITTED is refused by `assessment_no_submitted` (migration 0010).
WhatsApp: Twilio sender (`NOTIFY_PROVIDER=twilio`) and `NOTIFY_MONTHLY_LIMIT` exist; the Twilio trial sender
only takes templates, so demos run on mock until the college's Meta business account is verified.
Next the owner may ask for: principal ↔ HOD messaging (waiting on what the principal needs).

**Phase 10 (real data import) in progress:**

- Done: `src/lib/sheet-read.ts` (xlsx/csv reader), `src/lib/import/` (column matching + checks for staff,
  subjects, students + parents, timetable; all tested), `src/server/import/` (context loaders, apply,
  `runImport`: check writes nothing; apply needs the same file fingerprint and counts, re-checks inside a
  locked transaction, all-or-nothing, audited). `canImport` = admin.
- Left: blank / current-data template downloads; POST route `/imports/[kind]` (origin check, 5 MB limit,
  JSON response, no-store); `/admin/import` screen (term picker, joined-on / start date, check → preview →
  import, temp passwords shown once) and the "Import" nav item (removed until the screen exists);
  `db:setup` script for a fresh real database (settings, periods, term + classes, departments, marks
  schemes, first admin) — the app has no screen to create terms or classes; guard so
  DB tests for apply; docs. `db:setup` must leave `demo_data` false.
- Phone: web app manifest + icons (installable). Demos run on a laptop over Wi-Fi / hotspot (README).

Open questions for the college are marked **[OPEN]** in PLAN.md (minor-subject result out of 50 or 100;
SMS provider; Kannada message text check).
