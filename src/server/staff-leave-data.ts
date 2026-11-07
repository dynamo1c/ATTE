import "server-only";
import { and, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { calendarDay } from "@/db/schema";
import type { LeaveApplicant } from "@/lib/auth/permissions";
import { resolveDay, type CalendarEntry } from "@/lib/domain/calendar";
import { dateRange, type IsoDate } from "@/lib/domain/dates";
import { leaveCoversClass, type DayPart } from "@/lib/domain/staff-leave";
import { planSessionsForDay, type VersionDef } from "@/lib/domain/timetable";
import { loadVersions } from "./generate-sessions";

export async function getApplicant(staffId: number): Promise<LeaveApplicant & { name: string }> {
  const { rows } = await getDb().execute<{ name: string; department_id: number | null; is_hod: boolean }>(sql`
    SELECT s.name, s.department_id, EXISTS (SELECT 1 FROM role_grant g WHERE g.staff_id = s.id AND g.role = 'HOD') AS is_hod
    FROM staff s WHERE s.id = ${staffId}`);
  if (!rows[0]) throw new Error(`Staff ${staffId} not found`);
  return { staffId, name: rows[0].name, departmentId: rows[0].department_id, isHod: rows[0].is_hod };
}

export interface LeaveRef {
  id: number;
  staffId: number;
  fromDate: IsoDate;
  toDate: IsoDate;
  part: DayPart;
}

export interface MissedClass {
  date: IsoDate;
  startsAt: string;
  periods: string;
  className: string;
  subject: string;
  component: "THEORY" | "PRACTICAL";
  batch: "ALL" | "B1" | "B2";
}

/**
 * Timetable classes each teacher would miss during their leave (from the timetable and calendar, so it
 * works for future dates too). These need a substitute. Activity periods are not included.
 */
export async function classesDuringLeaves(leaves: readonly LeaveRef[]): Promise<Map<number, MissedClass[]>> {
  const out = new Map<number, MissedClass[]>(leaves.map((l) => [l.id, []]));
  if (!leaves.length) return out;
  const db = getDb();
  const staffIds = [...new Set(leaves.map((l) => l.staffId))];
  const from = leaves.reduce((m, l) => (l.fromDate < m ? l.fromDate : m), leaves[0].fromDate);
  const to = leaves.reduce((m, l) => (l.toDate > m ? l.toDate : m), leaves[0].toDate);

  // What each teacher teaches in classes of terms overlapping the leave dates.
  const { rows: teaching } = await db.execute<{
    staff_id: number;
    offering_id: number;
    component: "THEORY" | "PRACTICAL";
    batch_scope: "ALL" | "B1" | "B2";
    class_id: number;
    department_id: number;
    class_name: string;
    subject: string;
    starts_on: string;
    ends_on: string;
  }>(sql`
    SELECT ta.staff_id, ta.offering_id, ta.component, ta.batch_scope, cg.id AS class_id, cg.department_id,
           d.code || ' Sem ' || cg.semester AS class_name, c.short_name AS subject,
           to_char(t.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(t.ends_on, 'YYYY-MM-DD') AS ends_on
    FROM teaching_assignment ta
    JOIN course_offering o ON o.id = ta.offering_id
    JOIN course c ON c.id = o.course_id
    JOIN class_group cg ON cg.id = o.class_group_id
    JOIN term t ON t.id = cg.term_id
    JOIN department d ON d.id = cg.department_id
    WHERE ta.staff_id IN (${sql.join(staffIds.map((i) => sql`${i}`), sql`, `)})
      AND t.starts_on <= ${to} AND t.ends_on >= ${from}`);
  if (!teaching.length) return out;

  const { rows: periods } = await db.execute<{ ordinal: number; label: string; starts_at: string }>(sql`SELECT ordinal, label, starts_at::text FROM period`);
  const period = new Map(periods.map((p) => [p.ordinal, p]));
  const calendar: CalendarEntry[] = (await db.select().from(calendarDay).where(and(gte(calendarDay.date, from), lte(calendarDay.date, to)))).map((e) => ({
    date: e.date,
    type: e.type,
    followsWeekday: e.followsWeekday,
    departmentId: e.departmentId,
    classGroupId: e.classGroupId,
    note: e.note,
  }));
  const versions = new Map<number, VersionDef[]>();
  for (const classId of new Set(teaching.map((t) => t.class_id))) versions.set(classId, await loadVersions(db, classId));

  for (const l of leaves) {
    const mine = teaching.filter((t) => t.staff_id === l.staffId);
    const list = out.get(l.id)!;
    for (const classId of new Set(mine.map((t) => t.class_id))) {
      const info = mine.find((t) => t.class_id === classId)!;
      for (const date of dateRange(l.fromDate, l.toDate)) {
        if (date < info.starts_on || date > info.ends_on) continue;
        const day = resolveDay(date, calendar, { departmentId: info.department_id, classGroupId: classId });
        for (const p of planSessionsForDay(day, versions.get(classId) ?? [])) {
          const a = mine.find((t) => t.offering_id === p.offeringId && t.component === p.component && (t.batch_scope === "ALL" || t.batch_scope === p.batchScope));
          const start = period.get(p.startPeriod);
          if (!a || !start || !leaveCoversClass(l, date, start.starts_at)) continue;
          const end = period.get(p.endPeriod);
          list.push({
            date,
            startsAt: start.starts_at.slice(0, 5),
            periods: p.startPeriod === p.endPeriod ? start.label : `${start.label}–${end?.label ?? p.endPeriod}`,
            className: a.class_name,
            subject: a.subject,
            component: p.component,
            batch: p.batchScope,
          });
        }
      }
    }
    list.sort((a, b) => (a.date + a.startsAt < b.date + b.startsAt ? -1 : 1));
  }
  return out;
}
