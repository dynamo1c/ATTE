import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { course, courseOffering, period, timetableSlot, timetableVersion } from "@/db/schema";
import type { CourseKind } from "@/lib/domain/timetable";

export interface OfferingRow {
  id: number;
  courseId: number;
  code: string;
  shortName: string;
  name: string;
  kind: CourseKind;
  assignments: { id: number; component: "THEORY" | "PRACTICAL"; batchScope: "ALL" | "B1" | "B2"; staffId: number; staffName: string }[];
}

export async function listOfferings(classId: number): Promise<OfferingRow[]> {
  const { rows } = await getDb().execute<{
    id: number;
    course_id: number;
    code: string;
    short_name: string;
    name: string;
    kind: CourseKind;
    assignments: OfferingRow["assignments"] | null;
  }>(sql`
    SELECT o.id, c.id AS course_id, c.code, c.short_name, c.name, c.kind,
      (SELECT json_agg(json_build_object('id', ta.id, 'component', ta.component, 'batchScope', ta.batch_scope, 'staffId', s.id, 'staffName', s.name)
                       ORDER BY ta.component DESC, ta.batch_scope, s.name)
         FROM teaching_assignment ta JOIN staff s ON s.id = ta.staff_id WHERE ta.offering_id = o.id) AS assignments
    FROM course_offering o JOIN course c ON c.id = o.course_id
    WHERE o.class_group_id = ${classId}
    ORDER BY c.code`);
  return rows.map((r) => ({ id: r.id, courseId: r.course_id, code: r.code, shortName: r.short_name, name: r.name, kind: r.kind, assignments: r.assignments ?? [] }));
}

/** Active staff who can teach a class of this department: its own faculty + common staff. */
export async function teacherOptions(departmentId: number) {
  const { rows } = await getDb().execute<{ id: number; name: string; dept: string | null }>(sql`
    SELECT s.id, s.name, d.code AS dept FROM staff s LEFT JOIN department d ON d.id = s.department_id
    WHERE s.active AND (s.department_id = ${departmentId} OR s.department_id IS NULL)
      AND EXISTS (SELECT 1 FROM role_grant g WHERE g.staff_id = s.id AND g.role IN ('FACULTY', 'HOD'))
    ORDER BY (s.department_id IS NULL), s.name`);
  return rows;
}

/** Courses of the class's department + semester not yet offered to it. */
export async function coursesNotOffered(classId: number, departmentId: number, semester: number) {
  return getDb()
    .select({ id: course.id, code: course.code, shortName: course.shortName, name: course.name })
    .from(course)
    .where(
      sql`${course.departmentId} = ${departmentId} AND ${course.semester} = ${semester} AND ${course.active}
          AND NOT EXISTS (SELECT 1 FROM ${courseOffering} o WHERE o.course_id = ${course.id} AND o.class_group_id = ${classId})`,
    )
    .orderBy(asc(course.code));
}

export interface VersionRow {
  id: number;
  effectiveFrom: string;
  note: string | null;
  approvedBy: string | null;
  sessions: number;
}

export async function listVersions(classId: number): Promise<VersionRow[]> {
  const { rows } = await getDb().execute<{ id: number; effective_from: string; note: string | null; approved_by: string | null; sessions: number }>(sql`
    SELECT v.id, to_char(v.effective_from, 'YYYY-MM-DD') AS effective_from, v.note, s.name AS approved_by,
      (SELECT count(*)::int FROM class_session cs JOIN timetable_slot ts ON ts.id = cs.slot_id WHERE ts.version_id = v.id) AS sessions
    FROM ${timetableVersion} v LEFT JOIN staff s ON s.id = v.approved_by
    WHERE v.class_group_id = ${classId}
    ORDER BY v.effective_from`);
  return rows.map((r) => ({ id: r.id, effectiveFrom: r.effective_from, note: r.note, approvedBy: r.approved_by, sessions: r.sessions }));
}

export interface SlotRow {
  id: number;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  kind: "CLASS" | "ACTIVITY";
  offeringId: number | null;
  component: "THEORY" | "PRACTICAL" | null;
  batchScope: "ALL" | "B1" | "B2";
  room: string | null;
  subject: string | null;
  teachers: string | null;
}

export async function listSlots(versionId: number): Promise<SlotRow[]> {
  const { rows } = await getDb().execute<{
    id: number;
    weekday: number;
    start_period: number;
    end_period: number;
    kind: "CLASS" | "ACTIVITY";
    offering_id: number | null;
    component: "THEORY" | "PRACTICAL" | null;
    batch_scope: "ALL" | "B1" | "B2";
    room: string | null;
    subject: string | null;
    teachers: string | null;
  }>(sql`
    SELECT ts.id, ts.weekday, ts.start_period, ts.end_period, ts.kind, ts.offering_id, ts.component, ts.batch_scope, ts.room,
           c.short_name AS subject,
           (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM teaching_assignment ta JOIN staff s ON s.id = ta.staff_id
             WHERE ta.offering_id = ts.offering_id AND ta.component = ts.component AND ta.batch_scope IN ('ALL', ts.batch_scope)) AS teachers
    FROM ${timetableSlot} ts
    LEFT JOIN course_offering o ON o.id = ts.offering_id
    LEFT JOIN course c ON c.id = o.course_id
    WHERE ts.version_id = ${versionId}
    ORDER BY ts.weekday, ts.start_period, ts.batch_scope`);
  return rows.map((r) => ({
    id: r.id,
    weekday: r.weekday,
    startPeriod: r.start_period,
    endPeriod: r.end_period,
    kind: r.kind,
    offeringId: r.offering_id,
    component: r.component,
    batchScope: r.batch_scope,
    room: r.room,
    subject: r.subject,
    teachers: r.teachers,
  }));
}

export async function listPeriods() {
  return getDb().select().from(period).orderBy(asc(period.ordinal));
}

export async function getOffering(id: number) {
  const [row] = await getDb()
    .select({ id: courseOffering.id, classGroupId: courseOffering.classGroupId, kind: course.kind, shortName: course.shortName })
    .from(courseOffering)
    .innerJoin(course, eq(course.id, courseOffering.courseId))
    .where(eq(courseOffering.id, id));
  return row ?? null;
}

export const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
