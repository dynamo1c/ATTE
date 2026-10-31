import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { canManageClassStudents, canViewClass, canViewDepartment, type Actor } from "@/lib/auth/permissions";
import { todayIn } from "@/lib/domain/dates";

export interface StudentProfile {
  id: number;
  regNo: string;
  name: string;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  dateOfBirth: string | null;
  status: string;
  admissionYear: number;
  lateralEntry: boolean;
  departmentId: number;
  departmentCode: string;
  membership: { id: number; classGroupId: number; classDepartmentId: number; semester: number; classDept: string; joinedOn: string; leftOn: string | null; batch: "B1" | "B2" | null } | null;
}

/** Student with their class in the given term (null membership if not enrolled that term). */
export async function getStudent(id: number, termId: number | null): Promise<StudentProfile | null> {
  const today = todayIn();
  const { rows } = await getDb().execute<{
    id: number;
    reg_no: string;
    name: string;
    gender: StudentProfile["gender"];
    date_of_birth: string | null;
    status: string;
    admission_year: number;
    lateral_entry: boolean;
    department_id: number;
    dept: string;
    m_id: number | null;
    class_group_id: number | null;
    class_dept_id: number | null;
    semester: number | null;
    class_dept: string | null;
    joined_on: string | null;
    left_on: string | null;
    batch: "B1" | "B2" | null;
  }>(sql`
    SELECT s.id, s.reg_no, s.name, s.gender, to_char(s.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, s.status, s.admission_year, s.lateral_entry,
           s.department_id, d.code AS dept,
           m.id AS m_id, m.class_group_id, cg.department_id AS class_dept_id, cg.semester, cd.code AS class_dept,
           to_char(m.joined_on, 'YYYY-MM-DD') AS joined_on, to_char(m.left_on, 'YYYY-MM-DD') AS left_on,
           (SELECT ba.batch FROM batch_assignment ba WHERE ba.membership_id = m.id AND ba.effective_from <= ${today} ORDER BY ba.effective_from DESC LIMIT 1) AS batch
    FROM student s
    JOIN department d ON d.id = s.department_id
    LEFT JOIN class_membership m ON m.student_id = s.id AND m.term_id = ${termId ?? -1}
    LEFT JOIN class_group cg ON cg.id = m.class_group_id
    LEFT JOIN department cd ON cd.id = cg.department_id
    WHERE s.id = ${id}`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    regNo: r.reg_no,
    name: r.name,
    gender: r.gender,
    dateOfBirth: r.date_of_birth,
    status: r.status,
    admissionYear: r.admission_year,
    lateralEntry: r.lateral_entry,
    departmentId: r.department_id,
    departmentCode: r.dept,
    membership: r.m_id
      ? { id: r.m_id, classGroupId: r.class_group_id!, classDepartmentId: r.class_dept_id!, semester: r.semester!, classDept: r.class_dept!, joinedOn: r.joined_on!, leftOn: r.left_on, batch: r.batch }
      : null,
  };
}

export function canViewStudent(a: Actor, s: StudentProfile) {
  if (s.membership && canViewClass(a, { id: s.membership.classGroupId, departmentId: s.membership.classDepartmentId })) return true;
  return canViewDepartment(a, s.departmentId);
}

export function canManageStudent(a: Actor, s: StudentProfile) {
  if (s.membership) return canManageClassStudents(a, { id: s.membership.classGroupId, departmentId: s.membership.classDepartmentId });
  return false;
}
