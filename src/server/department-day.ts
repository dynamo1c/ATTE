import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { IsoDate } from "@/lib/domain/dates";

/** One class period on the "Department today" page. */
export type DayPeriod = {
  id: number;
  classId: number;
  startPeriod: number;
  endPeriod: number;
  startsAt: string;
  endsAt: string;
  status: "SCHEDULED" | "HELD" | "NOT_HELD" | "CANCELLED";
  statusReason: string | null;
  component: "THEORY" | "PRACTICAL";
  batchScope: "ALL" | "B1" | "B2";
  subject: string;
  /** Subject teacher(s) of this part, or null when nobody is assigned. */
  teachers: string | null;
  /** The viewer is a subject teacher of this period. */
  mine: boolean;
  savedBy: string | null;
  savedById: number | null;
  /** "10:05", or "12 Nov, 16:20" when it was saved on a later day. */
  savedAt: string | null;
};

/**
 * Every class period of the given departments' classes on one day (current term), in period order, with
 * who saved each one. `departmentIds` null = every department (admin).
 */
export async function departmentDay(termId: number, day: IsoDate, departmentIds: readonly number[] | null, viewerId: number): Promise<DayPeriod[]> {
  const deptFilter = departmentIds === null ? sql`true` : departmentIds.length ? sql`cg.department_id IN (${sql.join(departmentIds.map((d) => sql`${d}`), sql`, `)})` : sql`false`;
  const { rows } = await getDb().execute<DayPeriod>(sql`
    SELECT cs.id, cg.id AS "classId", cs.start_period AS "startPeriod", cs.end_period AS "endPeriod",
           to_char(ps.starts_at, 'HH24:MI') AS "startsAt", to_char(pe.ends_at, 'HH24:MI') AS "endsAt",
           cs.status::text AS status, cs.status_reason AS "statusReason", cs.component::text AS component, cs.batch_scope::text AS "batchScope",
           c.short_name AS subject,
           (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM teaching_assignment ta JOIN staff s ON s.id = ta.staff_id
             WHERE ta.offering_id = cs.offering_id AND ta.component = cs.component AND ta.batch_scope IN ('ALL', cs.batch_scope)) AS teachers,
           EXISTS (SELECT 1 FROM teaching_assignment ta WHERE ta.offering_id = cs.offering_id AND ta.component = cs.component
                    AND ta.batch_scope IN ('ALL', cs.batch_scope) AND ta.staff_id = ${viewerId}) AS mine,
           ms.name AS "savedBy", cs.marked_by AS "savedById",
           CASE WHEN (cs.marked_at AT TIME ZONE 'Asia/Kolkata')::date = cs.date THEN to_char(cs.marked_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')
                ELSE to_char(cs.marked_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH24:MI') END AS "savedAt"
    FROM class_session cs
    JOIN course_offering o ON o.id = cs.offering_id
    JOIN course c ON c.id = o.course_id
    JOIN class_group cg ON cg.id = o.class_group_id
    JOIN period ps ON ps.ordinal = cs.start_period
    JOIN period pe ON pe.ordinal = cs.end_period
    LEFT JOIN staff ms ON ms.id = cs.marked_by
    WHERE cs.date = ${day}::date AND cg.term_id = ${termId} AND ${deptFilter}
    ORDER BY cg.id, cs.start_period, cs.batch_scope, cs.component`);
  return rows;
}
