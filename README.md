# MEI Polytechnic — Attendance, Marks & Parent Alerts

Web app for MEI Polytechnic, Bengaluru: class-wise attendance, internal marks, and WhatsApp/SMS updates to parents.

Full design, rules and open questions: **[docs/PLAN.md](docs/PLAN.md)**. Read it before changing anything.

## Status

Prototype with dummy data. Phases 0–9 done: database, rule logic with tests, dummy data, staff sign-in with roles, setup screens (staff, classes, subjects, teachers, timetables, calendar, students and parent numbers, settings), and attendance: live or from the book, late-change requests with HOD approval, leave/OD notices; attendance % per student and subject, class sheets, shortage lists and the "not yet entered" report; messages to parents (weekly summary, shortage / warning / absence alerts, notices) in English + Kannada through an outbox, with a mock sender and the WhatsApp Cloud API. marks: entry per test (theory, practical, activity, final exam), teacher → HOD → published, internal /50 + final /50 = /100 with the college's formula, low-marks report and parent messages; a parent portal (register number + phone on record + one-time code) showing attendance and published marks for every child linked to the number; Excel downloads (shortage list, class attendance + exam eligibility, monthly register, class marks, classes not entered, message delivery) and print / save-as-PDF for every report plus a student report card; hardening: audit log screen, backups with a restore check, health check, security headers, error pages, load test; installs on phones (app icon, full screen). In progress: Excel / CSV import of real staff, subjects, students and timetables (checks done and tested, upload screen not yet).

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

**Parent portal** (`/parent`): mobile `90000 00001` with register number `204CS25001` or `204CS26001` (two siblings). With the mock sender (`NOTIFY_PROVIDER=mock`) nothing is really sent, so the code is shown on screen in development, or in a production build when `PARENT_OTP_DEMO=yes`.

## Run it locally

Needs: Node.js 22+ and Docker Desktop.

```bash
npm install
cp .env.example .env
npm run db:up        # start PostgreSQL in Docker (port 5433)
npm run db:reset     # create tables + load dummy data (~40 s)
npm run dev          # open http://localhost:3000
```

### Demo on a laptop, shown on a phone

Fast (everything on the laptop, phone over Wi-Fi). Do the setup at home, where the internet is good.

1. Install **Node.js 22+** (nodejs.org, LTS), **Docker Desktop** (docker.com) and **Git**. Start Docker Desktop and wait until it says "running".
2. Get the code and set it up (PowerShell):

   ```bash
   git clone https://github.com/dynamo1c/ATTE.git
   cd ATTE
   npm ci
   copy .env.example .env
   ```

   Open `.env` and set:

   - `PARENT_OTP_DEMO=yes`: the parent login code shows on screen (dummy data only).
   - `ALLOW_HTTP_COOKIES=yes`: without it, sign-in fails on the phone, because the phone opens the app over plain http and the fast build only keeps sign-in cookies on https. Demo laptop only, never on a real server.
3. Database and the fast (production) build:

   ```bash
   npm run db:up
   npm run db:reset
   npm run build
   ```

4. Start it, every time before the demo (Docker Desktop must be running):

   ```bash
   npm run db:up
   npx next start -p 3000
   ```

   It prints a `Network:` address such as `http://192.168.1.4:3000`. If Windows asks about the firewall, allow **Private networks**.
5. On the phone: join the **same Wi-Fi** as the laptop (or turn on the phone's hotspot and connect the laptop to it), then open that Network address in Chrome. For a full-screen icon: ⋮ → **Add to Home screen**.

If the phone can't open it: check both are on the same network, and that the firewall allowed Node.js on Private networks. College Wi-Fi often blocks devices from seeing each other; the phone hotspot always works.

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
| `npm run notify:run` | Queue due parent messages and send queued ones (every 15 min, see below) |
| `npm run db:backup` | Back up the database to `backups/` (nightly, see below) |
| `npm run db:restore-check` | Restore the newest backup into a scratch database and compare (weekly) |
| `npm run load-test -- <url> <users> <seconds>` | Load test a running server with the dummy college |

## Nightly job

Classes are created from the timetable + calendar. Pages create them on demand, but schedule this once a day (≈00:30) so HOD "not yet entered" counts are always complete. It is safe to run any number of times.

- Windows Task Scheduler: action `npm`, arguments `run sessions:generate`, start in the project folder.
- Linux cron: `30 0 * * * cd /path/to/att && npm run sessions:generate`

## Parent messages

Messages are rows in the `notification` table (the outbox), written in the same transaction as whatever caused them. `npm run notify:run` finds due alerts and sends what is queued. Schedule it **every 15 minutes**, like the nightly job. It is safe to run any number of times: each message has a dedupe key.

- `NOTIFY_PROVIDER=mock` (default): nothing leaves the server. Messages show as "sent" on the Messages screen, with a preview.
- `NOTIFY_PROVIDER=whatsapp`: Meta WhatsApp Cloud API. Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`, and **`NOTIFY_ALLOWED_NUMBERS`** (your own test numbers). The app refuses to start sending to everyone unless `NOTIFY_ALLOW_ALL=yes`. Plain-text messages only reach a parent who messaged the college number in the last 24 hours. Real use needs Meta-approved templates (docs/PLAN.md §8.4).
- Delivery receipts: point the Meta webhook at `/api/whatsapp/webhook` with `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` set.
- SMS fallback needs a DLT-registered SMS provider (not added yet). Until then SMS rows fail with "No SMS provider is configured".
- The Kannada text in `src/lib/notify/templates.ts` must be checked by college staff before templates are submitted.

## Running it for real (checklist)

- **Behind a reverse proxy with HTTPS** (Caddy, nginx or IIS) in front of `npm run build && npm start`. Set `TRUSTED_PROXY_HOPS` to the number of proxies (default 1): the sign-in rate limits use the IP the proxy saw, and a visitor can't fake it. Leave `ALLOW_HTTP_COOKIES` and `PARENT_OTP_DEMO` empty.
- **Scheduled jobs:** `sessions:generate` nightly, `notify:run` every 15 minutes, `db:backup` nightly, `db:restore-check` weekly.
- **Backups off the machine:** set `BACKUP_COPY_DIR` to a OneDrive / Google Drive synced folder or an external disk. A backup only on the server is lost with the server. Backups contain student data: keep that folder private.
- **Monitoring:** point an uptime monitor (e.g. UptimeRobot) at `/api/health`. It returns 503 if the database is down and `"messagesJob": "behind"` if the 15-minute job has stopped.
- **Audit log** (admin / principal): every change, sign-in and Excel download, with before/after. Rows can't be changed or deleted, not even by a bug: the database refuses.
- Staff are signed out after `SESSION_IDLE_HOURS` (default 72) without use, in case they forget to sign out on a shared computer.
- Load test result (one Node process, dummy college of 1,264 students): about 46 pages a second at full CPU with no errors; with light use every page answers in about 0.1 s (p95 under 0.75 s). A real morning (100 teachers clicking every 10–20 s) is 5–10 pages a second.

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
src/app/parent/           Parent portal (own sign-in, cookie and session table)
src/proxy.ts              Sends signed-out visitors to /login or /parent/login (real checks happen on the server)
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
- One demo guardian number (90000 00001) linked to two siblings, for the parent portal.
- Marks: tests 1 published, tests 2 mostly published (CS Sem 3 waiting for the HOD), activity not entered yet. **CS Sem 1 is complete, including dummy final exam marks**, to show totals out of 100.
- Edge cases: detained student `204CS25058` (in Sem 1), lateral entries `204CS26301–303`, mid-term joiner `204CS26061`, batch change `204CS25015`, dropout `204ME25044`.
- Parent phone numbers are fake (`+918000…`). **Never point a live WhatsApp/SMS provider at dummy data.**
