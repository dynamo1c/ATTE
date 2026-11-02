/**
 * Timetable import: one row per period block (day, periods, subject, part, batch, teachers), for any
 * number of classes. Each class in the file gets a complete new timetable from the chosen start date;
 * classes not in the file are not touched. The same rules as the timetable screen apply: no clashes for
 * the same students, no teacher in two classes at once, and recorded classes keep their timetable.
 */
import type { ReadRow } from "@/lib/sheet-read";
import { addDays, type IsoDate } from "@/lib/domain/dates";
import { allowedComponents, findSlotConflicts, type BatchScope, type Component, type CourseKind, type SlotDef } from "@/lib/domain/timetable";
import { choice, emptyPlan, mobile, readColumns, RowReader, textCell, wholeNumber, type Column, type Plan } from "./columns";

export const TIMETABLE_COLUMNS = [
  { key: "department", label: "Department", aliases: ["Dept"], required: true, help: "Department code: CE, CS, EE, EC, EI, ME, CG.", example: "CS" },
  { key: "semester", label: "Semester", aliases: ["Sem"], required: true, help: "1 to 6.", example: "3" },
  { key: "day", label: "Day", aliases: ["Weekday"], required: true, help: "Mon, Tue, Wed, Thu, Fri, Sat.", example: "Mon" },
  { key: "from", label: "From period", aliases: ["Period", "Start period", "From"], required: true, help: "Period number the block starts in (1 = first period).", example: "1" },
  { key: "to", label: "To period", aliases: ["End period", "To"], help: "Last period of the block. Blank = same as From (one period).", example: "2" },
  { key: "subject", label: "Subject", aliases: ["Subject short name", "Short name", "Subject code"], required: true, help: "Short name or code as on the Subjects screen, or Activity for a non-class period.", example: "DSP" },
  { key: "part", label: "Part", aliases: ["Theory/Lab", "Component", "Type"], help: "Theory or Lab. Blank is fine for theory-only or lab-only subjects.", example: "Lab" },
  { key: "batch", label: "Batch", help: "All, B1 or B2. Blank = All (whole class).", example: "B1" },
  { key: "room", label: "Room", aliases: ["Lab", "Room / lab"], help: "Optional.", example: "CS Lab 2" },
  { key: "teachers", label: "Teacher mobile", aliases: ["Teacher", "Teachers", "Teacher mobiles", "Faculty mobile"], help: "Mobile of the teacher (several separated by commas). Blank = keep the teachers already assigned.", example: "98450 12345" },
] as const satisfies readonly Column[];

type Key = (typeof TIMETABLE_COLUMNS)[number]["key"];

const DAYS: Record<string, number> = { Mon: 1, Monday: 1, Tue: 2, Tues: 2, Tuesday: 2, Wed: 3, Wednesday: 3, Thu: 4, Thur: 4, Thurs: 4, Thursday: 4, Fri: 5, Friday: 5, Sat: 6, Saturday: 6, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
export const DAY_NAME = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PARTS: Record<string, Component> = { Theory: "THEORY", T: "THEORY", Lecture: "THEORY", Lab: "PRACTICAL", Practical: "PRACTICAL", P: "PRACTICAL", L: "PRACTICAL" };
const BATCHES: Record<string, BatchScope> = { All: "ALL", Both: "ALL", Whole: "ALL", "Whole class": "ALL", B1: "B1", B2: "B2", "Batch 1": "B1", "Batch 2": "B2", 1: "B1", 2: "B2" };
const ACTIVITY = /^(activity|activities|activity period)$/i;

export interface TimetableContext {
  effectiveFrom: IsoDate;
  today: IsoDate;
  term: { startsOn: IsoDate; endsOn: IsoDate };
  periods: readonly number[];
  departments: readonly { id: number; code: string }[];
  classes: readonly {
    id: number;
    departmentId: number;
    departmentCode: string;
    semester: number;
    versions: readonly { id: number; effectiveFrom: IsoDate; sessions: number }[];
    /** Classes (sessions) of this class on or after effectiveFrom. */
    sessionsFrom: number;
    /** Any classes at all. */
    sessionsEver: number;
    offerings: readonly { offeringId: number; courseId: number }[];
  }[];
  courses: readonly { id: number; departmentId: number; semester: number; code: string; shortName: string; kind: CourseKind }[];
  staff: readonly { id: number; name: string; phone: string; active: boolean }[];
  assignments: readonly { offeringId: number; component: Component; batchScope: BatchScope; staffId: number }[];
  /** Teachers' periods in other classes' timetables in force on effectiveFrom. */
  busy: readonly { classId: number; label: string; weekday: number; startPeriod: number; endPeriod: number; staffId: number; subject: string }[];
}

export interface SlotSpec {
  line: number;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  kind: "CLASS" | "ACTIVITY";
  courseId: number | null;
  component: Component | null;
  batchScope: BatchScope;
  room: string | null;
}

export interface TimetableOp {
  classId: number;
  label: string;
  /** Replace the slots of a version nobody has used yet, or add a new version. */
  replaceVersionId: number | null;
  effectiveFrom: IsoDate;
  /** Subjects to give the class first (they are in the timetable but not yet offered). */
  offerCourseIds: number[];
  slots: SlotSpec[];
  assign: { courseId: number; component: Component; batchScope: BatchScope; staffId: number }[];
}

export function planTimetable(file: readonly ReadRow[], ctx: TimetableContext): Plan<TimetableOp> {
  const plan = emptyPlan<TimetableOp>();
  const { rows, errors, warnings } = readColumns<Key>(file, TIMETABLE_COLUMNS);
  plan.errors.push(...errors);
  plan.warnings.push(...warnings);
  if (errors.length) return plan;
  const D = ctx.effectiveFrom;
  if (D < ctx.term.startsOn || D > ctx.term.endsOn) {
    plan.errors.push({ line: null, message: `Start date ${D} is outside this term (${ctx.term.startsOn} to ${ctx.term.endsOn}).` });
    return plan;
  }

  const deptByCode = new Map(ctx.departments.map((d) => [d.code, d.id]));
  const staffByPhone = new Map(ctx.staff.map((s) => [s.phone, s]));
  const periods = new Set(ctx.periods);
  const maxPeriod = Math.max(...ctx.periods);
  const byClass = new Map<number, { cls: TimetableContext["classes"][number]; slots: SlotSpec[]; teachers: Map<number, number[]> }>();

  for (const row of rows) {
    const r = new RowReader();
    const deptRaw = row.get("department").toUpperCase();
    const deptId = deptByCode.get(deptRaw);
    if (!deptId) r.errors.push(deptRaw ? `Department “${row.get("department")}” is not one of ${[...deptByCode.keys()].join(", ")}.` : "Department is empty.");
    const semester = r.take(wholeNumber(row.get("semester"), "Semester", 1, 6));
    const weekday = row.get("day") ? r.take(choice(row.get("day"), "Day", DAYS)) : (r.errors.push("Day is empty."), undefined);
    const from = r.take(wholeNumber(row.get("from"), "From period", 1, maxPeriod));
    const to = row.get("to") ? r.take(wholeNumber(row.get("to"), "To period", 1, maxPeriod)) : from;
    if (from && to && (!periods.has(from) || !periods.has(to))) r.errors.push(`Period ${!periods.has(from) ? from : to} does not exist (periods: ${ctx.periods.join(", ")}).`);
    if (from && to && to < from) r.errors.push(`To period ${to} is before From period ${from}.`);
    const room = r.take(textCell(row.get("room"), "Room", 40, false));
    const batchScope = row.get("batch") ? r.take(choice(row.get("batch"), "Batch", BATCHES)) : "ALL";
    const cls = deptId && semester ? ctx.classes.find((c) => c.departmentId === deptId && c.semester === semester) : undefined;
    if (deptId && semester && !cls) r.errors.push(`There is no ${deptRaw} Sem ${semester} class this term.`);

    const subjectRaw = row.get("subject");
    const isActivity = ACTIVITY.test(subjectRaw) || /^activity$/i.test(row.get("part"));
    let course: TimetableContext["courses"][number] | undefined;
    let component: Component | null = null;
    if (!subjectRaw && !isActivity) r.errors.push("Subject is empty.");
    else if (!isActivity && cls) {
      const want = subjectRaw.toUpperCase().replace(/\s+/g, " ");
      const mine = ctx.courses.filter((c) => c.departmentId === cls.departmentId && c.semester === cls.semester);
      course = mine.find((c) => c.code === want.replace(/\s+/g, "")) ?? mine.find((c) => c.shortName.toUpperCase().replace(/\s+/g, " ") === want);
      if (!course) r.errors.push(`Subject “${subjectRaw}” is not a ${deptRaw} Sem ${semester} subject. Subjects: ${mine.map((c) => c.shortName).join(", ") || "none yet (import subjects first)"}.`);
      else {
        const allowed = allowedComponents(course.kind);
        if (row.get("part")) {
          const part = r.take(choice(row.get("part"), "Part", PARTS));
          if (part && !allowed.includes(part)) r.errors.push(`${course.shortName} has no ${part === "PRACTICAL" ? "lab" : "theory"} part.`);
          else if (part) component = part;
        } else if (allowed.length === 1) component = allowed[0];
        else r.errors.push(`Part is empty: is this ${course.shortName} period Theory or Lab?`);
      }
    }

    const teacherIds: number[] = [];
    for (const t of row.get("teachers").split(/[,;/&]/).map((s) => s.trim()).filter(Boolean)) {
      if (isActivity) {
        r.errors.push("Activity periods have no teacher; leave Teacher mobile blank.");
        break;
      }
      const phone = r.take(mobile(t, "Teacher mobile"));
      if (!phone) continue;
      const s = staffByPhone.get(phone);
      if (!s) r.errors.push(`No staff member has mobile ${t}. Import staff first.`);
      else if (!s.active) r.errors.push(`${s.name}'s account is deactivated.`);
      else if (!teacherIds.includes(s.id)) teacherIds.push(s.id);
    }

    if (r.errors.length || !cls || !weekday || !from || !to || !batchScope || (!isActivity && !component) || room === undefined) {
      plan.errors.push(...r.errors.map((message) => ({ line: row.line, message })));
      continue;
    }
    const entry = byClass.get(cls.id) ?? { cls, slots: [] as SlotSpec[], teachers: new Map<number, number[]>() };
    byClass.set(cls.id, entry);
    entry.slots.push(
      isActivity
        ? { line: row.line, weekday, startPeriod: from, endPeriod: to, kind: "ACTIVITY", courseId: null, component: null, batchScope: "ALL", room }
        : { line: row.line, weekday, startPeriod: from, endPeriod: to, kind: "CLASS", courseId: course!.id, component, batchScope, room },
    );
    if (teacherIds.length) entry.teachers.set(row.line, teacherIds);
  }

  // --- Per class: start date rules, clashes, teachers ------------------------
  const courseById = new Map(ctx.courses.map((c) => [c.id, c]));
  const staffName = new Map(ctx.staff.map((s) => [s.id, s.name]));
  const offeringCourse = new Map(ctx.classes.flatMap((c) => c.offerings.map((o) => [o.offeringId, o.courseId] as const)));
  /** Teacher periods from the file, checked against each other and against other classes. */
  const occupied: { classId: number; label: string; line: number; weekday: number; startPeriod: number; endPeriod: number; staffId: number; subject: string }[] = [];
  const ops: TimetableOp[] = [];

  for (const { cls, slots, teachers } of byClass.values()) {
    const label = `${cls.departmentCode} Sem ${cls.semester}`;
    const firstLine = Math.min(...slots.map((s) => s.line));
    const fail = (message: string) => plan.errors.push({ line: firstLine, message: `${label}: ${message}` });
    const same = cls.versions.find((v) => v.effectiveFrom === D);
    let replaceVersionId: number | null = null;
    if (same) {
      if (same.sessions > 0) {
        fail(`its timetable from ${D} already has ${same.sessions} classes recorded. Choose a later start date.`);
        continue;
      }
      replaceVersionId = same.id;
    } else if (cls.sessionsFrom > 0) {
      fail(`classes are already recorded on or after ${D}. Choose a later start date.`);
      continue;
    } else if (cls.sessionsEver > 0 && D < addDays(ctx.today, 1)) {
      fail(`attendance has started, so the new timetable must start tomorrow (${addDays(ctx.today, 1)}) or later.`);
      continue;
    }

    const defs: SlotDef[] = slots.map((s) => ({ id: s.line, weekday: s.weekday, startPeriod: s.startPeriod, endPeriod: s.endPeriod, kind: s.kind, offeringId: s.courseId, component: s.component, batchScope: s.batchScope }));
    const clashes = findSlotConflicts(defs);
    for (const c of clashes) {
      const who = c.a.batchScope === "ALL" || c.b.batchScope === "ALL" ? "the whole class" : c.a.batchScope;
      plan.errors.push({ line: Math.max(c.a.id, c.b.id), message: `${label}: clashes with row ${Math.min(c.a.id, c.b.id)} (${DAY_NAME[c.a.weekday]}, same period, ${who}).` });
    }
    if (clashes.length) continue;

    const offered = new Set(cls.offerings.map((o) => o.courseId));
    const offerCourseIds = [...new Set(slots.filter((s) => s.courseId && !offered.has(s.courseId)).map((s) => s.courseId!))];
    const existingFor = (courseId: number, component: Component) =>
      ctx.assignments.filter((a) => offeringCourse.get(a.offeringId) === courseId && cls.offerings.some((o) => o.offeringId === a.offeringId) && a.component === component);
    const assign: TimetableOp["assign"] = [];
    const noTeacher = new Set<string>();
    for (const s of slots) {
      if (s.kind !== "CLASS") continue;
      const listed = teachers.get(s.line) ?? [];
      for (const staffId of listed) {
        const covered = existingFor(s.courseId!, s.component!).some((a) => a.staffId === staffId && (a.batchScope === "ALL" || a.batchScope === s.batchScope));
        if (!covered && !assign.some((a) => a.courseId === s.courseId && a.component === s.component && a.staffId === staffId && a.batchScope === s.batchScope)) {
          assign.push({ courseId: s.courseId!, component: s.component!, batchScope: s.batchScope, staffId });
        }
      }
      // Who teaches this period, the way attendance resolves it: scope ALL, or the same batch.
      const all = [
        ...existingFor(s.courseId!, s.component!).filter((a) => a.batchScope === "ALL" || a.batchScope === s.batchScope).map((a) => a.staffId),
        ...assign.filter((a) => a.courseId === s.courseId && a.component === s.component && (a.batchScope === "ALL" || a.batchScope === s.batchScope)).map((a) => a.staffId),
      ];
      const subject = courseById.get(s.courseId!)!.shortName;
      if (!all.length) noTeacher.add(`${subject} ${s.component === "PRACTICAL" ? "lab" : "theory"}${s.batchScope === "ALL" ? "" : ` ${s.batchScope}`}`);
      for (const staffId of new Set(all)) occupied.push({ classId: cls.id, label, line: s.line, weekday: s.weekday, startPeriod: s.startPeriod, endPeriod: s.endPeriod, staffId, subject });
    }
    for (const n of noTeacher) plan.warnings.push({ line: firstLine, message: `${label}: no teacher for ${n}. Add one (Teacher mobile column or the class page) so it shows on their attendance list.` });

    const unused = cls.offerings.filter((o) => !slots.some((s) => s.courseId === o.courseId)).map((o) => courseById.get(o.courseId)?.shortName).filter(Boolean);
    if (unused.length) plan.warnings.push({ line: firstLine, message: `${label}: ${unused.join(", ")} ${unused.length > 1 ? "have" : "has"} no periods in this timetable.` });

    ops.push({ classId: cls.id, label, replaceVersionId, effectiveFrom: D, offerCourseIds, slots, assign });
    const changes = [
      `${slots.length} period blocks from ${D}${replaceVersionId ? " (replaces the unused timetable from that date)" : cls.versions.length ? " (earlier timetable stays for earlier dates)" : ""}`,
      ...offerCourseIds.map((id) => `+ subject ${courseById.get(id)!.shortName}`),
      ...assign.map((a) => `+ ${staffName.get(a.staffId)} for ${courseById.get(a.courseId)!.shortName} ${a.component === "PRACTICAL" ? "lab" : "theory"}${a.batchScope === "ALL" ? "" : ` ${a.batchScope}`}`),
    ];
    plan.items.push({ line: firstLine, action: replaceVersionId ? "update" : "create", label, changes });
  }

  // --- No teacher in two places at once -------------------------------------
  const inFile = new Set(ops.map((o) => o.classId));
  const others = ctx.busy.filter((b) => !inFile.has(b.classId)).map((b) => ({ ...b, line: 0 }));
  const all = [...occupied, ...others];
  const reported = new Set<string>();
  for (const a of occupied) {
    for (const b of all) {
      if (b === a || b.classId === a.classId || b.staffId !== a.staffId || b.weekday !== a.weekday) continue;
      if (!(a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod)) continue;
      if (b.line > a.line) continue; // report each pair once, on the later row
      const key = `${a.line}|${a.staffId}`;
      if (reported.has(key)) continue;
      reported.add(key);
      plan.errors.push({ line: a.line, message: `${staffName.get(a.staffId)} would teach ${a.subject} to ${a.label} and ${b.subject} to ${b.label}${b.line ? ` (row ${b.line})` : ""} at the same time (${DAY_NAME[a.weekday]}).` });
    }
  }
  plan.ops = ops;
  return plan;
}
