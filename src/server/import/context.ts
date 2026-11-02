import "server-only";
/**
 * What each import check needs to know about the saved data, for one term. Takes a transaction so
 * the final check runs on exactly the data the import then writes (docs/PLAN.md §13 phase 10).
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { IsoDate } from "@/lib/domain/dates";
import type { StaffContext } from "@/lib/import/staff";
import type { StudentContext } from "@/lib/import/students";
import type { SubjectContext } from "@/lib/import/subjects";
import type { TimetableContext } from "@/lib/import/timetable";

async function rows<T>(db: DbOrTx, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(q)).rows as T[];
}

const departments = (db: DbOrTx) => rows<{ id: number; code: string }>(db, sql`SELECT id, code FROM department WHERE active ORDER BY code`);

const classes = (db: DbOrTx, termId: number) =>
  rows<{ id: number; departmentId: number; departmentCode: string; semester: number }>(
    db,
    sql`SELECT cg.id, cg.department_id AS "departmentId", d.code AS "departmentCode", cg.semester
        FROM class_group cg JOIN department d ON d.id = cg.department_id WHERE cg.term_id = ${termId} ORDER BY d.code, cg.semester`,
  );

export async function staffContext(db: DbOrTx, termId: number): Promise<StaffContext> {
  const [depts, cls, people, grants] = [
    await departments(db),
    await classes(db, termId),
    await rows<StaffContext["staff"][number]>(db, sql`SELECT id, name, phone, email, department_id AS "departmentId", designation, active FROM staff`),
    await rows<{ staffId: number; role: StaffContext["staff"][number]["grants"][number]["role"]; departmentId: number | null; classGroupId: number | null }>(
      db,
      sql`SELECT staff_id AS "staffId", role::text AS role, department_id AS "departmentId", class_group_id AS "classGroupId" FROM role_grant`,
    ),
  ];
  const byStaff = Map.groupBy(grants, (g) => g.staffId);
  return {
    departments: depts,
    classes: cls.map((c) => ({ ...c, classTeachers: grants.filter((g) => g.role === "CLASS_TEACHER" && g.classGroupId === c.id).map((g) => g.staffId) })),
    staff: people.map((p) => ({ ...p, grants: (byStaff.get(p.id) ?? []).map(({ role, departmentId, classGroupId }) => ({ role, departmentId, classGroupId })) })),
  };
}

export async function subjectContext(db: DbOrTx, termId: number): Promise<SubjectContext> {
  const cls = await classes(db, termId);
  const offered = await rows<{ classId: number; courseId: number }>(
    db,
    sql`SELECT o.class_group_id AS "classId", o.course_id AS "courseId" FROM course_offering o JOIN class_group cg ON cg.id = o.class_group_id WHERE cg.term_id = ${termId}`,
  );
  return {
    departments: await departments(db),
    schemes: await rows(db, sql`SELECT id, name FROM assessment_scheme ORDER BY id`),
    courses: await rows(
      db,
      sql`SELECT id, code, department_id AS "departmentId", semester, short_name AS "shortName", name, kind::text AS kind, scheme_id AS "schemeId" FROM course`,
    ),
    classes: cls.map((c) => ({ id: c.id, departmentId: c.departmentId, semester: c.semester, courseIds: offered.filter((o) => o.classId === c.id).map((o) => o.courseId) })),
  };
}

export async function studentContext(db: DbOrTx, termId: number, today: IsoDate): Promise<StudentContext> {
  const [settings] = await rows<{ collegeCode: string }>(db, sql`SELECT college_code AS "collegeCode" FROM college_settings WHERE id = 1`);
  const students = await rows<Omit<StudentContext["students"][number], "membership" | "contacts"> & { classGroupId: number | null; batch: "B1" | "B2" | null }>(
    db,
    sql`SELECT s.id, s.reg_no AS "regNo", s.name, s.gender::text AS gender, to_char(s.date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth",
               s.lateral_entry AS "lateralEntry", s.status::text AS status, m.class_group_id AS "classGroupId",
               (SELECT b.batch::text FROM batch_assignment b WHERE b.membership_id = m.id
                ORDER BY (b.effective_from <= greatest(${today}::date, m.joined_on)) DESC, b.effective_from DESC LIMIT 1) AS batch
        FROM student s LEFT JOIN class_membership m ON m.student_id = s.id AND m.term_id = ${termId}`,
  );
  const contacts = await rows<StudentContext["students"][number]["contacts"][number] & { studentId: number }>(
    db,
    sql`SELECT id, student_id AS "studentId", phone, name, relation::text AS relation, language::text AS language, whatsapp_ok AS "whatsappOk",
               consent_at AS "consentAt", opted_out_at AS "optedOutAt" FROM parent_contact ORDER BY id`,
  );
  const byStudent = Map.groupBy(contacts, (c) => c.studentId);
  return {
    collegeCode: settings?.collegeCode ?? "",
    departments: await departments(db),
    classes: await classes(db, termId),
    students: students.map(({ classGroupId, batch, ...s }) => ({
      ...s,
      membership: classGroupId === null ? null : { classGroupId, batch },
      contacts: (byStudent.get(s.id) ?? []).map(({ studentId: _s, ...c }) => c),
    })),
  };
}

export async function timetableContext(db: DbOrTx, term: { id: number; startsOn: IsoDate; endsOn: IsoDate }, effectiveFrom: IsoDate, today: IsoDate): Promise<TimetableContext> {
  const cls = await classes(db, term.id);
  const versions = await rows<{ classId: number; id: number; effectiveFrom: string; sessions: number }>(
    db,
    sql`SELECT v.class_group_id AS "classId", v.id, to_char(v.effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
               (SELECT count(*)::int FROM class_session cs JOIN timetable_slot ts ON ts.id = cs.slot_id WHERE ts.version_id = v.id) AS sessions
        FROM timetable_version v JOIN class_group cg ON cg.id = v.class_group_id WHERE cg.term_id = ${term.id}`,
  );
  const sessions = await rows<{ classId: number; from: number; ever: number }>(
    db,
    sql`SELECT o.class_group_id AS "classId", count(*) FILTER (WHERE cs.date >= ${effectiveFrom}::date)::int AS "from", count(*)::int AS ever
        FROM class_session cs JOIN course_offering o ON o.id = cs.offering_id JOIN class_group cg ON cg.id = o.class_group_id
        WHERE cg.term_id = ${term.id} GROUP BY o.class_group_id`,
  );
  const offerings = await rows<{ classId: number; offeringId: number; courseId: number }>(
    db,
    sql`SELECT o.class_group_id AS "classId", o.id AS "offeringId", o.course_id AS "courseId" FROM course_offering o JOIN class_group cg ON cg.id = o.class_group_id WHERE cg.term_id = ${term.id}`,
  );
  // Teachers' periods in each class's timetable in force on the start date.
  const busy = await rows<TimetableContext["busy"][number]>(
    db,
    sql`WITH active AS (
          SELECT DISTINCT ON (v.class_group_id) v.id, v.class_group_id FROM timetable_version v
          JOIN class_group cg ON cg.id = v.class_group_id
          WHERE cg.term_id = ${term.id} AND v.effective_from <= ${effectiveFrom}::date
          ORDER BY v.class_group_id, v.effective_from DESC)
        SELECT a.class_group_id AS "classId", d.code || ' Sem ' || cg.semester AS label, ts.weekday, ts.start_period AS "startPeriod", ts.end_period AS "endPeriod",
               ta.staff_id AS "staffId", c.short_name AS subject
        FROM active a JOIN timetable_slot ts ON ts.version_id = a.id
        JOIN teaching_assignment ta ON ta.offering_id = ts.offering_id AND ta.component = ts.component AND ta.batch_scope IN ('ALL', ts.batch_scope)
        JOIN course_offering o ON o.id = ts.offering_id JOIN course c ON c.id = o.course_id
        JOIN class_group cg ON cg.id = a.class_group_id JOIN department d ON d.id = cg.department_id`,
  );
  return {
    effectiveFrom,
    today,
    term: { startsOn: term.startsOn, endsOn: term.endsOn },
    periods: (await rows<{ ordinal: number }>(db, sql`SELECT ordinal FROM period ORDER BY ordinal`)).map((p) => p.ordinal),
    departments: await departments(db),
    classes: cls.map((c) => ({
      ...c,
      versions: versions.filter((v) => v.classId === c.id).map(({ classId: _c, ...v }) => v),
      sessionsFrom: sessions.find((s) => s.classId === c.id)?.from ?? 0,
      sessionsEver: sessions.find((s) => s.classId === c.id)?.ever ?? 0,
      offerings: offerings.filter((o) => o.classId === c.id).map(({ classId: _c, ...o }) => o),
    })),
    courses: await rows(db, sql`SELECT id, department_id AS "departmentId", semester, code, short_name AS "shortName", kind::text AS kind FROM course WHERE active`),
    staff: await rows(db, sql`SELECT id, name, phone, active FROM staff`),
    assignments: await rows(
      db,
      sql`SELECT ta.offering_id AS "offeringId", ta.component::text AS component, ta.batch_scope::text AS "batchScope", ta.staff_id AS "staffId"
          FROM teaching_assignment ta JOIN course_offering o ON o.id = ta.offering_id JOIN class_group cg ON cg.id = o.class_group_id WHERE cg.term_id = ${term.id}`,
    ),
    busy,
  };
}
