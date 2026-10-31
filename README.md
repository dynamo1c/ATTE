# MEI Polytechnic — Attendance, Marks & Parent Alerts

Web app for MEI Polytechnic, Bengaluru: class-wise attendance, internal marks, and WhatsApp/SMS updates to parents.

Full design, rules and open questions: **[docs/PLAN.md](docs/PLAN.md)**. Read it before changing anything.

## Status

Prototype with dummy data. Phase 0–1 done: database schema, rule logic with tests, dummy data. Next: logins and screens.

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

## Folder layout

```
docs/PLAN.md              Spec: rules, data model, open questions
drizzle/                  SQL migrations (generated — never edit by hand once applied anywhere)
src/db/schema.ts          Every table, with database-level checks
src/db/seed/              Dummy data (CS timetables are the official 2026-27 ones)
src/lib/domain/           Pure rule logic: attendance %, calendar, timetable, register numbers, phones
src/app/                  Next.js pages
tests/db/                 Tests proving the database rejects bad data
```

## Rules for changing code

1. **Schema change** → edit `src/db/schema.ts` → `npm run db:generate` → commit the new migration file.
2. **Rule change** (attendance %, eligibility, calendar) → change `src/lib/domain/*` and its `.test.ts` together.
3. Thresholds, periods, leave policy, etc. are **data** (`college_settings`, `period`, `leave_policy`), not code.
4. `npm test`, `npm run typecheck` and `npm run lint` must pass before merging. CI runs them on every push.

## Dummy data

- 7 departments × Sem 1/3/5 × 60 students, register numbers like `204CS25012`.
- CS timetables transcribed from the official odd-semester 2026-27 timetable. Other departments reuse the same grids with **placeholder subjects**.
- Attendance from 17 Aug 2026 to today; last two days partly unmarked to show "pending".
- Edge cases: detained student `204CS25058` (in Sem 1), lateral entries `204CS26301–303`, mid-term joiner `204CS26061`, batch change `204CS25015`, dropout `204ME25044`.
- Parent phone numbers are fake (`+918000…`). **Never point a live WhatsApp/SMS provider at dummy data.**
