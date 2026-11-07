import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { canDecideStaffLeave, hodDepartmentIds, isAdmin, overseesCollege, type Actor } from "@/lib/auth/permissions";
import type { IsoDate } from "@/lib/domain/dates";

const idList = (ids: readonly number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

export interface Attention {
  label: string;
  count: number;
  href: string;
}

/**
 * Things waiting for this person, for the dashboard. Each count uses the same rule as the screen it
 * links to (who may decide / publish), so the number matches what they'll find there.
 */
export async function attentionFor(a: Actor, termId: number | null): Promise<Attention[]> {
  const db = getDb();
  const out: Attention[] = [];
  const admin = isAdmin(a);
  const depts = hodDepartmentIds(a);
  const deptScope = admin ? sql`true` : depts.length ? sql`cg.department_id IN (${idList(depts)})` : sql`false`;

  // Staff leave: check the decide rule per applicant (HOD → principal routing).
  const { rows: leaves } = await db.execute<{ staffId: number; departmentId: number | null; isHod: boolean }>(sql`
    SELECT l.staff_id AS "staffId", s.department_id AS "departmentId",
           EXISTS (SELECT 1 FROM role_grant g WHERE g.staff_id = s.id AND g.role = 'HOD') AS "isHod"
    FROM staff_leave l JOIN staff s ON s.id = l.staff_id
    WHERE l.status = 'PENDING' AND l.staff_id <> ${a.staffId}`);
  const staffLeave = leaves.filter((l) => canDecideStaffLeave(a, l)).length;
  if (staffLeave) out.push({ label: "Staff leave waiting for your decision", count: staffLeave, href: "/staff-leave" });

  if (termId !== null && (admin || depts.length)) {
    const {
      rows: [c],
    } = await db.execute<{ student_leave: number; edit_requests: number; marks: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM leave_notice ln
           JOIN class_membership m ON m.student_id = ln.student_id AND m.term_id = ${termId}
           JOIN class_group cg ON cg.id = m.class_group_id
           WHERE ln.status = 'PENDING' AND ${deptScope}) AS student_leave,
        (SELECT count(*)::int FROM attendance_edit_request r
           JOIN class_session cs ON cs.id = r.session_id
           JOIN course_offering o ON o.id = cs.offering_id
           JOIN class_group cg ON cg.id = o.class_group_id
           WHERE r.status = 'PENDING' AND ${deptScope}) AS edit_requests,
        (SELECT count(*)::int FROM assessment a
           JOIN course_offering o ON o.id = a.offering_id
           JOIN class_group cg ON cg.id = o.class_group_id
           WHERE a.status = 'SUBMITTED' AND cg.term_id = ${termId} AND ${deptScope}) AS marks`);
    if (c.student_leave) out.push({ label: "Student leave / OD to approve", count: c.student_leave, href: "/leaves" });
    if (c.edit_requests) out.push({ label: "Attendance change requests", count: c.edit_requests, href: "/attendance/requests" });
    if (c.marks) out.push({ label: "Marks submitted, waiting to be published", count: c.marks, href: "/marks" });
  }

  if (admin) {
    const {
      rows: [m],
    } = await db.execute<{ failed: number }>(sql`SELECT count(*)::int AS failed FROM notification WHERE status = 'FAILED' AND created_at > now() - interval '7 days'`);
    if (m.failed) out.push({ label: "Parent messages failed (last 7 days)", count: m.failed, href: "/messages?status=FAILED" });
  }

  const {
    rows: [mine],
  } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM staff_leave WHERE staff_id = ${a.staffId} AND status = 'PENDING'`);
  if (mine.n) out.push({ label: "Your leave applications still waiting", count: mine.n, href: "/staff-leave" });
  return out;
}

export type DepartmentSummary = {
  id: number;
  code: string;
  name: string;
  hodName: string | null;
  hodPhone: string | null;
  classes: number;
  students: number;
  /** Present + late of marked attendance this term, as a %; null before any class is marked. */
  attendancePct: number | null;
  /** Students whose overall attendance this term is below the college minimum. */
  belowMin: number;
  notEntered: number;
  marksWaiting: number;
  staffOnLeaveToday: number;
  staffLeavePending: number;
};

/** One row per department for the principal / admin / office overview (whole college). One pass per measure. */
export async function departmentOverview(termId: number, today: IsoDate, minPct: number): Promise<DepartmentSummary[]> {
  const { rows } = await getDb().execute<DepartmentSummary>(sql`
    WITH cls AS MATERIALIZED (SELECT id, department_id FROM class_group WHERE term_id = ${termId}),
    per_student AS MATERIALIZED (
      SELECT cls.department_id, ar.student_id,
             count(*) FILTER (WHERE ar.status IN ('PRESENT', 'LATE')) AS present, count(*) AS total
      FROM attendance_record ar
      JOIN class_session cs ON cs.id = ar.session_id AND cs.status = 'HELD'
      JOIN course_offering o ON o.id = cs.offering_id
      JOIN cls ON cls.id = o.class_group_id
      GROUP BY cls.department_id, ar.student_id
    ),
    att AS (
      SELECT department_id, round(100.0 * sum(present) / NULLIF(sum(total), 0), 1)::float AS pct,
             count(*) FILTER (WHERE total > 0 AND 100.0 * present / total < ${minPct})::int AS below
      FROM per_student GROUP BY department_id
    ),
    students AS (
      SELECT cls.department_id, count(*)::int AS n FROM class_membership m JOIN cls ON cls.id = m.class_group_id JOIN student s ON s.id = m.student_id
      WHERE m.left_on IS NULL AND s.status = 'ACTIVE' GROUP BY cls.department_id
    ),
    pending AS (
      SELECT cls.department_id, count(*)::int AS n FROM class_session cs JOIN course_offering o ON o.id = cs.offering_id JOIN cls ON cls.id = o.class_group_id
      WHERE cs.status = 'SCHEDULED' AND cs.date <= ${today} GROUP BY cls.department_id
    ),
    marks AS (
      SELECT cls.department_id, count(*)::int AS n FROM assessment a JOIN course_offering o ON o.id = a.offering_id JOIN cls ON cls.id = o.class_group_id
      WHERE a.status = 'SUBMITTED' GROUP BY cls.department_id
    ),
    leave AS (
      SELECT s.department_id,
             count(DISTINCT l.staff_id) FILTER (WHERE l.status = 'APPROVED' AND ${today} BETWEEN l.from_date AND l.to_date)::int AS today,
             count(*) FILTER (WHERE l.status = 'PENDING')::int AS waiting
      FROM staff_leave l JOIN staff s ON s.id = l.staff_id
      WHERE l.status = 'PENDING' OR (l.status = 'APPROVED' AND l.to_date >= ${today})
      GROUP BY s.department_id
    ),
    hod AS (
      SELECT DISTINCT ON (g.department_id) g.department_id, s.name, s.phone
      FROM role_grant g JOIN staff s ON s.id = g.staff_id
      WHERE g.role = 'HOD' AND s.active ORDER BY g.department_id, g.id
    )
    SELECT d.id, d.code, d.name, hod.name AS "hodName", hod.phone AS "hodPhone",
           (SELECT count(*)::int FROM cls WHERE cls.department_id = d.id) AS classes,
           COALESCE(students.n, 0) AS students, att.pct AS "attendancePct", COALESCE(att.below, 0) AS "belowMin",
           COALESCE(pending.n, 0) AS "notEntered", COALESCE(marks.n, 0) AS "marksWaiting",
           COALESCE(leave.today, 0) AS "staffOnLeaveToday", COALESCE(leave.waiting, 0) AS "staffLeavePending"
    FROM department d
    LEFT JOIN hod ON hod.department_id = d.id
    LEFT JOIN att ON att.department_id = d.id
    LEFT JOIN students ON students.department_id = d.id
    LEFT JOIN pending ON pending.department_id = d.id
    LEFT JOIN marks ON marks.department_id = d.id
    LEFT JOIN leave ON leave.department_id = d.id
    WHERE d.active
    ORDER BY d.code`);
  return rows;
}

/** Staff on approved leave today (whole college, or the HOD's departments). */
export async function staffOnLeaveToday(a: Actor, today: IsoDate) {
  const depts = hodDepartmentIds(a);
  if (!overseesCollege(a) && !depts.length) return [];
  const scope = overseesCollege(a) ? sql`true` : sql`s.department_id IN (${idList(depts)})`;
  const { rows } = await getDb().execute<{ name: string; dept: string | null; part: "FULL" | "FN" | "AN"; to_date: string; type: string }>(sql`
    SELECT s.name, d.code AS dept, l.part, to_char(l.to_date, 'YYYY-MM-DD') AS to_date, l.type
    FROM staff_leave l JOIN staff s ON s.id = l.staff_id LEFT JOIN department d ON d.id = s.department_id
    WHERE l.status = 'APPROVED' AND ${today} BETWEEN l.from_date AND l.to_date AND ${scope}
    ORDER BY d.code NULLS FIRST, s.name`);
  return rows;
}
