# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Teachers (faculty, class teachers, HODs):** use it on their phones, mostly in the classroom or staff room. They take attendance for a class period, enter test marks, and (HOD) decide leave and publish department updates.
- **Parents:** use it on their phones through the parent portal and WhatsApp messages. They see attendance, marks, leave and college updates for their child.
- **Principal:** uses it on a phone, view only. Needs the whole college at a glance.
- **Office staff:** the only users on laptops (college computers). They handle records, leave notices and college-wide updates.

Phone is the primary screen for everyone except the office.

## Product Purpose

The official attendance, marks and parent-messaging system for MEI Polytechnic, Bengaluru. Success means:

- paper attendance registers and mark sheets are replaced;
- parents hear about absences, marks and updates quickly;
- attendance shortage (the exam eligibility rule) is caught early enough to act on;
- the principal can oversee every department without asking.

## Positioning

Built for this one college's real rules rather than a generic school app: the printed department timetable, the C-25 diploma syllabus and CIE marks scheme, per-period attendance with substitute teachers, HOD-decided leave outcomes, and the eligibility shortage rule. Built by a student; maintained later by a college lecturer, so it must stay plain and readable.

## Operating Context

- Attendance opens on the department's day timetable, laid out like the printed sheet; a teacher taps a class period and marks the students.
- Any faculty member of the department can take an untaken class; once saved, it belongs to the saver, the subject teacher and the HOD.
- Marks: the subject teacher saves privately, then presses "Done – show to parents"; marks stay correctable afterwards.
- Parent messages go out on WhatsApp (the Meta business account is pending the college PAN/GST); demos use a mock sender.
- Demos run on a laptop over Wi-Fi or a phone hotspot, with phones connecting to it.

## Capabilities and Constraints

- Roles: admin, principal (view only), HOD, class teacher, faculty, office, parent. Rules are enforced in the database as well as the UI.
- Faculty never see parent messages (each message costs money).
- Real messages must never be sent to dummy/demo data.
- Must be reliable and fast on ordinary phones and college Wi-Fi.
- Stack is fixed by the existing code: Next 16, React 19, Tailwind, Postgres; no UI library.
- Open: SMS provider, minor-subject result out of 50 or 100, Kannada message wording check (see docs/PLAN.md).

## Brand Commitments

- College name: MEI Polytechnic, Bengaluru. The official college logo must appear.
- Parent-facing text must also be available in Kannada.
- Tone is formal, official and plain (government-aided college); no slang or marketing voice.

## Evidence on Hand

- The real printed timetable PDF and C-25 subject list (docs/c25-subjects.md) shaped the screens.
- Official logo: `MEilogo.png` (full letterhead: society name, emblem, wordmark, "Govt. Aided Institution", AICTE/DTE line). `public/mei-logo.png` is the emblem + wordmark cropped from it with a transparent background, used in the app headers and sign-in page. Never redraw it.
- No real student data in the repo; the seed is dummy demo data.

## Product Principles

1. Phone first: every staff and parent task must be quick with one thumb on a small screen.
2. Match the college's paper: screens follow the printed timetable and registers staff already know.
3. Official and trustworthy: plain formal wording, every change audited, nothing hidden from the people responsible.
4. Never cost or embarrass the college: no stray messages, no wrong data shown to parents.
5. Maintainable by a lecturer: plain code and plain screens over clever ones.

## Accessibility & Inclusion

- Parents may read Kannada rather than English.
- Users range from young staff to older parents on cheap phones: readable text sizes and large tap targets.
