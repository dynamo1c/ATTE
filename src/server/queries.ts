import "server-only";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import { classGroup, classMembership, department, roleGrant, staff, term } from "@/db/schema";
import { todayIn } from "@/lib/domain/dates";

export const SEMESTER_LABEL = (n: number) => `Sem ${n}`;

/** The term running today; otherwise the latest one that has started; otherwise the newest. */
export const getCurrentTerm = cache(async () => {
  const db = getDb();
  const today = todayIn();
  const [started] = await db.select().from(term).where(lte(term.startsOn, today)).orderBy(desc(term.startsOn)).limit(1);
  if (started) return started;
  const [any] = await db.select().from(term).orderBy(desc(term.startsOn)).limit(1);
  return any ?? null;
});

export const listDepartments = cache(async () => getDb().select().from(department).orderBy(asc(department.code)));

export interface ClassRow {
  id: number;
  semester: number;
  departmentId: number;
  departmentCode: string;
  departmentName: string;
  students: number;
  classTeacher: string | null;
}

/** Classes in a term, optionally limited to some departments / class ids. */
export async function listClasses(termId: number, filter: { departmentIds?: number[] | null; classIds?: number[] } = {}): Promise<ClassRow[]> {
  const db = getDb();
  const conds = [eq(classGroup.termId, termId)];
  if (filter.departmentIds) conds.push(filter.departmentIds.length ? inArray(classGroup.departmentId, filter.departmentIds) : sql`false`);
  if (filter.classIds) conds.push(filter.classIds.length ? inArray(classGroup.id, filter.classIds) : sql`false`);
  const rows = await db
    .select({
      id: classGroup.id,
      semester: classGroup.semester,
      departmentId: department.id,
      departmentCode: department.code,
      departmentName: department.name,
      students: sql<number>`(SELECT count(*)::int FROM ${classMembership} m WHERE m.class_group_id = ${classGroup.id} AND m.left_on IS NULL)`,
      classTeacher: sql<string | null>`(SELECT s.name FROM ${roleGrant} g JOIN ${staff} s ON s.id = g.staff_id WHERE g.role = 'CLASS_TEACHER' AND g.class_group_id = ${classGroup.id} ORDER BY g.id LIMIT 1)`,
    })
    .from(classGroup)
    .innerJoin(department, eq(department.id, classGroup.departmentId))
    .where(and(...conds))
    .orderBy(asc(department.code), asc(classGroup.semester));
  return rows;
}

export async function getClass(id: number) {
  const [row] = await getDb()
    .select({
      id: classGroup.id,
      semester: classGroup.semester,
      termId: classGroup.termId,
      departmentId: department.id,
      departmentCode: department.code,
      departmentName: department.name,
    })
    .from(classGroup)
    .innerJoin(department, eq(department.id, classGroup.departmentId))
    .where(eq(classGroup.id, id))
    .limit(1);
  return row ?? null;
}

export function className(c: { departmentCode: string; semester: number }) {
  return `${c.departmentCode} ${SEMESTER_LABEL(c.semester)}`;
}

/** Parse a route id param; null when not a positive integer (render 404). */
export function parseId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}
