import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { formatIndianMobile } from "@/lib/domain/phone";

/**
 * Demo helpers, only active while the dummy college is loaded (college_settings.demo_data, set by the
 * seed). With real data these return nothing, so no login hint can ever show on a real system.
 */
export async function isDemoData(): Promise<boolean> {
  const { rows } = await getDb().execute<{ demo: boolean }>(sql`SELECT demo_data AS demo FROM college_settings WHERE id = 1`);
  return rows[0]?.demo === true;
}

export interface DemoLogin {
  role: string;
  name: string;
  phone: string;
}

/** One ready account per role, picked from the dummy data by role (so it never goes stale). */
export async function demoStaffLogins(): Promise<{ logins: DemoLogin[]; password: string } | null> {
  if (!(await isDemoData())) return null;
  const { rows } = await getDb().execute<{ role: string; name: string; phone: string }>(sql`
    WITH g AS (
      SELECT g.role::text AS role, g.staff_id, d.code AS dept, cd.code AS class_dept, cg.semester
      FROM role_grant g
      LEFT JOIN department d ON d.id = g.department_id
      LEFT JOIN class_group cg ON cg.id = g.class_group_id
      LEFT JOIN department cd ON cd.id = cg.department_id
    ),
    picks AS (
      SELECT 1 AS ord, 'Admin' AS role, (SELECT min(staff_id) FROM g WHERE role = 'ADMIN') AS staff_id
      UNION ALL SELECT 2, 'Principal', (SELECT min(staff_id) FROM g WHERE role = 'PRINCIPAL')
      UNION ALL SELECT 3, 'Office', (SELECT min(staff_id) FROM g WHERE role = 'OFFICE')
      UNION ALL SELECT 4, 'HOD, CS', (SELECT min(staff_id) FROM g WHERE role = 'HOD' AND dept = 'CS')
      UNION ALL SELECT 5, 'Teacher + class teacher, CS Sem 3', (SELECT min(staff_id) FROM g WHERE role = 'CLASS_TEACHER' AND class_dept = 'CS' AND semester = 3)
      UNION ALL SELECT 6, 'Teacher, CS', (SELECT max(g.staff_id) FROM g WHERE role = 'FACULTY' AND dept = 'CS'
                                            AND NOT EXISTS (SELECT 1 FROM g g2 WHERE g2.staff_id = g.staff_id AND g2.role <> 'FACULTY'))
    )
    SELECT p.role, s.name, s.phone FROM picks p JOIN staff s ON s.id = p.staff_id AND s.active ORDER BY p.ord`);
  return { logins: rows.map((r) => ({ ...r, phone: formatIndianMobile(r.phone) })), password: process.env.SEED_STAFF_PASSWORD || "meidemo2026" };
}

/** The demo guardian (one number, two children) for the parent portal. */
export async function demoParentLogin(): Promise<{ phone: string; regNos: string[] } | null> {
  if (!(await isDemoData())) return null;
  const { rows } = await getDb().execute<{ phone: string; reg_no: string }>(sql`
    SELECT pc.phone, s.reg_no FROM parent_contact pc JOIN student s ON s.id = pc.student_id
    WHERE pc.name = 'Demo Guardian' ORDER BY s.reg_no DESC`);
  if (!rows.length) return null;
  return { phone: formatIndianMobile(rows[0].phone), regNos: rows.map((r) => r.reg_no) };
}
