# MEI Polytechnic — Attendance, Marks & Parent Alerts

Web app for MEI Polytechnic, Bengaluru: class-wise attendance, internal marks, and WhatsApp/SMS updates to parents.

Full design, rules and open questions: **[docs/PLAN.md](docs/PLAN.md)**. Read it before changing anything.

## Status

Prototype with dummy data. Phases 0–9 done: database, rule logic with tests, dummy data, staff sign-in with roles, setup screens (staff, classes, subjects, teachers, timetables, calendar, students and parent numbers, settings), and attendance: live or from the book, late-change requests with HOD approval, leave/OD notices; attendance % per student and subject, class sheets, shortage lists and the "not yet entered" report; messages to parents (weekly summary, shortage / warning / absence alerts, notices) in English + Kannada through an outbox, with a mock sender and the WhatsApp Cloud API. marks: entry per test (theory, practical, activity, final exam), teacher → HOD → published, internal /50 + final /50 = /100 with the college's formula, low-marks report and parent messages; a parent portal (register number + phone on record + one-time code) showing attendance and published marks for every child linked to the number; Excel downloads (shortage list, class attendance + exam eligibility, monthly register, class marks, classes not entered, message delivery) and print / save-as-PDF for every report plus a student report card; hardening: audit log screen, backups with a restore check, health check, security headers, error pages, load test; installs on phones (app icon, full screen); roles for the demo: office staff (calendar, college updates, students), staff leave decided by the HOD / principal with the classes that need a substitute, college updates on WhatsApp and in the parent portal (with the college calendar), a per-department overview for the principal. In progress: Excel / CSV import of real staff, subjects, students and timetables (checks done and tested, upload screen not yet).

## Demo sign-in (dummy data only)

Password for every dummy staff account: the `SEED_STAFF_PASSWORD` value in `.env` (default in `.env.example`). `npm run db:reset` prints this table:

| Role | Mobile |
|---|---|
| Admin | 70000 00001 |
| Principal | 70000 00002 |
| Office | 70000 00003 |
| HOD, CS | 70000 00012 |
| Class teacher CS Sem 3 (+ faculty) | 70000 00014 |
| Faculty, CS | 70000 00061 |
| Faculty, Maths (common pool) | 70000 00054 |

While the dummy data is loaded, both sign-in pages list these: tap a role to fill the form.

**Parent portal** (`/parent`): mobile `90000 00001` (or your `DEMO_PARENT_PHONE`) with register number `204CS25001` or `204CS26001` (two siblings).

## Who does what

| Role | Can do |
|---|---|
| Admin | Everything; staff accounts and roles, settings, message queue, audit log |
| Principal | View only: every department's overview (attendance, shortage, not entered, marks waiting, staff leave, HOD phone / WhatsApp), every report, staff, messages, audit log. Approves and publishes nothing |
| Office | College calendar (holidays, exams, events), college updates (WhatsApp + parent portal), student and parent-number edits for any class, every report including marks (read only). Own leave needs no approval |
| HOD | Own department: timetable, subjects, teachers, students; adds its staff (as faculty, can make them class teacher); approves attendance changes, student leave (choosing present / excused / absent) and teachers' leave; publishes marks and the department's updates. Own leave needs no approval |
| Teacher | **Department today**: every class of the department period by period, take any class nobody has saved (substitute); marks for own subjects; own leave (HOD decides) |
| Class teacher | Everything a teacher can, plus **My class**: today's periods and who took them, classes not entered this week per teacher, marks entry status, shortage list; student leave / OD for the class (HOD approves) |
| Parent | Child's attendance, marks, college calendar and updates, after register number + mobile + one-time code | With the mock sender (`NOTIFY_PROVIDER=mock`) nothing is really sent, so the code is shown on screen in development, or in a production build when `PARENT_OTP_DEMO=yes`.

## Run it locally

Needs: Node.js 22+ and Docker Desktop.

```bash
npm install
cp .env.example .env
npm run db:up        # start PostgreSQL in Docker (port 5433)
npm run db:reset     # create tables + load dummy data (~40 s)
npm run dev          # open http://localhost:3000
```

### WhatsApp on your own phone (demo)

Real WhatsApp messages, only to your own number. The 1,263 dummy parents are skipped. Two ways:

**A. Twilio sandbox (easiest: no Meta business account).** A Twilio trial has a small number of free messages, so set a cap.

1. Sign up at twilio.com (free trial). **Messaging → Try it out → Send a WhatsApp message**: send the "join …" code from your WhatsApp to the sandbox number.
2. In `.env`:

   ```
   NOTIFY_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=<Account SID, starts with AC>
   TWILIO_AUTH_TOKEN=<Auth Token>
   TWILIO_WHATSAPP_FROM=<sandbox number, e.g. +14155238886>
   NOTIFY_ALLOWED_NUMBERS=+91<your number>
   NOTIFY_MONTHLY_LIMIT=90
   DEMO_PARENT_PHONE=<your number>
   ```

   Then `npm run db:reset` (puts your number on the demo guardian) and restart the app.
3. Plain messages only reach you within 24 hours of your last message to the sandbox number, and the sandbox join expires after a few days of silence: message the sandbox number (send the join code again if asked) before each demo.
4. Continue at step 5 below. Delivery problems found after Twilio accepts a message show only in the Twilio console (**Monitor → Logs → Messaging**).

**B. Meta Cloud API test number.** Needs a Meta business account that Meta allows to send (payment method, complete business info; the Messages screen says if Meta blocks it).

1. On developers.facebook.com: **My Apps → Create app** (type Business), then add **WhatsApp**. Under **WhatsApp → API Setup** you get a test sender number, its **Phone number ID** and a temporary **access token** (valid 24 hours; make a permanent one later with a system user in Business settings).
2. In the **To** box there, add your own mobile and verify it with the code Meta sends.
3. In `.env`:

   ```
   NOTIFY_PROVIDER=whatsapp
   WHATSAPP_TOKEN=<access token>
   WHATSAPP_PHONE_NUMBER_ID=<phone number id>
   NOTIFY_ALLOWED_NUMBERS=+91<your number>
   DEMO_PARENT_PHONE=<your number>
   ```

   Then `npm run db:reset` (puts your number on the demo guardian) and restart the app.
4. From your WhatsApp, send **hi** to the test number. Meta only delivers plain messages within 24 hours of your last message to it; say hi again before each demo day.
5. Sign in as admin → **Messages → Send a test WhatsApp**. It should arrive in a few seconds; if not, the screen says why (token expired, number not verified, 24-hour window).
6. Demo: sign in as office → **Updates**, publish one for CS Sem 3 (or the whole college), then admin → Messages → **Check & send now** (or wait for the 15-minute job). Your phone gets it, and it shows on the parent portal's Updates page. Parent sign-in codes for your number also arrive on WhatsApp.

**Cost cap:** `NOTIFY_MONTHLY_LIMIT` stops real sending once that many messages went out this month (login codes included); the rest are marked skipped with the reason, and the Messages screen shows "This month: N of LIMIT".

Sending to every number (`NOTIFY_ALLOW_ALL=yes`) is refused while the dummy data is loaded: its parent numbers are made up and could belong to real people. Nothing is sent 9 pm – 8 am (updates wait until 8 am); the test message and login codes are not delayed.

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
- `NOTIFY_PROVIDER=twilio`: WhatsApp through Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`), same `NOTIFY_ALLOWED_NUMBERS` rule. Twilio adds its own fee per message on top of Meta's.
- `NOTIFY_MONTHLY_LIMIT`: most real messages per month (cost cap). Empty = no cap.
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
- Subjects: real C-25 subjects and codes for CS, EC, ME and EE Sem 1 and 3 ([docs/c25-subjects.md](docs/c25-subjects.md)); CE, EI, Cloud Computing and Sem 5 outside CS are **placeholders**. CS timetables are the official odd-semester 2026-27 ones; other departments reuse the same grids.
- Staff leave (approved, rejected, cancelled, today, waiting for the CS HOD and the principal) and college updates with their WhatsApp messages ("sent" by the mock).
- Attendance from 17 Aug 2026 to today; last two days partly unmarked to show "pending".
- One demo guardian number (90000 00001) linked to two siblings, for the parent portal.
- Marks: tests 1 published, tests 2 mostly published (CS Sem 3 waiting for the HOD), activity not entered yet. **CS Sem 1 is complete, including dummy final exam marks**, to show totals out of 100.
- Edge cases: detained student `204CS25058` (in Sem 1), lateral entries `204CS26301–303`, mid-term joiner `204CS26061`, batch change `204CS25015`, dropout `204ME25044`.
- Parent phone numbers are fake (`+918000…`). **Never point a live WhatsApp/SMS provider at dummy data.**
