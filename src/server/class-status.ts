import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { IsoDate } from "@/lib/domain/dates";

/** Attendance entry for one subject part of a class over a date range. */
export type EntryRow = {
  offeringId: number;
  subject: string;
  component: "THEORY" | "PRACTICAL";
  teachers: string | null;
  held: number;
  notHeld: number;
  /** Past or today's classes with no attendance yet. */
  pending: number;
  /** Dates of the pending ones, oldest first ("YYYY-MM-DD"). */
  pendingDates: string[] | null;
};

/** Per subject part: classes entered, not held and still not entered, from `from` to `to` (inclusive). */
export async function attendanceEntry(classId: number, from: IsoDate, to: IsoDate): Promise<EntryRow[]> {
  const { rows } = await getDb().execute<EntryRow>(sql`
    SELECT o.id AS "offeringId", c.short_name AS subject, cs.component::text AS component,
           (SELECT string_agg(DISTINCT s.name, ', ') FROM teaching_assignment ta JOIN staff s ON s.id = ta.staff_id
             WHERE ta.offering_id = o.id AND ta.component = cs.component) AS teachers,
           count(*) FILTER (WHERE cs.status = 'HELD')::int AS held,
           count(*) FILTER (WHERE cs.status = 'NOT_HELD')::int AS "notHeld",
           count(*) FILTER (WHERE cs.status = 'SCHEDULED')::int AS pending,
           string_agg(DISTINCT to_char(cs.date, 'YYYY-MM-DD'), ',') FILTER (WHERE cs.status = 'SCHEDULED') AS "pendingDates"
    FROM class_session cs
    JOIN course_offering o ON o.id = cs.offering_id
    JOIN course c ON c.id = o.course_id
    WHERE o.class_group_id = ${classId} AND cs.date BETWEEN ${from}::date AND ${to}::date AND cs.status <> 'CANCELLED'
    GROUP BY o.id, c.short_name, cs.component
    ORDER BY pending DESC, c.short_name, cs.component`);
  // Sent as "2026-11-05,2026-11-06" (a plain string is simpler to read back than a Postgres array).
  return rows.map((r) => ({ ...r, pendingDates: r.pendingDates ? String(r.pendingDates).split(",").sort() : null }));
}

/** One test of one subject: how far marks entry has got. */
export type MarksEntryRow = {
  offeringId: number;
  subject: string;
  label: string;
  component: "THEORY" | "PRACTICAL";
  isFinal: boolean;
  teachers: string | null;
  status: "DRAFT" | "SUBMITTED" | "PUBLISHED" | null;
  entered: number;
  students: number;
};

/** Every test of every subject of the class, with how many marks are in and the test's status. */
export async function marksEntry(classId: number): Promise<MarksEntryRow[]> {
  const { rows } = await getDb().execute<MarksEntryRow>(sql`
    WITH students AS (
      SELECT count(*)::int AS n FROM class_membership m JOIN student s ON s.id = m.student_id
      WHERE m.class_group_id = ${classId} AND m.left_on IS NULL AND s.status IN ('ACTIVE', 'DETAINED')
    )
    SELECT o.id AS "offeringId", c.short_name AS subject, sc.label, sc.component::text AS component, sc.is_final AS "isFinal",
           (SELECT string_agg(DISTINCT st.name, ', ') FROM teaching_assignment ta JOIN staff st ON st.id = ta.staff_id
             WHERE ta.offering_id = o.id AND ta.component = sc.component) AS teachers,
           a.status::text AS status,
           (SELECT count(*)::int FROM mark mk
              JOIN class_membership m ON m.student_id = mk.student_id AND m.class_group_id = ${classId} AND m.left_on IS NULL
             WHERE mk.assessment_id = a.id) AS entered,
           (SELECT n FROM students) AS students
    FROM course_offering o
    JOIN course c ON c.id = o.course_id
    JOIN scheme_component sc ON sc.scheme_id = c.scheme_id
    LEFT JOIN assessment a ON a.offering_id = o.id AND a.scheme_component_id = sc.id
    WHERE o.class_group_id = ${classId}
    ORDER BY c.short_name, sc.ordinal`);
  return rows;
}
