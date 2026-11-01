import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { canMarkSession, hodDepartmentIds, isAdmin, type Actor } from "@/lib/auth/permissions";
import type { Mark } from "@/lib/domain/marking";

export interface SessionContext {
  id: number;
  date: string;
  startPeriod: number;
  endPeriod: number;
  startsAt: string;
  endsAt: string;
  component: "THEORY" | "PRACTICAL";
  batchScope: "ALL" | "B1" | "B2";
  status: "SCHEDULED" | "HELD" | "NOT_HELD" | "CANCELLED";
  statusReason: string | null;
  version: number;
  markedBy: string | null;
  markedAt: string | null;
  offeringId: number;
  subject: string;
  subjectName: string;
  classRef: { id: number; departmentId: number };
  className: string;
  assignedStaffIds: number[];
  assignedNames: string | null;
}

export async function getSessionContext(sessionId: number): Promise<SessionContext | null> {
  const { rows } = await getDb().execute<{
    id: number;
    date: string;
    start_period: number;
    end_period: number;
    starts_at: string;
    ends_at: string;
    component: SessionContext["component"];
    batch_scope: SessionContext["batchScope"];
    status: SessionContext["status"];
    status_reason: string | null;
    version: number;
    marked_by: string | null;
    marked_at: string | null;
    offering_id: number;
    subject: string;
    subject_name: string;
    class_id: number;
    department_id: number;
    class_name: string;
    assigned_ids: number[] | null;
    assigned_names: string | null;
  }>(sql`
    SELECT cs.id, to_char(cs.date, 'YYYY-MM-DD') AS date, cs.start_period, cs.end_period,
           to_char(ps.starts_at, 'HH24:MI') AS starts_at, to_char(pe.ends_at, 'HH24:MI') AS ends_at,
           cs.component, cs.batch_scope, cs.status, cs.status_reason, cs.version,
           ms.name AS marked_by, to_char(cs.marked_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH24:MI') AS marked_at,
           o.id AS offering_id, c.short_name AS subject, c.name AS subject_name,
           cg.id AS class_id, cg.department_id, d.code || ' Sem ' || cg.semester AS class_name,
           (SELECT array_agg(ta.staff_id) FROM teaching_assignment ta
             WHERE ta.offering_id = cs.offering_id AND ta.component = cs.component AND ta.batch_scope IN ('ALL', cs.batch_scope)) AS assigned_ids,
           (SELECT string_agg(s.name, ', ') FROM teaching_assignment ta JOIN staff s ON s.id = ta.staff_id
             WHERE ta.offering_id = cs.offering_id AND ta.component = cs.component AND ta.batch_scope IN ('ALL', cs.batch_scope)) AS assigned_names
    FROM class_session cs
    JOIN course_offering o ON o.id = cs.offering_id
    JOIN course c ON c.id = o.course_id
    JOIN class_group cg ON cg.id = o.class_group_id
    JOIN department d ON d.id = cg.department_id
    JOIN period ps ON ps.ordinal = cs.start_period
    JOIN period pe ON pe.ordinal = cs.end_period
    LEFT JOIN staff ms ON ms.id = cs.marked_by
    WHERE cs.id = ${sessionId}`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    date: r.date,
    startPeriod: r.start_period,
    endPeriod: r.end_period,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    component: r.component,
    batchScope: r.batch_scope,
    status: r.status,
    statusReason: r.status_reason,
    version: r.version,
    markedBy: r.marked_by,
    markedAt: r.marked_at,
    offeringId: r.offering_id,
    subject: r.subject,
    subjectName: r.subject_name,
    classRef: { id: r.class_id, departmentId: r.department_id },
    className: r.class_name,
    assignedStaffIds: r.assigned_ids ?? [],
    assignedNames: r.assigned_names,
  };
}

export interface RosterRow {
  studentId: number;
  regNo: string;
  name: string;
  mark: Mark | null;
  /** Approved leave/OD covering the date, shown as a hint to the teacher. */
  leave: string | null;
}

/**
 * Students who should be in this session: members of the class on that date, in the session's batch
 * on that date (batch history respected). Plus anyone already marked who no longer qualifies,
 * so an existing mark is never silently hidden.
 */
export async function getRoster(s: SessionContext): Promise<RosterRow[]> {
  const { rows } = await getDb().execute<{ student_id: number; reg_no: string; name: string; mark: Mark | null; leave: string | null }>(sql`
    WITH members AS (
      SELECT m.student_id,
             (SELECT ba.batch FROM batch_assignment ba WHERE ba.membership_id = m.id AND ba.effective_from <= ${s.date}::date
              ORDER BY ba.effective_from DESC LIMIT 1) AS batch
      FROM class_membership m
      WHERE m.class_group_id = ${s.classRef.id} AND m.joined_on <= ${s.date}::date AND (m.left_on IS NULL OR m.left_on >= ${s.date}::date)
    ),
    expected AS (
      SELECT student_id FROM members WHERE ${s.batchScope} = 'ALL' OR batch::text = ${s.batchScope}
      UNION
      SELECT student_id FROM attendance_record WHERE session_id = ${s.id}
    )
    SELECT st.id AS student_id, st.reg_no, st.name, ar.status AS mark,
      (SELECT ln.type::text FROM leave_notice ln WHERE ln.student_id = st.id AND ln.status = 'APPROVED'
         AND ${s.date}::date BETWEEN ln.from_date AND ln.to_date LIMIT 1) AS leave
    FROM expected e
    JOIN student st ON st.id = e.student_id
    LEFT JOIN attendance_record ar ON ar.session_id = ${s.id} AND ar.student_id = st.id
    ORDER BY st.reg_no`);
  return rows.map((r) => ({ studentId: r.student_id, regNo: r.reg_no, name: r.name, mark: r.mark, leave: r.leave }));
}

export type SessionListRow = {
  id: number;
  date: string;
  start_period: number;
  starts_at: string;
  status: string;
  component: string;
  batch_scope: string;
  subject: string;
  class_name: string;
  class_id: number;
  mine: boolean;
  marked_count: number;
};

/**
 * Sessions this person can mark in a date range. `scope`:
 *  - "mine": sessions where they are the assigned teacher
 *  - "department": all sessions of departments they head (or all, for admin)
 */
export async function listSessions(a: Actor, opts: { from: string; to: string; scope: "mine" | "department"; onlyPending: boolean; classId?: number | null }): Promise<SessionListRow[]> {
  const depts = hodDepartmentIds(a);
  const deptFilter =
    opts.scope === "mine"
      ? sql`EXISTS (SELECT 1 FROM teaching_assignment ta WHERE ta.offering_id = cs.offering_id AND ta.component = cs.component
                     AND ta.batch_scope IN ('ALL', cs.batch_scope) AND ta.staff_id = ${a.staffId})`
      : isAdmin(a)
        ? sql`true`
        : depts.length
          ? sql`cg.department_id IN (${sql.join(depts.map((d) => sql`${d}`), sql`, `)})`
          : sql`false`;
  const { rows } = await getDb().execute<SessionListRow>(sql`
    SELECT cs.id, to_char(cs.date, 'YYYY-MM-DD') AS date, cs.start_period, to_char(p.starts_at, 'HH24:MI') AS starts_at,
           cs.status, cs.component, cs.batch_scope, c.short_name AS subject, d.code || ' Sem ' || cg.semester AS class_name, cg.id AS class_id,
           EXISTS (SELECT 1 FROM teaching_assignment ta WHERE ta.offering_id = cs.offering_id AND ta.component = cs.component
                    AND ta.batch_scope IN ('ALL', cs.batch_scope) AND ta.staff_id = ${a.staffId}) AS mine,
           (SELECT count(*)::int FROM attendance_record ar WHERE ar.session_id = cs.id) AS marked_count
    FROM class_session cs
    JOIN course_offering o ON o.id = cs.offering_id
    JOIN course c ON c.id = o.course_id
    JOIN class_group cg ON cg.id = o.class_group_id
    JOIN department d ON d.id = cg.department_id
    JOIN period p ON p.ordinal = cs.start_period
    WHERE cs.date BETWEEN ${opts.from}::date AND ${opts.to}::date
      AND ${deptFilter}
      ${opts.onlyPending ? sql`AND cs.status = 'SCHEDULED'` : sql``}
      ${opts.classId ? sql`AND cg.id = ${opts.classId}` : sql``}
    ORDER BY cs.date DESC, cs.start_period, d.code, cg.semester
    LIMIT 300`);
  return rows;
}

/** Classes whose sessions this person might mark (to generate sessions lazily). */
export async function markableClassIds(a: Actor): Promise<number[] | null> {
  if (isAdmin(a)) return null; // all
  const depts = hodDepartmentIds(a);
  const facultyDepts = a.grants.filter((g) => g.role === "FACULTY" && g.departmentId !== null).map((g) => g.departmentId!);
  const allDepts = [...new Set([...depts, ...facultyDepts])];
  const { rows } = await getDb().execute<{ id: number }>(sql`
    SELECT id FROM class_group WHERE ${allDepts.length ? sql`department_id IN (${sql.join(allDepts.map((d) => sql`${d}`), sql`, `)})` : sql`false`}
    UNION SELECT unnest(${a.teachingClassIds.length ? sql`ARRAY[${sql.join(a.teachingClassIds.map((c) => sql`${c}`), sql`, `)}]::int[]` : sql`ARRAY[]::int[]`})`);
  return rows.map((r) => r.id);
}

export function sessionPermission(a: Actor, s: SessionContext) {
  return canMarkSession(a, { classRef: s.classRef, assignedStaffIds: s.assignedStaffIds });
}
