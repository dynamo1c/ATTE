import "server-only";
/**
 * Report queries shared by the report screens and their Excel downloads, so a download always
 * matches what the screen shows (same filters, same permission scope).
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { classTeacherClassIds, visibleDepartmentIds, type Actor } from "@/lib/auth/permissions";
import { classesToReach, percent, type Standing } from "@/lib/domain/attendance";
import { todayIn } from "@/lib/domain/dates";
import { TRIGGER_LABEL, type Trigger } from "@/lib/notify/rules";
import { getClassAttendance, isCurrent } from "./attendance-report";
import { generateSessions } from "./generate-sessions";
import { mapLimit, type ClassRow } from "./queries";

type Params = Record<string, string | string[] | undefined>;

// ---------------------------------------------------------------------------
// Attendance shortage
// ---------------------------------------------------------------------------

export function shortageFilters(visible: readonly ClassRow[], sp: Params) {
  const depts = [...new Map(visible.map((c) => [c.departmentId, c.departmentCode])).entries()];
  const deptId = typeof sp.dept === "string" && depts.some(([id]) => String(id) === sp.dept) ? Number(sp.dept) : null;
  const sems = [...new Set(visible.map((c) => c.semester))].sort();
  const sem = typeof sp.sem === "string" && sems.some((s) => String(s) === sp.sem) ? Number(sp.sem) : null;
  const level: "risk" | "shortage" = sp.level === "risk" ? "risk" : "shortage";
  return { depts, sems, deptId, sem, level };
}

export async function loadShortage(visible: readonly ClassRow[], f: { deptId: number | null; sem: number | null; level: "risk" | "shortage" }) {
  const classes = visible.filter((c) => (f.deptId === null || c.departmentId === f.deptId) && (f.sem === null || c.semester === f.sem));
  // Four classes at a time: a whole-college report must not starve the pool for teachers marking attendance.
  const results = await mapLimit(classes, 4, (c) => getClassAttendance(c.id));
  const minPct = results[0]?.minPct ?? 60;
  const warnPct = results[0]?.warnPct ?? 70;
  const matches = (st: Standing | undefined) => st === "SHORTAGE" || (f.level === "risk" && st === "AT_RISK");

  const rows = results.flatMap((data, i) => {
    const cls = classes[i];
    const subjects = new Map(data.subjects.map((s) => [s.offeringId, s]));
    return data.students
      .filter((s) => isCurrent(s) && matches(s.standing))
      .map((s) => {
        const weak = s.attendance.byOffering
          .filter((o) => matches(s.subjectStanding.get(o.offeringId)))
          .map((o) => ({ o, subject: subjects.get(o.offeringId)!, standing: s.subjectStanding.get(o.offeringId)! }))
          .sort((a, b) => (percent(a.o.total) ?? 0) - (percent(b.o.total) ?? 0));
        const worstPct = Math.min(...weak.map((w) => percent(w.o.total) ?? 100));
        const need = Math.max(0, ...weak.filter((w) => w.standing === "SHORTAGE").map((w) => classesToReach(w.o.total, minPct) ?? 0));
        return { cls, s, weak, worstPct, need };
      });
  });
  rows.sort((a, b) => a.cls.departmentCode.localeCompare(b.cls.departmentCode) || a.cls.semester - b.cls.semester || a.worstPct - b.worstPct);
  return {
    classes,
    rows,
    minPct,
    warnPct,
    to: results[0]?.to ?? null,
    shortCount: rows.filter((r) => r.s.standing === "SHORTAGE").length,
    studentsCovered: results.reduce((n, d) => n + d.students.filter(isCurrent).length, 0),
    unmarked: results.reduce((n, d) => n + d.unmarkedSessions, 0),
  };
}

// ---------------------------------------------------------------------------
// Classes not yet entered
// ---------------------------------------------------------------------------

export const UNENTERED_LIMIT = 3000;

export type UnenteredRow = {
  session_id: number;
  date: string;
  starts_at: string;
  subject: string;
  component: string;
  batch_scope: string;
  class_name: string;
  staff_id: number | null;
  staff_name: string | null;
  staff_dept: string | null;
};

export async function loadUnentered(actor: Actor, classes: readonly ClassRow[]) {
  const today = todayIn();
  // Counts are only complete if every class up to today exists (the nightly job may not have run).
  await generateSessions(getDb(), { classIds: visibleDepartmentIds(actor) === null ? undefined : classes.map((c) => c.id), until: today });
  const { rows } = await getDb().execute<UnenteredRow>(sql`
    SELECT cs.id AS session_id, to_char(cs.date, 'YYYY-MM-DD') AS date, to_char(p.starts_at, 'HH24:MI') AS starts_at,
           c.short_name AS subject, cs.component::text, cs.batch_scope::text, d.code || ' Sem ' || cg.semester AS class_name,
           st.id AS staff_id, st.name AS staff_name, sd.code AS staff_dept
    FROM class_session cs
    JOIN course_offering o ON o.id = cs.offering_id
    JOIN course c ON c.id = o.course_id
    JOIN class_group cg ON cg.id = o.class_group_id
    JOIN department d ON d.id = cg.department_id
    JOIN period p ON p.ordinal = cs.start_period
    LEFT JOIN teaching_assignment ta ON ta.offering_id = cs.offering_id AND ta.component = cs.component AND ta.batch_scope IN ('ALL', cs.batch_scope)
    LEFT JOIN staff st ON st.id = ta.staff_id
    LEFT JOIN department sd ON sd.id = st.department_id
    WHERE cs.status = 'SCHEDULED' AND cs.date <= ${today}::date
      AND cg.id IN (${sql.join(classes.map((c) => sql`${c.id}`), sql`, `)})
    ORDER BY cs.date, cs.start_period
    LIMIT ${UNENTERED_LIMIT}`);
  return { rows, today };
}

// ---------------------------------------------------------------------------
// Parent messages
// ---------------------------------------------------------------------------

export const MESSAGE_STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"] as const;

export function messageFilters(sp: Params) {
  const status = typeof sp.status === "string" && (MESSAGE_STATUSES as readonly string[]).includes(sp.status) ? sp.status : null;
  const trigger = typeof sp.trigger === "string" && sp.trigger in TRIGGER_LABEL ? (sp.trigger as Trigger) : null;
  const q = typeof sp.q === "string" ? sp.q.trim().toUpperCase().slice(0, 20) : "";
  return { status, trigger, q };
}

/** Students of the classes this person may see (whole college / HOD's departments / own class), as a WHERE on `n`. */
export function messageScope(actor: Actor, termId: number): SQL {
  const depts = visibleDepartmentIds(actor);
  const ownClasses = classTeacherClassIds(actor);
  if (depts === null) return sql`true`;
  return sql`EXISTS (SELECT 1 FROM class_membership m JOIN class_group cg ON cg.id = m.class_group_id
                    WHERE m.student_id = n.student_id AND m.term_id = ${termId}
                      AND (${depts.length ? sql`cg.department_id IN (${sql.join(depts.map((d) => sql`${d}`), sql`, `)})` : sql`false`}
                           OR ${ownClasses.length ? sql`cg.id IN (${sql.join(ownClasses.map((c) => sql`${c}`), sql`, `)})` : sql`false`}))`;
}

/** Scope + the screen's filters (status, kind, search by reg no / name / phone). Uses aliases n (notification) and s (student). */
export function messageWhere(actor: Actor, termId: number, f: ReturnType<typeof messageFilters>): SQL {
  return sql`${messageScope(actor, termId)}
    ${f.status ? sql`AND n.status = ${f.status}` : sql``}
    ${f.trigger ? sql`AND n.trigger = ${f.trigger}` : sql``}
    ${f.q ? sql`AND (s.reg_no = ${f.q} OR s.name ILIKE ${`%${f.q}%`} OR n.phone LIKE ${`%${f.q.replace(/\D/g, "") || "x"}`})` : sql``}`;
}
