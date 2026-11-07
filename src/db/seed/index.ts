/**
 * Dummy data for the demo. Deterministic: same SEED_UNTIL → same data.
 *
 *   npm run db:seed     seed an empty database
 *   npm run db:reset    wipe + migrate + seed (local databases only)
 *
 * What it builds (PLAN.md §13 phase 1):
 * - 7 departments × Sem 1/3/5 (odd term 2026-27) × 60 students, register numbers like 204CS25012
 * - Official CS timetables; other departments reuse the same grids with their own (placeholder) subjects
 * - Faculty assigned so nobody is double-booked; HODs, class teachers, principal, admin
 * - Parents (1–2 numbers each), consent mostly recorded
 * - Attendance from term start until SEED_UNTIL, with the last two days partly unmarked ("pending")
 * - Leave/OD notices; marks mid-term (tests 1 and 2), CS Sem 1 complete with final exam marks
 * - Edge cases: detained student, lateral entries, mid-term joiner, batch change, dropout
 * - One account per role (admin, principal, office, HODs, class teachers, teachers), staff leave
 *   (past, today, waiting for the HOD / principal), college updates with their (mock-sent) WhatsApp messages
 * - DEMO_PARENT_PHONE (.env): your own number for the demo guardian, so the parent portal code and
 *   updates reach your phone when a real WhatsApp provider is set up (with NOTIFY_ALLOWED_NUMBERS).
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb, createPool, type Db } from "../client";
import * as t from "../schema";
import { resolveDay, type CalendarEntry } from "@/lib/domain/calendar";
import { addDays, dateRange, isoWeekday, todayIn, type IsoDate } from "@/lib/domain/dates";
import { sessionAppliesTo, type Batch, type MembershipFact } from "@/lib/domain/attendance";
import { formatRegNo } from "@/lib/domain/regNo";
import { normalizeIndianMobile } from "@/lib/domain/phone";
import { dedupeKey } from "@/lib/notify/rules";
import { loadContacts, prepare } from "@/server/notify/outbox";
import { findSlotConflicts, planSessionsForDay, type SlotDef, type VersionDef } from "@/lib/domain/timetable";
import { DEPARTMENTS, FIRST_NAMES_F, FIRST_NAMES_M, STAFF_TITLES, SUBJECTS, SURNAMES, type DeptCode, type SubjectDef } from "./catalog";
import { hashPassword } from "@/lib/auth/password";
import { createRng } from "./random";
import { gridForSemester, parseGrid, type GridSlot } from "./timetables";

const RNG_SEED = 2026_27;
const DEMO_PASSWORD = process.env.SEED_STAFF_PASSWORD || "meidemo2026";
const COLLEGE_CODE = "204";
const TERM_START: IsoDate = "2026-08-17";
/** Parent portal demo number (linked to two siblings); DEMO_PARENT_PHONE in .env replaces it with yours. */
const DEMO_PARENT_PHONE = demoParentPhone();
const TERM_END: IsoDate = "2026-12-31";
const SEMESTERS = [1, 3, 5] as const;
const ADMISSION_YEAR: Record<(typeof SEMESTERS)[number], number> = { 1: 2026, 3: 2025, 5: 2024 };
const STUDENTS_PER_CLASS = 60;
const INITIAL_FACULTY_PER_DEPT = 6;
const CS_INDEX = DEPARTMENTS.findIndex((d) => d.code === "CS");

const rng = createRng(RNG_SEED);

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function insertChunked<T>(rows: T[], size: number, insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

function personName(gender: "MALE" | "FEMALE") {
  return `${rng.pick(gender === "MALE" ? FIRST_NAMES_M : FIRST_NAMES_F)} ${rng.pick(SURNAMES)}`;
}

/** Spread departments over different weekdays so shared teachers are not all needed at once. CS keeps the official grid. */
function rotateWeekday(weekday: number, deptIndex: number) {
  if (weekday === 6) return 6;
  const offset = (deptIndex - CS_INDEX + 5) % 5;
  return ((weekday - 1 + offset) % 5) + 1;
}

function demoParentPhone(): string {
  const raw = process.env.DEMO_PARENT_PHONE?.trim();
  if (!raw) return "+919000000001";
  const r = normalizeIndianMobile(raw);
  if (!r.ok) throw new Error(`DEMO_PARENT_PHONE: ${r.error}`);
  return r.value;
}

function assertLocalDatabase(url: string) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host) && process.env.SEED_ALLOW_REMOTE_RESET !== "yes") {
    throw new Error(`Refusing to wipe non-local database at "${host}". Set SEED_ALLOW_REMOTE_RESET=yes if you really mean it.`);
  }
}

async function wipe(db: Db) {
  const { rows } = await db.execute<{ tablename: string }>(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}

// ---------------------------------------------------------------------------

interface StaffDraft {
  key: string;
  name: string;
  deptCode: DeptCode | null;
  designation: string;
  busy: Set<string>;
  load: number;
}

interface ClassInfo {
  key: string;
  id: number;
  deptCode: DeptCode;
  deptId: number;
  deptIndex: number;
  semester: (typeof SEMESTERS)[number];
  subjects: SubjectDef[];
  offeringIds: number[];
  slots: GridSlot[];
}

interface StudentInfo {
  id: number;
  regNo: string;
  classKey: string;
  attendanceP: number;
  ability: number;
  membership: MembershipFact;
}

async function seed(tx: Tx, until: IsoDate) {
  // --- College configuration -------------------------------------------------
  // demoData: marks this as the dummy college (login hints; real messages to everyone are refused).
  await tx.insert(t.collegeSettings).values({ id: 1, collegeCode: COLLEGE_CODE, name: "MEI Polytechnic, Bengaluru", demoData: true });
  await tx.insert(t.period).values([
    { ordinal: 1, label: "P1", startsAt: "09:00", endsAt: "10:00" },
    { ordinal: 2, label: "P2", startsAt: "10:00", endsAt: "11:00" },
    { ordinal: 3, label: "P3", startsAt: "11:00", endsAt: "12:00" },
    { ordinal: 4, label: "P4", startsAt: "12:00", endsAt: "13:00" },
    { ordinal: 5, label: "P5", startsAt: "13:30", endsAt: "14:30" },
    { ordinal: 6, label: "P6", startsAt: "14:30", endsAt: "15:30" },
    { ordinal: 7, label: "P7", startsAt: "15:30", endsAt: "16:30" },
  ]);
  // [OPEN] PLAN.md §14 Q7 — defaults until the college decides.
  await tx.insert(t.leavePolicy).values([
    { type: "MEDICAL", countsAs: "ABSENT" },
    { type: "ON_DUTY", countsAs: "PRESENT" },
    { type: "PERSONAL", countsAs: "ABSENT" },
    { type: "OTHER", countsAs: "ABSENT" },
  ]);

  const [year] = await tx.insert(t.academicYear).values({ label: "2026-27", startsOn: "2026-08-01", endsOn: "2027-07-31" }).returning();
  const [oddTerm] = await tx.insert(t.term).values({ academicYearId: year.id, kind: "ODD", startsOn: TERM_START, endsOn: TERM_END }).returning();

  const deptRows = await tx.insert(t.department).values(DEPARTMENTS.map((d) => ({ code: d.code, name: d.name }))).returning();
  const deptId = new Map(deptRows.map((d) => [d.code as DeptCode, d.id]));

  // --- Marks schemes (confirmed rules, docs/PLAN.md §7) ----------------------
  const cie = (codes: [string, string, "THEORY" | "PRACTICAL"][]) => codes.map(([code, label, component]) => ({ code, label, component, isFinal: false, maxMarks: 50 }));
  const MAIN_CIE = cie([
    ["CIE_T1", "Theory test 1", "THEORY"],
    ["CIE_T2", "Theory test 2", "THEORY"],
    ["CIE_P1", "Practical test 1", "PRACTICAL"],
    ["CIE_P2", "Practical test 2", "PRACTICAL"],
    ["ACT", "Activity", "THEORY"],
  ]);
  const schemeDefs = {
    MAIN_THEORY: {
      name: "Main subject, theory final exam",
      formula: { cieOutOf: 50, seeOutOf: 50 },
      note: "CIE: 5 parts x 50 = 250, scaled to 50. Final theory exam /100 scaled to 50. Total /100.",
      parts: [...MAIN_CIE, { code: "SEE", label: "Final exam (theory)", component: "THEORY", isFinal: true, maxMarks: 100 }],
    },
    MAIN_PRACTICAL: {
      name: "Main subject, practical final exam",
      formula: { cieOutOf: 50, seeOutOf: 50 },
      note: "CIE: 5 parts x 50 = 250, scaled to 50. Final practical exam /100 scaled to 50. Total /100.",
      parts: [...MAIN_CIE, { code: "SEE", label: "Final exam (practical)", component: "PRACTICAL", isFinal: true, maxMarks: 100 }],
    },
    MINOR: {
      name: "Minor subject (English / Kannada / EVS), no final",
      formula: { cieOutOf: 50, seeOutOf: null },
      note: "CIE: 4 theory tests + activity = 250, scaled to 50. No final exam. [OPEN] result out of 50 or 100.",
      parts: cie([
        ["CIE_T1", "Theory test 1", "THEORY"],
        ["CIE_T2", "Theory test 2", "THEORY"],
        ["CIE_T3", "Theory test 3", "THEORY"],
        ["CIE_T4", "Theory test 4", "THEORY"],
        ["ACT", "Activity", "THEORY"],
      ]),
    },
  } as const;
  type SchemeKey = keyof typeof schemeDefs;
  const schemeId = new Map<SchemeKey, number>();
  const schemeComponents = new Map<SchemeKey, { id: number; code: string; maxMarks: number; component: "THEORY" | "PRACTICAL" }[]>();
  for (const [key, def] of Object.entries(schemeDefs) as [SchemeKey, (typeof schemeDefs)[SchemeKey]][]) {
    const [scheme] = await tx.insert(t.assessmentScheme).values({ name: def.name, formula: def.formula, note: def.note }).returning();
    schemeId.set(key, scheme.id);
    const rows = await tx
      .insert(t.schemeComponent)
      .values(def.parts.map((c, i) => ({ schemeId: scheme.id, ordinal: i + 1, ...c })))
      .returning();
    schemeComponents.set(key, rows.map((r) => ({ id: r.id, code: r.code, maxMarks: r.maxMarks, component: r.component })));
  }
  /** C-25: 4-0-4 courses have a theory final, 3-0-4 courses a practical one, audit courses none. */
  const schemeFor = (subjects: readonly SubjectDef[], i: number): SchemeKey =>
    subjects[i].see === null ? "MINOR" : subjects[i].see === "THEORY" ? "MAIN_THEORY" : "MAIN_PRACTICAL";

  // --- Classes, courses, offerings ------------------------------------------
  const classes: ClassInfo[] = [];
  for (const [deptIndex, d] of DEPARTMENTS.entries()) {
    for (const semester of SEMESTERS) {
      const [cg] = await tx.insert(t.classGroup).values({ departmentId: deptId.get(d.code)!, termId: oddTerm.id, semester }).returning();
      const subjects = SUBJECTS[d.code][semester];
      const offeringIds: number[] = [];
      for (const [i, subj] of subjects.entries()) {
        const [c] = await tx
          .insert(t.course)
          .values({
            departmentId: deptId.get(d.code)!,
            semester,
            code: subj.code,
            shortName: subj.shortName,
            name: subj.name,
            kind: subj.kind,
            schemeId: schemeId.get(schemeFor(subjects, i))!,
          })
          .returning();
        const [o] = await tx.insert(t.courseOffering).values({ courseId: c.id, classGroupId: cg.id }).returning();
        offeringIds.push(o.id);
      }
      const slots = parseGrid(gridForSemester(semester)).map((s) => ({ ...s, weekday: rotateWeekday(s.weekday, deptIndex) }));
      classes.push({ key: `${d.code}-${semester}`, id: cg.id, deptCode: d.code, deptId: deptId.get(d.code)!, deptIndex, semester, subjects, offeringIds, slots });
    }
  }

  // --- Staff & teaching assignments (greedy, no double-booking) -------------
  const staffDrafts: StaffDraft[] = [];
  const pools = new Map<string, StaffDraft[]>();
  const newStaff = (poolKey: string, deptCode: DeptCode | null, designation: string) => {
    const gender = rng.chance(0.5) ? "MALE" : "FEMALE";
    const draft: StaffDraft = { key: `${poolKey}#${(pools.get(poolKey)?.length ?? 0) + 1}`, name: personName(gender), deptCode, designation, busy: new Set(), load: 0 };
    staffDrafts.push(draft);
    pools.set(poolKey, [...(pools.get(poolKey) ?? []), draft]);
    return draft;
  };
  for (const d of DEPARTMENTS) {
    newStaff(d.code, d.code, "Head of Department");
    for (let i = 0; i < INITIAL_FACULTY_PER_DEPT; i++) newStaff(d.code, d.code, rng.pick(STAFF_TITLES));
  }

  const assignmentDrafts: { offeringId: number; component: "THEORY" | "PRACTICAL"; staff: StaffDraft }[] = [];
  for (const c of classes) {
    for (const [i, subj] of c.subjects.entries()) {
      for (const component of ["THEORY", "PRACTICAL"] as const) {
        const cells = new Set<string>();
        for (const s of c.slots) {
          if (s.kind !== "CLASS" || s.subjectKey !== `S${i + 1}` || s.component !== component) continue;
          for (let p = s.startPeriod; p <= s.endPeriod; p++) cells.add(`${s.weekday}-${p}`);
        }
        if (cells.size === 0) continue;
        const poolKey = subj.pool ?? c.deptCode;
        const candidates = (pools.get(poolKey) ?? [])
          .filter((st) => ![...cells].some((cell) => st.busy.has(cell)))
          .sort((a, b) => a.load - b.load);
        const teacher = candidates[0] ?? newStaff(poolKey, subj.pool ? null : c.deptCode, rng.pick(STAFF_TITLES));
        cells.forEach((cell) => teacher.busy.add(cell));
        teacher.load++;
        assignmentDrafts.push({ offeringId: c.offeringIds[i], component, staff: teacher });
      }
    }
  }

  const principal = newStaff("OFFICE", null, "Principal");
  const admin = newStaff("OFFICE", null, "Office Administrator");
  const officeHead = newStaff("OFFICE", null, "Office Superintendent");
  const officeClerk = newStaff("OFFICE", null, "First Division Assistant");
  const nonTeaching = new Set([principal, admin, officeHead, officeClerk]);
  // Admin, principal and office get the first phone numbers so demo logins are easy to remember.
  const orderedStaff = [admin, principal, officeHead, officeClerk, ...staffDrafts.filter((s) => !nonTeaching.has(s))];
  // Same demo password for everyone (one hash, computed once). Real staff get temporary passwords from the admin.
  const demoHash = await hashPassword(DEMO_PASSWORD);
  const staffRows = await tx
    .insert(t.staff)
    .values(
      orderedStaff.map((s, i) => ({
        name: s.name,
        phone: `+917000${String(i + 1).padStart(6, "0")}`,
        departmentId: s.deptCode ? deptId.get(s.deptCode)! : null,
        designation: s.designation,
        passwordHash: demoHash,
        mustChangePassword: false,
      })),
    )
    .returning();
  const staffId = new Map(orderedStaff.map((s, i) => [s, staffRows[i].id]));
  const staffPhone = new Map(orderedStaff.map((s, i) => [s, staffRows[i].phone]));

  await tx.insert(t.teachingAssignment).values(
    assignmentDrafts.map((a) => ({ offeringId: a.offeringId, component: a.component, batchScope: "ALL" as const, staffId: staffId.get(a.staff)! })),
  );
  const teacherOf = new Map(assignmentDrafts.map((a) => [`${a.offeringId}-${a.component}`, staffId.get(a.staff)!]));

  // --- Roles -------------------------------------------------------------------
  const hodOf = new Map<DeptCode, number>();
  const grants: (typeof t.roleGrant.$inferInsert)[] = [
    { staffId: staffId.get(principal)!, role: "PRINCIPAL" },
    { staffId: staffId.get(admin)!, role: "ADMIN" },
    { staffId: staffId.get(officeHead)!, role: "OFFICE" },
    { staffId: staffId.get(officeClerk)!, role: "OFFICE" },
  ];
  for (const d of DEPARTMENTS) {
    const hod = pools.get(d.code)![0];
    hodOf.set(d.code, staffId.get(hod)!);
    grants.push({ staffId: staffId.get(hod)!, role: "HOD", departmentId: deptId.get(d.code)! });
  }
  for (const s of staffDrafts) {
    if (!nonTeaching.has(s)) {
      grants.push({ staffId: staffId.get(s)!, role: "FACULTY", departmentId: s.deptCode ? deptId.get(s.deptCode)! : null });
    }
  }
  const classTeacherOf = new Map<string, number>();
  for (const c of classes) {
    const pool = pools.get(c.deptCode)!;
    const ct = pool[1 + SEMESTERS.indexOf(c.semester)];
    classTeacherOf.set(c.key, staffId.get(ct)!);
    grants.push({ staffId: staffId.get(ct)!, role: "CLASS_TEACHER", classGroupId: c.id });
  }
  await tx.insert(t.roleGrant).values(grants);

  // --- Timetables -----------------------------------------------------------
  const versionsByClass = new Map<string, VersionDef[]>();
  for (const c of classes) {
    const [version] = await tx
      .insert(t.timetableVersion)
      .values({ classGroupId: c.id, effectiveFrom: TERM_START, approvedBy: hodOf.get(c.deptCode)!, note: c.deptCode === "CS" ? "Official CS timetable 2026-27" : "Dummy timetable (CS grid, real C-25 subjects where known)" })
      .returning();
    const slotRows = await tx
      .insert(t.timetableSlot)
      .values(
        c.slots.map((s) => ({
          versionId: version.id,
          weekday: s.weekday,
          startPeriod: s.startPeriod,
          endPeriod: s.endPeriod,
          kind: s.kind,
          offeringId: s.subjectKey ? c.offeringIds[Number(s.subjectKey.slice(1)) - 1] : null,
          component: s.component,
          batchScope: s.batchScope,
        })),
      )
      .returning();
    const slots: SlotDef[] = slotRows.map((r) => ({
      id: r.id,
      weekday: r.weekday,
      startPeriod: r.startPeriod,
      endPeriod: r.endPeriod,
      kind: r.kind,
      offeringId: r.offeringId,
      component: r.component,
      batchScope: r.batchScope,
    }));
    const conflicts = findSlotConflicts(slots);
    if (conflicts.length) throw new Error(`Timetable conflict in ${c.key}: ${conflicts[0].reason}`);
    versionsByClass.set(c.key, [{ id: version.id, effectiveFrom: TERM_START, slots }]);
  }

  // --- Calendar (dummy dates — the college will maintain the real one) -------
  const cs5 = classes.find((c) => c.key === "CS-5")!;
  const calendarRows: (typeof t.calendarDay.$inferInsert)[] = [
    { date: "2026-08-15", type: "HOLIDAY", note: "Independence Day" },
    { date: "2026-09-14", type: "HOLIDAY", note: "Ganesh Chaturthi (dummy date)" },
    { date: "2026-09-21", type: "EXAM", note: "CIE-1" },
    { date: "2026-09-22", type: "EXAM", note: "CIE-1" },
    { date: "2026-09-23", type: "EXAM", note: "CIE-1" },
    { date: "2026-10-02", type: "HOLIDAY", note: "Gandhi Jayanti" },
    { date: "2026-10-09", type: "HOLIDAY", classGroupId: cs5.id, note: "Industrial visit — no classes" },
    { date: "2026-10-19", type: "HOLIDAY", note: "Mahanavami (dummy date)" },
    { date: "2026-10-20", type: "HOLIDAY", note: "Vijayadashami (dummy date)" },
    { date: "2026-10-24", type: "WORKING", followsWeekday: 1, note: "Compensatory working day — Monday timetable" },
    { date: "2026-10-30", type: "EVENT", note: "Sports Day (classes run)" },
    { date: "2026-11-01", type: "HOLIDAY", note: "Kannada Rajyotsava" },
    // Coming up (shown on the staff and parent calendars).
    { date: "2026-11-10", type: "HOLIDAY", note: "Balipadyami / Deepavali" },
    { date: "2026-11-20", type: "EVENT", note: "Parent–teacher meeting (classes run)" },
    { date: "2026-11-27", type: "HOLIDAY", note: "Kanakadasa Jayanti" },
    { date: "2026-12-07", type: "EXAM", note: "CIE-3" },
    { date: "2026-12-08", type: "EXAM", note: "CIE-3" },
    { date: "2026-12-09", type: "EXAM", note: "CIE-3" },
    { date: "2026-12-25", type: "HOLIDAY", note: "Christmas" },
  ];
  await tx.insert(t.calendarDay).values(calendarRows.map((r) => ({ ...r, createdBy: staffId.get(officeHead)! })));
  const calendar: CalendarEntry[] = calendarRows.map((r) => ({
    date: r.date,
    type: r.type,
    followsWeekday: r.followsWeekday ?? null,
    departmentId: r.departmentId ?? null,
    classGroupId: r.classGroupId ?? null,
    note: r.note ?? null,
  }));

  // --- Students, memberships, parents --------------------------------------
  interface StudentDraft {
    classKey: string;
    regNo: string;
    deptCode: DeptCode;
    admissionYear: number;
    lateral: boolean;
    status: "ACTIVE" | "DROPPED";
    joinedOn: IsoDate;
    leftOn: IsoDate | null;
    batches: { batch: Batch; effectiveFrom: IsoDate }[];
  }
  const drafts: StudentDraft[] = [];
  const regular = (c: ClassInfo, roll: number, overrides: Partial<StudentDraft> = {}): StudentDraft => ({
    classKey: c.key,
    regNo: formatRegNo({ collegeCode: COLLEGE_CODE, departmentCode: c.deptCode, admissionYear: ADMISSION_YEAR[c.semester], roll }),
    deptCode: c.deptCode,
    admissionYear: ADMISSION_YEAR[c.semester],
    lateral: false,
    status: "ACTIVE",
    joinedOn: TERM_START,
    leftOn: null,
    batches: [{ batch: roll <= STUDENTS_PER_CLASS / 2 ? "B1" : "B2", effectiveFrom: TERM_START }],
    ...overrides,
  });
  for (const c of classes) {
    for (let roll = 1; roll <= STUDENTS_PER_CLASS; roll++) {
      // Edge case: CS 2025 roll 58 was detained and repeats Sem 1 (added below).
      if (c.key === "CS-3" && roll === 58) continue;
      if (c.key === "CS-3" && roll === 15) {
        drafts.push(regular(c, roll, { batches: [{ batch: "B1", effectiveFrom: TERM_START }, { batch: "B2", effectiveFrom: "2026-10-01" }] }));
        continue;
      }
      if (c.key === "ME-3" && roll === 44) {
        drafts.push(regular(c, roll, { status: "DROPPED", leftOn: "2026-10-10" }));
        continue;
      }
      drafts.push(regular(c, roll));
    }
  }
  const cs1 = classes.find((c) => c.key === "CS-1")!;
  const cs3 = classes.find((c) => c.key === "CS-3")!;
  drafts.push({ ...regular(cs1, 58), regNo: "204CS25058", admissionYear: 2025, batches: [{ batch: "B2", effectiveFrom: TERM_START }] });
  drafts.push(regular(cs1, 61, { joinedOn: "2026-09-07", batches: [{ batch: "B2", effectiveFrom: "2026-09-07" }] }));
  for (const [i, roll] of [301, 302, 303].entries()) {
    drafts.push({
      ...regular(cs3, roll),
      regNo: formatRegNo({ collegeCode: COLLEGE_CODE, departmentCode: "CS", admissionYear: 2026, roll }),
      admissionYear: 2026,
      lateral: true,
      batches: [{ batch: i === 0 ? "B1" : "B2", effectiveFrom: TERM_START }],
    });
  }

  const genders = drafts.map(() => (rng.chance(0.5) ? ("MALE" as const) : ("FEMALE" as const)));
  const studentRows = await tx
    .insert(t.student)
    .values(
      drafts.map((d, i) => ({
        regNo: d.regNo,
        name: personName(genders[i]),
        gender: genders[i],
        departmentId: deptId.get(d.deptCode)!,
        admissionYear: d.admissionYear,
        lateralEntry: d.lateral,
        status: d.status,
      })),
    )
    .returning();

  const classByKey = new Map(classes.map((c) => [c.key, c]));
  const membershipRows = await tx
    .insert(t.classMembership)
    .values(drafts.map((d, i) => ({ studentId: studentRows[i].id, classGroupId: classByKey.get(d.classKey)!.id, termId: oddTerm.id, joinedOn: d.joinedOn, leftOn: d.leftOn })))
    .returning();
  await tx.insert(t.batchAssignment).values(drafts.flatMap((d, i) => d.batches.map((b) => ({ membershipId: membershipRows[i].id, batch: b.batch, effectiveFrom: b.effectiveFrom }))));

  let parentSeq = 1;
  const parentRows: (typeof t.parentContact.$inferInsert)[] = [];
  for (const s of studentRows) {
    const surname = s.name.split(" ").slice(1).join(" ");
    const consent = rng.chance(0.92);
    const contact = (relation: "FATHER" | "MOTHER", gender: "MALE" | "FEMALE") => ({
      studentId: s.id,
      relation,
      name: `${rng.pick(gender === "MALE" ? FIRST_NAMES_M : FIRST_NAMES_F)} ${surname}`,
      phone: `+918${String(parentSeq++).padStart(9, "0")}`,
      language: rng.pick(["BOTH", "BOTH", "BOTH", "KN", "EN"] as const),
      whatsappOk: rng.chance(0.97),
      consentAt: consent ? new Date(`${TERM_START}T10:00:00+05:30`) : null,
      consentMethod: consent ? "Signed admission form (dummy)" : null,
    });
    parentRows.push(contact("FATHER", "MALE"));
    if (rng.chance(0.5)) parentRows.push(contact("MOTHER", "FEMALE"));
  }
  // Demo parent portal login: one guardian number linked to two siblings (CS Sem 3 and CS Sem 1).
  // Added after the random contacts and without the RNG, so the rest of the dummy data is unchanged.
  const firstActive = (key: string) => studentRows.find((s, i) => drafts[i].classKey === key && s.status === "ACTIVE")!;
  for (const sib of [firstActive("CS-3"), firstActive("CS-1")]) {
    parentRows.push({
      studentId: sib.id,
      relation: "GUARDIAN",
      name: "Demo Guardian",
      phone: DEMO_PARENT_PHONE,
      language: "BOTH",
      whatsappOk: true,
      consentAt: new Date(`${TERM_START}T10:00:00+05:30`),
      consentMethod: "Signed admission form (dummy)",
    });
  }
  await insertChunked(parentRows, 2000, (chunk) => tx.insert(t.parentContact).values(chunk));

  const students: StudentInfo[] = studentRows.map((s, i) => {
    const r = rng.next();
    const attendanceP = r < 0.08 ? rng.range(0.45, 0.62) : r < 0.2 ? rng.range(0.65, 0.8) : rng.range(0.85, 0.98);
    return {
      id: s.id,
      regNo: s.regNo,
      classKey: drafts[i].classKey,
      attendanceP,
      ability: Math.min(0.95, Math.max(0.2, 0.3 + 0.5 * attendanceP + rng.normal(0, 0.08))),
      membership: { joinedOn: drafts[i].joinedOn, leftOn: drafts[i].leftOn, batches: drafts[i].batches },
    };
  });
  const studentsByClass = new Map<string, StudentInfo[]>();
  for (const s of students) studentsByClass.set(s.classKey, [...(studentsByClass.get(s.classKey) ?? []), s]);

  // --- Leave / OD notices ---------------------------------------------------
  const leaveDays = new Map<number, Set<IsoDate>>();
  const lastMarkedDay = addDays(until, -2);
  const leaveRows: (typeof t.leaveNotice.$inferInsert)[] = [];
  for (let i = 0; i < 60 && lastMarkedDay > TERM_START; i++) {
    const s = rng.pick(students);
    const c = classByKey.get(s.classKey)!;
    const type = rng.pick(["ON_DUTY", "ON_DUTY", "MEDICAL", "MEDICAL", "PERSONAL"] as const);
    const span = type === "MEDICAL" ? rng.int(2, 4) : rng.int(1, 2);
    const days = dateRange(TERM_START, lastMarkedDay);
    const from = days[rng.int(0, Math.max(0, days.length - span))];
    const to = addDays(from, span - 1);
    const status = i % 12 === 0 ? ("PENDING" as const) : ("APPROVED" as const);
    leaveRows.push({
      studentId: s.id,
      type,
      fromDate: from,
      toDate: to,
      reason: type === "ON_DUTY" ? rng.pick(["Inter-polytechnic sports meet", "NSS camp", "Technical fest"]) : type === "MEDICAL" ? "Fever (medical certificate submitted)" : "Family function",
      status,
      createdBy: classTeacherOf.get(c.key)!,
      approvedBy: status === "APPROVED" ? hodOf.get(c.deptCode)! : null,
      approvedAt: status === "APPROVED" ? new Date(`${to}T16:00:00+05:30`) : null,
    });
    const set = leaveDays.get(s.id) ?? new Set<IsoDate>();
    dateRange(from, to).forEach((d) => set.add(d));
    leaveDays.set(s.id, set);
  }
  if (leaveRows.length) await tx.insert(t.leaveNotice).values(leaveRows);

  // --- Sessions & attendance ----------------------------------------------
  const dayAbsent = new Map<string, boolean>();
  let sessionCount = 0;
  let recordCount = 0;
  for (const c of classes) {
    const versions = versionsByClass.get(c.key)!;
    const sessionDrafts: (typeof t.classSession.$inferInsert)[] = [];
    for (const date of dateRange(TERM_START, until)) {
      const day = resolveDay(date, calendar, { departmentId: c.deptId, classGroupId: c.id });
      for (const p of planSessionsForDay(day, versions)) {
        const teacher = teacherOf.get(`${p.offeringId}-${p.component}`)!;
        const pendingWindow = date > lastMarkedDay;
        const status = pendingWindow && rng.chance(0.4) ? "SCHEDULED" : rng.chance(0.015) ? "NOT_HELD" : "HELD";
        sessionDrafts.push({
          offeringId: p.offeringId,
          component: p.component,
          batchScope: p.batchScope,
          date,
          startPeriod: p.startPeriod,
          endPeriod: p.endPeriod,
          source: "TIMETABLE",
          slotId: p.slotId,
          status,
          statusReason: status === "NOT_HELD" ? "Faculty on leave" : null,
          markedBy: status === "SCHEDULED" ? null : teacher,
          markedAt: status === "SCHEDULED" ? null : new Date(`${date}T${rng.chance(0.6) ? "17:30" : "12:45"}:00+05:30`),
        });
      }
    }
    const inserted: { id: number; slotId: number | null; date: string }[] = [];
    await insertChunked(sessionDrafts, 2000, async (chunk) => {
      inserted.push(...(await tx.insert(t.classSession).values(chunk).returning({ id: t.classSession.id, slotId: t.classSession.slotId, date: t.classSession.date })));
    });
    const idByKey = new Map(inserted.map((r) => [`${r.slotId}|${r.date}`, r.id]));
    sessionCount += inserted.length;

    const records: (typeof t.attendanceRecord.$inferInsert)[] = [];
    for (const sd of sessionDrafts) {
      if (sd.status !== "HELD") continue;
      const sessionId = idByKey.get(`${sd.slotId}|${sd.date}`)!;
      const fact = { id: sessionId, offeringId: sd.offeringId, component: sd.component, batchScope: sd.batchScope!, date: sd.date, status: "HELD" as const };
      for (const s of studentsByClass.get(c.key)!) {
        if (!sessionAppliesTo(fact, s.membership)) continue;
        const key = `${s.id}|${sd.date}`;
        if (!dayAbsent.has(key)) dayAbsent.set(key, rng.chance((1 - s.attendanceP) * 0.75));
        let status: "PRESENT" | "ABSENT" | "LATE";
        if (leaveDays.get(s.id)?.has(sd.date) || dayAbsent.get(key)) status = "ABSENT";
        else if (rng.chance((1 - s.attendanceP) * 0.25)) status = "ABSENT";
        else status = rng.chance(0.03) ? "LATE" : "PRESENT";
        records.push({ sessionId, studentId: s.id, status, markedBy: sd.markedBy!, markedAt: sd.markedAt! });
      }
    }
    await insertChunked(records, 5000, (chunk) => tx.insert(t.attendanceRecord).values(chunk));
    recordCount += records.length;
  }

  // --- Assessments & marks --------------------------------------------------
  // Mid-term picture: tests 1 published, tests 2 mostly published (CS Sem 3 still waiting for the HOD),
  // minor test 3 submitted, activity not entered yet. CS Sem 1 is complete including final exam marks,
  // so totals out of 100 can be demonstrated (dummy: the real finals come after the term).
  let markCount = 0;
  type Plan = { code: string; heldOn: IsoDate; status: "DRAFT" | "SUBMITTED" | "PUBLISHED"; fill?: number };
  for (const c of classes) {
    const hod = hodOf.get(c.deptCode)!;
    const complete = c.deptCode === "CS" && c.semester === 1;
    const pendingHod = c.deptCode === "CS" && c.semester === 3;
    for (const i of c.subjects.keys()) {
      const offeringId = c.offeringIds[i];
      const key = schemeFor(c.subjects, i);
      const comps = schemeComponents.get(key)!;
      const plan: Plan[] = complete
        ? comps.map((p) => ({ code: p.code, heldOn: p.code === "SEE" ? "2026-10-30" : p.code.endsWith("1") ? "2026-09-22" : p.code === "ACT" ? "2026-10-28" : "2026-10-15", status: "PUBLISHED" }))
        : key === "MINOR"
          ? [
              { code: "CIE_T1", heldOn: "2026-09-22", status: "PUBLISHED" },
              { code: "CIE_T2", heldOn: "2026-10-15", status: "PUBLISHED" },
              { code: "CIE_T3", heldOn: "2026-10-29", status: "SUBMITTED" },
            ]
          : [
              { code: "CIE_T1", heldOn: "2026-09-22", status: "PUBLISHED" },
              { code: "CIE_P1", heldOn: "2026-09-22", status: "PUBLISHED" },
              { code: "CIE_T2", heldOn: "2026-10-15", status: pendingHod ? "SUBMITTED" : "PUBLISHED" },
              // One subject's practical test 2 is half entered (a draft in progress).
              { code: "CIE_P2", heldOn: "2026-10-15", status: pendingHod ? "DRAFT" : "PUBLISHED", fill: pendingHod && i === 0 ? 0.5 : pendingHod ? 0 : 1 },
            ];
      for (const p of plan) {
        if (p.heldOn > until) continue;
        const comp = comps.find((x) => x.code === p.code)!;
        const [a] = await tx
          .insert(t.assessment)
          .values({
            offeringId,
            schemeComponentId: comp.id,
            maxMarks: comp.maxMarks,
            heldOn: p.heldOn,
            status: p.status,
            publishedBy: p.status === "PUBLISHED" ? hod : null,
            publishedAt: p.status === "PUBLISHED" ? new Date(`${addDays(p.heldOn, 3)}T15:00:00+05:30`) : null,
          })
          .returning();
        const enteredBy = teacherOf.get(`${offeringId}-${comp.component}`) ?? hod;
        const members = (studentsByClass.get(c.key) ?? []).filter((s) => s.membership.joinedOn <= p.heldOn && (s.membership.leftOn === null || s.membership.leftOn >= p.heldOn));
        const fill = p.fill ?? 1;
        const marks = members.slice(0, Math.round(members.length * fill)).map((s) => {
          if (rng.chance(0.002)) return { assessmentId: a.id, maxMarks: a.maxMarks, studentId: s.id, value: null, flag: "MP" as const, enteredBy };
          if (rng.chance(0.02)) return { assessmentId: a.id, maxMarks: a.maxMarks, studentId: s.id, value: null, flag: "AB" as const, enteredBy };
          const pct = Math.min(1, Math.max(0.05, rng.normal(s.ability, 0.12)));
          // Mostly whole marks, some halves (practicals are often marked in halves).
          const raw = pct * a.maxMarks;
          const value = rng.chance(0.2) ? Math.round(raw * 2) / 2 : Math.round(raw);
          return { assessmentId: a.id, maxMarks: a.maxMarks, studentId: s.id, value, flag: null, enteredBy };
        });
        if (marks.length) await tx.insert(t.mark).values(marks);
        markCount += marks.length;
      }
    }
  }

  // --- Staff leave ------------------------------------------------------------
  // Each person gets at most one leave here, so the "no overlapping leave" rule always holds.
  // Dates are relative to SEED_UNTIL, so the demo always has leave today, waiting and coming up.
  const csPool = pools.get("CS")!;
  const sid = (s: StaffDraft) => staffId.get(s)!;
  const usedForLeave = new Set<StaffDraft>();
  const at = (d: IsoDate, time = "11:00") => new Date(`${d}T${time}:00+05:30`);
  const staffLeaveRows: (typeof t.staffLeave.$inferInsert)[] = [];
  const addStaffLeave = (
    who: StaffDraft,
    l: { type: "CASUAL" | "MEDICAL" | "EARNED" | "ON_DUTY" | "OTHER"; from: IsoDate; to?: IsoDate; part?: "FULL" | "FN" | "AN"; reason: string },
    decision: { status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; by?: number; note?: string },
  ) => {
    usedForLeave.add(who);
    // Applied a few days before (never after SEED_UNTIL), decided the next day.
    const clamp = (d: IsoDate) => (d > until ? until : d < TERM_START ? TERM_START : d);
    const appliedOn = clamp(addDays(l.from, -3));
    const decidedOn = clamp(addDays(appliedOn, 1));
    staffLeaveRows.push({
      staffId: sid(who),
      type: l.type,
      fromDate: l.from,
      toDate: l.to ?? l.from,
      part: l.part ?? "FULL",
      reason: l.reason,
      status: decision.status,
      decidedBy: decision.by ?? null,
      decidedAt: decision.by ? at(decidedOn) : null,
      decisionNote: decision.note ?? null,
      createdAt: at(appliedOn, "09:30"),
    });
  };
  const principalId = staffId.get(principal)!;
  const workingDay = (d: IsoDate) => (isoWeekday(d) === 7 ? addDays(d, 1) : d);
  // Past leave, decided by each department's HOD.
  const pastReasons = ["Family function", "Fever", "Exam duty at another polytechnic (OD)", "Personal work", "Child unwell"] as const;
  for (const d of DEPARTMENTS) {
    const pool = pools.get(d.code)!;
    for (const [k, teacher] of [pool[4], pool[5]].filter(Boolean).entries()) {
      const from = workingDay(addDays(TERM_START, 10 + rng.int(0, 50)));
      if (from > addDays(until, -5)) continue;
      const reason = pastReasons[(DEPARTMENTS.indexOf(d) + k) % pastReasons.length];
      const type = reason === "Fever" || reason === "Child unwell" ? "MEDICAL" : reason.includes("OD") ? "ON_DUTY" : "CASUAL";
      const rejected = d.code === "CE" && k === 1;
      addStaffLeave(teacher, { type, from, to: type === "MEDICAL" ? workingDay(addDays(from, 1)) : from, reason }, rejected ? { status: "REJECTED", by: hodOf.get(d.code), note: "CIE-1 invigilation that day; please take another date." } : { status: "APPROVED", by: hodOf.get(d.code) });
    }
  }
  const demoTeacher = csPool[csPool.length - 1];
  const csClassTeacher3 = csPool[1 + SEMESTERS.indexOf(3)];
  const freeCs = csPool.filter((s, i) => i > 3 && s !== demoTeacher && !usedForLeave.has(s));
  // Today and coming up.
  addStaffLeave(demoTeacher, { type: "CASUAL", from: workingDay(addDays(until, 3)), reason: "Sister's wedding" }, { status: "APPROVED", by: hodOf.get("CS") });
  addStaffLeave(csClassTeacher3, { type: "CASUAL", from: workingDay(addDays(until, 6)), part: "AN", reason: "Parent meeting at my son's school" }, { status: "PENDING" });
  if (freeCs[0]) addStaffLeave(freeCs[0], { type: "MEDICAL", from: workingDay(addDays(until, 1)), to: workingDay(addDays(until, 2)), reason: "Minor surgery (certificate will be submitted)" }, { status: "PENDING" });
  if (freeCs[1]) addStaffLeave(freeCs[1], { type: "ON_DUTY", from: workingDay(until), reason: "Board of examiners meeting, DTE" }, { status: "APPROVED", by: hodOf.get("CS") });
  addStaffLeave(csPool[0], { type: "EARNED", from: workingDay(addDays(until, 15)), to: workingDay(addDays(until, 16)), reason: "Family function out of station" }, { status: "PENDING" });
  addStaffLeave(officeClerk, { type: "CASUAL", from: workingDay(addDays(until, 4)), reason: "Bank work" }, { status: "PENDING" });
  const ecFree = pools.get("EC")!.find((s, i) => i > 3 && !usedForLeave.has(s));
  if (ecFree) addStaffLeave(ecFree, { type: "MEDICAL", from: workingDay(until), reason: "Fever" }, { status: "APPROVED", by: hodOf.get("EC") });
  const meFree = pools.get("ME")!.find((s, i) => i > 3 && !usedForLeave.has(s));
  if (meFree) addStaffLeave(meFree, { type: "ON_DUTY", from: workingDay(addDays(until, 8)), to: workingDay(addDays(until, 9)), reason: "Faculty development programme, NITTTR" }, { status: "APPROVED", by: hodOf.get("ME") });
  const eeFree = pools.get("EE")!.find((s, i) => i > 3 && !usedForLeave.has(s));
  if (eeFree) addStaffLeave(eeFree, { type: "CASUAL", from: workingDay(addDays(until, 5)), reason: "Personal work" }, { status: "CANCELLED" });
  const ceHod = pools.get("CE")![0];
  addStaffLeave(ceHod, { type: "CASUAL", from: workingDay(addDays(until, -12)), reason: "Personal work" }, { status: "APPROVED", by: principalId });
  await tx.insert(t.staffLeave).values(staffLeaveRows);

  // --- College updates, with their WhatsApp messages (already "sent" by the mock) --------
  const updateDefs: { on: IsoDate; classKey?: string; deptCode?: DeptCode; title: string; en: string; kn: string; by: StaffDraft }[] = [
    {
      on: "2026-08-14",
      title: "Welcome to the odd semester 2026-27",
      en: "Classes for Sem 1, 3 and 5 begin on Monday, 17 August 2026 at 9:00 am. Students must carry their ID card every day.",
      kn: "1, 3 ಮತ್ತು 5ನೇ ಸೆಮಿಸ್ಟರ್ ತರಗತಿಗಳು 17 ಆಗಸ್ಟ್ 2026, ಸೋಮವಾರ ಬೆಳಿಗ್ಗೆ 9:00ಕ್ಕೆ ಆರಂಭವಾಗುತ್ತವೆ. ವಿದ್ಯಾರ್ಥಿಗಳು ಪ್ರತಿದಿನ ಗುರುತಿನ ಚೀಟಿ ತರಬೇಕು.",
      by: principal,
    },
    {
      on: "2026-09-15",
      title: "CIE-1 from 21 September",
      en: "The first internal tests (CIE-1) are on 21, 22 and 23 September. There are no regular classes on these days. The timetable is on the notice board.",
      kn: "ಮೊದಲ ಆಂತರಿಕ ಪರೀಕ್ಷೆಗಳು (CIE-1) ಸೆಪ್ಟೆಂಬರ್ 21, 22 ಮತ್ತು 23 ರಂದು ನಡೆಯಲಿವೆ. ಈ ದಿನಗಳಲ್ಲಿ ಸಾಮಾನ್ಯ ತರಗತಿಗಳು ಇರುವುದಿಲ್ಲ.",
      by: officeHead,
    },
    {
      on: "2026-10-05",
      classKey: "CS-5",
      title: "Industrial visit on 9 October",
      en: "CS Sem 5 students will visit an industry on Friday, 9 October. Students report at the college at 8:00 am. No classes that day.",
      kn: "CS 5ನೇ ಸೆಮಿಸ್ಟರ್ ವಿದ್ಯಾರ್ಥಿಗಳು ಅಕ್ಟೋಬರ್ 9, ಶುಕ್ರವಾರ ಕೈಗಾರಿಕಾ ಭೇಟಿಗೆ ತೆರಳಲಿದ್ದಾರೆ. ಬೆಳಿಗ್ಗೆ 8:00ಕ್ಕೆ ಕಾಲೇಜಿಗೆ ಬರಬೇಕು.",
      by: csPool[0],
    },
    {
      on: "2026-10-14",
      title: "Dasara holidays",
      en: "The college is closed on 19 and 20 October for Mahanavami and Vijayadashami. Saturday 24 October is a working day with the Monday timetable.",
      kn: "ಮಹಾನವಮಿ ಮತ್ತು ವಿಜಯದಶಮಿ ಪ್ರಯುಕ್ತ ಅಕ್ಟೋಬರ್ 19 ಮತ್ತು 20 ರಂದು ಕಾಲೇಜಿಗೆ ರಜೆ. ಅಕ್ಟೋಬರ್ 24, ಶನಿವಾರ ಸೋಮವಾರದ ವೇಳಾಪಟ್ಟಿಯಂತೆ ಕೆಲಸದ ದಿನ.",
      by: officeHead,
    },
    {
      on: "2026-10-28",
      title: "Kannada Rajyotsava celebration",
      en: "Kannada Rajyotsava will be celebrated in the college on Saturday, 31 October at 10:00 am. Parents are welcome. 1 November is a holiday.",
      kn: "ಅಕ್ಟೋಬರ್ 31, ಶನಿವಾರ ಬೆಳಿಗ್ಗೆ 10:00ಕ್ಕೆ ಕಾಲೇಜಿನಲ್ಲಿ ಕನ್ನಡ ರಾಜ್ಯೋತ್ಸವ ಆಚರಣೆ. ಪೋಷಕರಿಗೆ ಸ್ವಾಗತ. ನವೆಂಬರ್ 1 ರಜೆ.",
      by: officeHead,
    },
    {
      on: "2026-11-02",
      title: "Deepavali holiday on 10 November",
      en: "The college is closed on Tuesday, 10 November for Balipadyami / Deepavali. Classes run as usual on 9 and 11 November.",
      kn: "ಬಲಿಪಾಡ್ಯಮಿ / ದೀಪಾವಳಿ ಪ್ರಯುಕ್ತ ನವೆಂಬರ್ 10, ಮಂಗಳವಾರ ಕಾಲೇಜಿಗೆ ರಜೆ. ನವೆಂಬರ್ 9 ಮತ್ತು 11 ರಂದು ತರಗತಿಗಳು ಎಂದಿನಂತೆ ನಡೆಯುತ್ತವೆ.",
      by: officeHead,
    },
    {
      on: "2026-11-02",
      deptCode: "CS",
      title: "Parent–teacher meeting, 20 November",
      en: "Parents of CS students are invited to meet the class teachers on Friday, 20 November between 10:00 am and 1:00 pm. Attendance and CIE marks will be discussed.",
      kn: "CS ವಿದ್ಯಾರ್ಥಿಗಳ ಪೋಷಕರು ನವೆಂಬರ್ 20, ಶುಕ್ರವಾರ ಬೆಳಿಗ್ಗೆ 10:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ರೊಳಗೆ ತರಗತಿ ಶಿಕ್ಷಕರನ್ನು ಭೇಟಿಯಾಗಲು ಆಹ್ವಾನ.",
      by: csPool[0],
    },
  ];
  let updateMessages = 0;
  const memberIdx = new Map(studentRows.map((s, i) => [s.id, i]));
  for (const u of updateDefs.filter((x) => x.on <= until)) {
    const cls = u.classKey ? classByKey.get(u.classKey)! : null;
    const publishedAt = at(u.on, "10:30");
    const [row] = await tx
      .insert(t.collegeUpdate)
      .values({
        title: u.title,
        bodyEn: u.en,
        bodyKn: u.kn,
        departmentId: u.deptCode ? deptId.get(u.deptCode)! : null,
        classGroupId: cls?.id ?? null,
        publishedBy: sid(u.by),
        publishedAt,
      })
      .returning({ id: t.collegeUpdate.id });
    const reached = students.filter((s) => {
      const d = drafts[memberIdx.get(s.id)!];
      if (d.status !== "ACTIVE" || d.joinedOn > u.on || (d.leftOn !== null && d.leftOn <= u.on)) return false;
      const c = classByKey.get(s.classKey)!;
      return cls ? c.id === cls.id : u.deptCode ? c.deptCode === u.deptCode : true;
    });
    const contacts = await loadContacts(tx, reached.map((s) => s.id));
    const prepared = reached.flatMap((s) =>
      prepare(
        { trigger: "BROADCAST", studentId: s.id, data: { kind: "BROADCAST", textEn: `${u.title}\n${u.en}`, textKn: `${u.title}\n${u.kn}` }, key: (cid) => dedupeKey.update(row.id, cid) },
        contacts.get(s.id) ?? [],
        publishedAt,
        sid(u.by),
      ),
    );
    const sent = prepared.map((p, i) => ({
      ...p,
      status: "SENT" as const,
      attempts: 1,
      provider: "mock",
      providerMessageId: `mock-seed-${row.id}-${i}`,
      sentAt: new Date(p.scheduledFor.getTime() + 2 * 60_000),
      createdAt: publishedAt,
    }));
    await insertChunked(sent, 2000, (chunk) => tx.insert(t.notification).values(chunk));
    await tx.update(t.collegeUpdate).set({ messages: sent.length }).where(sql`id = ${row.id}`);
    updateMessages += sent.length;
  }

  await tx.insert(t.auditLog).values({
    action: "SEED",
    entity: "database",
    entityId: "all",
    after: { until, rngSeed: RNG_SEED },
    reason: "Dummy data for demo",
  });

  const login = (role: string, s: StaffDraft) => ({ role, name: s.name, phone: staffPhone.get(s)!.replace("+91", "") });
  const logins = [
    login("Admin", admin),
    login("Principal", principal),
    login("Office", officeHead),
    login("HOD, CS", csPool[0]),
    login("Class teacher, CS Sem 3 (also faculty)", csClassTeacher3),
    login("Faculty, CS", demoTeacher),
    login("Faculty, Maths (common pool)", pools.get("MATHS")![0]),
  ];

  return {
    summary: {
      departments: deptRows.length,
      classes: classes.length,
      staff: staffRows.length,
      students: studentRows.length,
      parents: parentRows.length,
      sessions: sessionCount,
      attendanceRecords: recordCount,
      leaves: leaveRows.length,
      staffLeaves: staffLeaveRows.length,
      marks: markCount,
      updateMessages,
      until,
    },
    logins,
    parentLogin: { phone: DEMO_PARENT_PHONE.replace("+91", ""), regNos: [firstActive("CS-3").regNo, firstActive("CS-1").regNo] },
  };
}

async function main() {
  const reset = process.argv.includes("--reset");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

  let until = process.env.SEED_UNTIL || todayIn();
  if (until > TERM_END) until = TERM_END;
  if (until < addDays(TERM_START, 7)) throw new Error(`SEED_UNTIL ${until} is too close to term start ${TERM_START}`);

  const pool = createPool(url);
  const db = createDb(pool);
  try {
    const existing = await db.select({ id: t.collegeSettings.id }).from(t.collegeSettings).limit(1);
    if (existing.length > 0) {
      if (!reset) throw new Error("Database already has data. Use `npm run db:reset` to wipe and reseed (local only).");
      assertLocalDatabase(url);
      await wipe(db);
    }
    const started = Date.now();
    const { summary, logins, parentLogin } = await db.transaction((tx) => seed(tx, until));
    console.log(`Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.table(summary);
    console.log(`Demo logins (password for all: value of SEED_STAFF_PASSWORD in .env):`);
    console.table(logins);
    console.log(`Parent portal (/parent): phone ${parentLogin.phone} with register number ${parentLogin.regNos.join(" or ")}. The code shows on screen in demo mode.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

