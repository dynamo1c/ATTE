# MEI Polytechnic — Attendance, Marks & Parent Alerts

Web app for MEI Polytechnic, Bengaluru: class-wise attendance, internal marks, and WhatsApp/SMS updates to parents.

Full design, rules and open questions: **[docs/PLAN.md](docs/PLAN.md)**. Read it before changing anything.

## Status

Prototype with dummy data. Phases 0–3 done: database, rule logic with tests, dummy data, staff sign-in with roles, setup screens (staff, classes, subjects, teachers, timetables, calendar, students and parent numbers, settings), and attendance: live or from the book, late-change requests with HOD approval, leave/OD notices. Next: attendance % dashboards and reports.

## Demo sign-in (dummy data only)

Password for every dummy staff account: the `SEED_STAFF_PASSWORD` value in `.env` (default in `.env.example`). `npm run db:reset` prints this table:

| Role | Mobile |
|---|---|
| Admin | 70000 00001 |
| Principal | 70000 00002 |
| HOD, CS | 70000 00010 |
| Class teacher CS Sem 3 (+ faculty) | 70000 00012 |
| Faculty, CS | 70000 00059 |
| Faculty, Maths (common pool) | 70000 00052 |

## Run it locally

Needs: Node.js 22+ and Docker Desktop.

```bash
npm install
cp .env.example .env
npm run db:up        # start PostgreSQL in Docker (port 5433)
npm run db:reset     # create tables + load dummy data (~40 s)
npm run dev          # open http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm test` | Run all tests (rule logic + database constraints; DB tests need `db:reset` first) |
| `npm run typecheck` | Check TypeScript types |
| `npm run lint` | Lint |
| `npm run db:up` | Start the local database |
| `npm run db:generate` | After editing `src/db/schema.ts`: create a new SQL migration in `drizzle/` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Load dummy data into an empty database |
| `npm run db:reset` | Wipe + migrate + reseed. Refuses to run against a non-local database |
| `npm run db:studio` | Browse the database in the browser |
| `npm run sessions:generate` | Create today's classes from timetables (run nightly, see below) |

## Nightly job

Classes are created from the timetable + calendar. Pages create them on demand, but schedule this once a day (≈00:30) so HOD "not yet entered" counts are always complete. It is safe to run any number of times.

- Windows Task Scheduler: action `npm`, arguments `run sessions:generate`, start in the project folder.
- Linux cron: `30 0 * * * cd /path/to/att && npm run sessions:generate`

## Folder layout

```
docs/PLAN.md              Spec: rules, data model, open questions
drizzle/                  SQL migrations (generated — never edit by hand once applied anywhere)
src/db/schema.ts          Every table, with database-level checks
src/db/seed/              Dummy data (CS timetables are the official 2026-27 ones)
src/lib/domain/           Pure rule logic: attendance %, calendar, timetable, register numbers, phones
src/lib/auth/             Password hashing and the permission rules (who may do what)
src/server/               Server-only code: sessions, current user, form-action wrapper, audit log, queries
src/components/           Shared UI (ui.tsx) and <ActionForm> for every form
src/app/(app)/            Signed-in pages; each folder has page.tsx and actions.ts
src/proxy.ts              Sends signed-out visitors to /login (real checks happen on the server)
tests/db/                 Tests proving the database rejects bad data
```

## Rules for changing code

1. **Schema change** → edit `src/db/schema.ts` → `npm run db:generate` → commit the new migration file.
2. **Rule change** (attendance %, eligibility, calendar) → change `src/lib/domain/*` and its `.test.ts` together.
3. Thresholds, periods, leave policy, etc. are **data** (`college_settings`, `period`, `leave_policy`), not code.
4. `npm test`, `npm run typecheck` and `npm run lint` must pass before merging. CI runs them on every push.
5. **Every Server Action** uses `formAction(schema, handler)` and checks permission with `ensure(can…(me.actor, …))` before touching data, then writes an `audit(...)` row in the same transaction. Hiding a button is never protection.
6. When a raw SQL query returns an array of an enum column, cast it to `text[]` (node-postgres can't parse enum arrays).

## Dummy data

- 7 departments × Sem 1/3/5 × 60 students, register numbers like `204CS25012`.
- CS timetables transcribed from the official odd-semester 2026-27 timetable. Other departments reuse the same grids with **placeholder subjects**.
- Attendance from 17 Aug 2026 to today; last two days partly unmarked to show "pending".
- Edge cases: detained student `204CS25058` (in Sem 1), lateral entries `204CS26301–303`, mid-term joiner `204CS26061`, batch change `204CS25015`, dropout `204ME25044`.
- Parent phone numbers are fake (`+918000…`). **Never point a live WhatsApp/SMS provider at dummy data.**
