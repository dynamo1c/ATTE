import "server-only";
import { sql } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import {
  computeStudentAttendance,
  tallyStanding,
  worstStanding,
  type LeaveFact,
  type LeavePolicy,
  type MarkStatus,
  type MembershipFact,
  type SessionFact,
  type Standing,
  type StudentAttendance,
} from "@/lib/domain/attendance";
import type { IsoDate } from "@/lib/domain/dates";
import { todayIn } from "@/lib/domain/dates";
import { rollLabels } from "@/lib/domain/marking";
import { getSettings } from "./queries";

/**
 * Attendance percentages for a class, computed on every request from the raw marks with the pure
 * rules in lib/domain/attendance.ts (nothing is stored, so a corrected mark or leave notice shows at once).
 */

export interface SubjectRef {
  offeringId: number;
  code: string;
  shortName: string;
  name: string;
  hasTheory: boolean;
  hasPractical: boolean;
}

export interface StudentRow {
  studentId: number;
  regNo: string;
  name: string;
  roll: string;
  status: string;
  joinedOn: IsoDate;
  leftOn: IsoDate | null;
  attendance: StudentAttendance;
  /** Standing per subject (offeringId → standing of the combined theory + lab tally). */
  subjectStanding: Map<number, Standing>;
  /** Worst subject standing (the per-subject 60% rule). */
  standing: Standing;
  /** Standing of the overall tally across subjects. */
  overallStanding: Standing;
}

export interface ClassAttendance {
  classId: number;
  from: IsoDate;
  to: IsoDate;
  minPct: number;
  warnPct: number;
  subjects: SubjectRef[];
  students: StudentRow[];
  /** Past/today classes still not entered — percentages leave them out, so the HOD must chase them. */
  unmarkedSessions: number;
  heldSessions: number;
}

export const getLeavePolicy = cache(async (): Promise<LeavePolicy> => {
  const { rows } = await getDb().execute<{ type: keyof LeavePolicy; counts_as: LeavePolicy[keyof LeavePolicy] }>(
    sql`SELECT type::text, counts_as::text FROM leave_policy`,
  );
  // A missing row falls back to the strictest reading (absent) rather than crashing.
  const policy: LeavePolicy = { MEDICAL: "ABSENT", ON_DUTY: "ABSENT", PERSONAL: "ABSENT", OTHER: "ABSENT" };
  for (const r of rows) policy[r.type] = r.counts_as;
  return policy;
});

/**
 * Load and compute attendance for one class.
 * `to` defaults to today and is capped at today (future classes never count); `studentIds` limits the students.
 */
export async function getClassAttendance(classId: number, opts: { from?: IsoDate | null; to?: IsoDate | null; studentIds?: number[] } = {}): Promise<ClassAttendance> {
  const db = getDb();
  const today = todayIn();
  const to = opts.to && opts.to < today ? opts.to : today;
  const from = opts.from ?? "1900-01-01";
  const onlyStudents = opts.studentIds ? (opts.studentIds.length ? sql`AND m.student_id IN (${sql.join(opts.studentIds.map((i) => sql`${i}`), sql`, `)})` : sql`AND false`) : sql``;
  const markStudents = opts.studentIds ? (opts.studentIds.length ? sql`AND ar.student_id IN (${sql.join(opts.studentIds.map((i) => sql`${i}`), sql`, `)})` : sql`AND false`) : sql``;

  const [settings, policy, subjectsRes, sessionsRes, membersRes, marksRes, leavesRes] = await Promise.all([
    getSettings(),
    getLeavePolicy(),
    db.execute<{ offering_id: number; code: string; short_name: string; name: string; has_theory: boolean; has_practical: boolean }>(sql`
      SELECT o.id AS offering_id, c.code, c.short_name, c.name,
             EXISTS (SELECT 1 FROM class_session cs WHERE cs.offering_id = o.id AND cs.component = 'THEORY') AS has_theory,
             EXISTS (SELECT 1 FROM class_session cs WHERE cs.offering_id = o.id AND cs.component = 'PRACTICAL') AS has_practical
      FROM course_offering o JOIN course c ON c.id = o.course_id
      WHERE o.class_group_id = ${classId}
      ORDER BY c.code`),
    db.execute<{ id: number; offering_id: number; component: SessionFact["component"]; batch_scope: SessionFact["batchScope"]; date: string; status: SessionFact["status"] }>(sql`
      SELECT cs.id, cs.offering_id, cs.component::text, cs.batch_scope::text, to_char(cs.date, 'YYYY-MM-DD') AS date, cs.status::text
      FROM class_session cs JOIN course_offering o ON o.id = cs.offering_id
      WHERE o.class_group_id = ${classId} AND cs.date BETWEEN ${from}::date AND ${to}::date AND cs.status IN ('HELD', 'SCHEDULED')`),
    db.execute<{ student_id: number; reg_no: string; name: string; status: string; joined_on: string; left_on: string | null; batches: { batch: "B1" | "B2"; effectiveFrom: string }[] | null }>(sql`
      SELECT m.student_id, s.reg_no, s.name, s.status::text, to_char(m.joined_on, 'YYYY-MM-DD') AS joined_on, to_char(m.left_on, 'YYYY-MM-DD') AS left_on,
             (SELECT json_agg(json_build_object('batch', ba.batch, 'effectiveFrom', to_char(ba.effective_from, 'YYYY-MM-DD')))
                FROM batch_assignment ba WHERE ba.membership_id = m.id) AS batches
      FROM class_membership m JOIN student s ON s.id = m.student_id
      WHERE m.class_group_id = ${classId} ${onlyStudents}
      ORDER BY s.reg_no`),
    db.execute<{ session_id: number; student_id: number; status: MarkStatus }>(sql`
      SELECT ar.session_id, ar.student_id, ar.status::text
      FROM attendance_record ar
      JOIN class_session cs ON cs.id = ar.session_id
      JOIN course_offering o ON o.id = cs.offering_id
      WHERE o.class_group_id = ${classId} AND cs.date BETWEEN ${from}::date AND ${to}::date AND cs.status = 'HELD' ${markStudents}`),
    db.execute<{ student_id: number; type: LeaveFact["type"]; from_date: string; to_date: string }>(sql`
      SELECT ln.student_id, ln.type::text, to_char(ln.from_date, 'YYYY-MM-DD') AS from_date, to_char(ln.to_date, 'YYYY-MM-DD') AS to_date
      FROM leave_notice ln
      WHERE ln.status = 'APPROVED' AND ln.to_date >= ${from}::date AND ln.from_date <= ${to}::date
        AND ln.student_id IN (SELECT m.student_id FROM class_membership m WHERE m.class_group_id = ${classId} ${onlyStudents})`),
  ]);

  const sessions: SessionFact[] = sessionsRes.rows.map((r) => ({ id: r.id, offeringId: r.offering_id, component: r.component, batchScope: r.batch_scope, date: r.date, status: r.status }));
  const marksByStudent = new Map<number, Map<number, MarkStatus>>();
  for (const r of marksRes.rows) {
    let m = marksByStudent.get(r.student_id);
    if (!m) marksByStudent.set(r.student_id, (m = new Map()));
    m.set(r.session_id, r.status);
  }
  const leavesByStudent = new Map<number, LeaveFact[]>();
  for (const r of leavesRes.rows) {
    const list = leavesByStudent.get(r.student_id) ?? [];
    list.push({ type: r.type, fromDate: r.from_date, toDate: r.to_date });
    leavesByStudent.set(r.student_id, list);
  }
  const minPct = settings.attendanceMinPct;
  const warnPct = settings.attendanceWarnPct;
  const labels = rollLabels(membersRes.rows.map((r) => ({ studentId: r.student_id, regNo: r.reg_no })));

  const students: StudentRow[] = membersRes.rows.map((r) => {
    const membership: MembershipFact = { joinedOn: r.joined_on, leftOn: r.left_on, batches: r.batches ?? [] };
    const attendance = computeStudentAttendance({
      sessions,
      membership,
      marks: marksByStudent.get(r.student_id) ?? new Map(),
      approvedLeaves: leavesByStudent.get(r.student_id) ?? [],
      policy,
    });
    const subjectStanding = new Map(attendance.byOffering.map((o) => [o.offeringId, tallyStanding(o.total, minPct, warnPct)]));
    return {
      studentId: r.student_id,
      regNo: r.reg_no,
      name: r.name,
      roll: labels.get(r.student_id)!,
      status: r.status,
      joinedOn: r.joined_on,
      leftOn: r.left_on,
      attendance,
      subjectStanding,
      standing: worstStanding([...subjectStanding.values()]),
      overallStanding: tallyStanding(attendance.overall, minPct, warnPct),
    };
  });

  return {
    classId,
    from,
    to,
    minPct,
    warnPct,
    subjects: subjectsRes.rows.map((r) => ({ offeringId: r.offering_id, code: r.code, shortName: r.short_name, name: r.name, hasTheory: r.has_theory, hasPractical: r.has_practical })),
    students,
    unmarkedSessions: sessions.filter((s) => s.status === "SCHEDULED").length,
    heldSessions: sessions.filter((s) => s.status === "HELD").length,
  };
}

/** Whether a student still belongs on lists (left / dropped-out students are kept out of shortage lists). */
export function isCurrent(s: Pick<StudentRow, "status" | "leftOn">) {
  return s.status !== "DROPPED" && s.status !== "ALUMNI" && s.leftOn === null;
}
