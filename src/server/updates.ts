import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { IsoDate } from "@/lib/domain/dates";

/** Who an update is for: "college", "dept:<id>" or "class:<id>". */
export const AUDIENCE = /^(college|dept:\d{1,9}|class:\d{1,9})$/;

export function parseAudience(raw: string): { departmentId: number | null; classGroupId: number | null } {
  const [kind, id] = raw.split(":");
  if (kind === "dept") return { departmentId: Number(id), classGroupId: null };
  if (kind === "class") return { departmentId: null, classGroupId: Number(id) };
  return { departmentId: null, classGroupId: null };
}

/** WhatsApp text of an update: the title on its own line, then the notice. */
export function updateMessageText(title: string, body: string): string {
  return `${title}\n${body}`;
}

/** Current students (this term, still in class, active or detained) an update reaches. */
export async function audienceStudentIds(db: Pick<Db, "execute">, termId: number, a: { departmentId: number | null; classGroupId: number | null }): Promise<number[]> {
  const filter = a.classGroupId ? sql`AND cg.id = ${a.classGroupId}` : a.departmentId ? sql`AND cg.department_id = ${a.departmentId}` : sql``;
  const { rows } = await db.execute<{ id: number }>(sql`
    SELECT s.id FROM class_membership m
    JOIN student s ON s.id = m.student_id
    JOIN class_group cg ON cg.id = m.class_group_id
    WHERE m.term_id = ${termId} AND m.left_on IS NULL AND s.status IN ('ACTIVE', 'DETAINED') ${filter}`);
  return rows.map((r) => r.id);
}

export type UpdateRow = {
  id: number;
  title: string;
  bodyEn: string;
  bodyKn: string | null;
  audience: string;
  publishedAt: Date;
  publishedBy: string;
};

/**
 * Updates a parent sees: college-wide ones plus those for their children's departments and classes,
 * not withdrawn, newest first.
 */
export async function updatesForClasses(db: Pick<Db, "execute">, classes: readonly { classId: number; departmentId: number }[], since: IsoDate, limit = 50): Promise<UpdateRow[]> {
  const classIds = classes.map((c) => sql`${c.classId}`);
  const deptIds = classes.map((c) => sql`${c.departmentId}`);
  const { rows } = await db.execute<UpdateRow>(sql`
    SELECT u.id, u.title, u.body_en AS "bodyEn", u.body_kn AS "bodyKn", u.published_at AS "publishedAt", s.name AS "publishedBy",
           COALESCE(d.code || ' department', cd.code || ' Sem ' || cg.semester, 'Whole college') AS audience
    FROM college_update u
    JOIN staff s ON s.id = u.published_by
    LEFT JOIN department d ON d.id = u.department_id
    LEFT JOIN class_group cg ON cg.id = u.class_group_id
    LEFT JOIN department cd ON cd.id = cg.department_id
    WHERE u.withdrawn_at IS NULL AND u.published_at >= ${since}::date
      AND ((u.department_id IS NULL AND u.class_group_id IS NULL)
        ${deptIds.length ? sql`OR u.department_id IN (${sql.join(deptIds, sql`, `)})` : sql``}
        ${classIds.length ? sql`OR u.class_group_id IN (${sql.join(classIds, sql`, `)})` : sql``})
    ORDER BY u.published_at DESC
    LIMIT ${limit}`);
  return rows.map((r) => ({ ...r, publishedAt: new Date(r.publishedAt) }));
}
