import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { IsoDate } from "@/lib/domain/dates";
import { todayIn } from "@/lib/domain/dates";
import { rollLabels } from "@/lib/domain/marking";
import { computeSubjectResult, parseFormula, type Formula, type MarkEntry, type MarkFlag, type SchemePart, type SubjectResult } from "@/lib/domain/marks";

export type AssessmentStatus = "DRAFT" | "SUBMITTED" | "PUBLISHED";

export interface PartRef extends SchemePart {
  schemeComponentId: number;
  component: "THEORY" | "PRACTICAL";
  /** Teachers of this part (theory or lab teachers of the subject). */
  assignedStaffIds: number[];
  assignedNames: string | null;
  assessment: { id: number; status: AssessmentStatus; heldOn: IsoDate | null; version: number; statusNote: string | null; marked: number } | null;
}

export interface OfferingMarksContext {
  offeringId: number;
  subject: string;
  subjectName: string;
  code: string;
  classRef: { id: number; departmentId: number };
  className: string;
  termId: number;
  schemeName: string;
  formula: Formula;
  parts: PartRef[];
}

/** One subject of one class: its marks scheme, the teachers of each part, and each part's assessment (if started). */
export async function getOfferingMarks(offeringId: number): Promise<OfferingMarksContext | null> {
  return (await listOfferingMarks(sql`o.id = ${offeringId}`))[0] ?? null;
}

/** Same as getOfferingMarks for many subjects at once (`where` filters course_offering o / class_group cg). */
export async function listOfferingMarks(where: SQL): Promise<OfferingMarksContext[]> {
  const { rows } = await getDb().execute<{
    offering_id: number;
    subject: string;
    subject_name: string;
    code: string;
    class_id: number;
    department_id: number;
    class_name: string;
    term_id: number;
    scheme_name: string;
    formula: unknown;
    parts: {
      schemeComponentId: number;
      code: string;
      label: string;
      component: "THEORY" | "PRACTICAL";
      isFinal: boolean;
      maxMarks: number;
      assignedStaffIds: number[] | null;
      assignedNames: string | null;
      assessment: PartRef["assessment"];
    }[];
  }>(sql`
    SELECT o.id AS offering_id, c.short_name AS subject, c.name AS subject_name, c.code, cg.id AS class_id, cg.department_id,
           d.code || ' Sem ' || cg.semester AS class_name, cg.term_id, sch.name AS scheme_name, sch.formula,
           (SELECT json_agg(json_build_object(
                'schemeComponentId', sc.id, 'code', sc.code, 'label', sc.label, 'component', sc.component, 'isFinal', sc.is_final, 'maxMarks', sc.max_marks,
                'assignedStaffIds', (SELECT json_agg(ta.staff_id) FROM teaching_assignment ta WHERE ta.offering_id = o.id AND ta.component = sc.component),
                'assignedNames', (SELECT string_agg(st.name, ', ') FROM teaching_assignment ta JOIN staff st ON st.id = ta.staff_id WHERE ta.offering_id = o.id AND ta.component = sc.component),
                'assessment', (SELECT json_build_object('id', a.id, 'status', a.status, 'heldOn', to_char(a.held_on, 'YYYY-MM-DD'), 'version', a.version, 'statusNote', a.status_note,
                                                        'marked', (SELECT count(*) FROM mark mk WHERE mk.assessment_id = a.id))
                               FROM assessment a WHERE a.offering_id = o.id AND a.scheme_component_id = sc.id))
              ORDER BY sc.ordinal)
              FROM scheme_component sc WHERE sc.scheme_id = c.scheme_id) AS parts
    FROM course_offering o
    JOIN course c ON c.id = o.course_id
    JOIN assessment_scheme sch ON sch.id = c.scheme_id
    JOIN class_group cg ON cg.id = o.class_group_id
    JOIN department d ON d.id = cg.department_id
    WHERE ${where}
    ORDER BY d.code, cg.semester, c.code`);
  return rows.map((r) => ({
    offeringId: r.offering_id,
    subject: r.subject,
    subjectName: r.subject_name,
    code: r.code,
    classRef: { id: r.class_id, departmentId: r.department_id },
    className: r.class_name,
    termId: r.term_id,
    schemeName: r.scheme_name,
    formula: parseFormula(r.formula),
    parts: (r.parts ?? []).map((p) => ({ ...p, maxMarks: Number(p.maxMarks), assignedStaffIds: p.assignedStaffIds ?? [] })),
  }));
}

export interface MarkRosterRow {
  studentId: number;
  regNo: string;
  name: string;
  roll: string;
  entry: MarkEntry | null;
  /** Left the class / no longer active: shown, but not required for "complete". */
  former: boolean;
}

/**
 * Who should have a mark for a test: members of the class on the test date (or today if no date yet),
 * plus anyone who already has a mark (an existing mark is never hidden).
 */
export async function getMarkRoster(assessmentId: number | null, classId: number, onDate: IsoDate | null): Promise<MarkRosterRow[]> {
  const day = onDate ?? todayIn();
  const { rows } = await getDb().execute<{ student_id: number; reg_no: string; name: string; value: number | null; flag: MarkFlag | null; has_mark: boolean; expected: boolean }>(sql`
    WITH expected AS (
      SELECT m.student_id FROM class_membership m JOIN student s ON s.id = m.student_id
      WHERE m.class_group_id = ${classId} AND m.joined_on <= ${day}::date AND (m.left_on IS NULL OR m.left_on >= ${day}::date)
        AND s.status IN ('ACTIVE', 'DETAINED')
    ),
    marked AS (SELECT student_id FROM mark WHERE assessment_id = ${assessmentId ?? -1})
    SELECT st.id AS student_id, st.reg_no, st.name, mk.value::float8 AS value, mk.flag::text AS flag, mk.student_id IS NOT NULL AS has_mark,
           st.id IN (SELECT student_id FROM expected) AS expected
    FROM student st
    LEFT JOIN mark mk ON mk.assessment_id = ${assessmentId ?? -1} AND mk.student_id = st.id
    WHERE st.id IN (SELECT student_id FROM expected UNION SELECT student_id FROM marked)
    ORDER BY st.reg_no`);
  const labels = rollLabels(rows.map((r) => ({ studentId: r.student_id, regNo: r.reg_no })));
  return rows.map((r) => ({
    studentId: r.student_id,
    regNo: r.reg_no,
    name: r.name,
    roll: labels.get(r.student_id)!,
    entry: r.has_mark ? (r.flag ? { value: null, flag: r.flag } : { value: Number(r.value), flag: null }) : null,
    former: !r.expected,
  }));
}

export interface ClassMarksSubject {
  offeringId: number;
  subject: string;
  subjectName: string;
  formula: Formula;
  parts: (SchemePart & { status: AssessmentStatus | null })[];
}

export interface ClassMarksStudent {
  studentId: number;
  regNo: string;
  name: string;
  roll: string;
  current: boolean;
  /** offeringId → entries by part code, and the computed result. */
  subjects: Map<number, { marks: Map<string, MarkEntry>; result: SubjectResult }>;
}

/**
 * Marks for a whole class (or some students). `publishedOnly` = what parents may see.
 * Staff views include drafts so teachers and the HOD see work in progress.
 */
export async function getClassMarks(classId: number, opts: { publishedOnly?: boolean; studentIds?: number[] } = {}) {
  const db = getDb();
  const onlyStudents = opts.studentIds ? (opts.studentIds.length ? sql`AND m.student_id IN (${sql.join(opts.studentIds.map((i) => sql`${i}`), sql`, `)})` : sql`AND false`) : sql``;
  const [subjectsRes, studentsRes, marksRes] = await Promise.all([
    db.execute<{ offering_id: number; subject: string; subject_name: string; formula: unknown; parts: { code: string; label: string; isFinal: boolean; maxMarks: number; status: AssessmentStatus | null }[] }>(sql`
      SELECT o.id AS offering_id, c.short_name AS subject, c.name AS subject_name, sch.formula,
             (SELECT json_agg(json_build_object('code', sc.code, 'label', sc.label, 'isFinal', sc.is_final, 'maxMarks', sc.max_marks,
                       'status', (SELECT a.status FROM assessment a WHERE a.offering_id = o.id AND a.scheme_component_id = sc.id)) ORDER BY sc.ordinal)
                FROM scheme_component sc WHERE sc.scheme_id = c.scheme_id) AS parts
      FROM course_offering o JOIN course c ON c.id = o.course_id JOIN assessment_scheme sch ON sch.id = c.scheme_id
      WHERE o.class_group_id = ${classId}
      ORDER BY c.code`),
    db.execute<{ student_id: number; reg_no: string; name: string; current: boolean }>(sql`
      SELECT s.id AS student_id, s.reg_no, s.name, (m.left_on IS NULL AND s.status IN ('ACTIVE', 'DETAINED')) AS current
      FROM class_membership m JOIN student s ON s.id = m.student_id
      WHERE m.class_group_id = ${classId} ${onlyStudents}
      ORDER BY s.reg_no`),
    db.execute<{ offering_id: number; code: string; student_id: number; value: number | null; flag: MarkFlag | null }>(sql`
      SELECT a.offering_id, sc.code, mk.student_id, mk.value::float8 AS value, mk.flag::text AS flag
      FROM mark mk
      JOIN assessment a ON a.id = mk.assessment_id
      JOIN scheme_component sc ON sc.id = a.scheme_component_id
      JOIN course_offering o ON o.id = a.offering_id
      WHERE o.class_group_id = ${classId}
        ${opts.publishedOnly ? sql`AND a.status = 'PUBLISHED'` : sql``}
        ${opts.studentIds ? (opts.studentIds.length ? sql`AND mk.student_id IN (${sql.join(opts.studentIds.map((i) => sql`${i}`), sql`, `)})` : sql`AND false`) : sql``}`),
  ]);

  const subjects: ClassMarksSubject[] = subjectsRes.rows.map((r) => ({
    offeringId: r.offering_id,
    subject: r.subject,
    subjectName: r.subject_name,
    formula: parseFormula(r.formula),
    parts: (r.parts ?? []).map((p) => ({ ...p, maxMarks: Number(p.maxMarks) })),
  }));
  const byStudent = new Map<number, Map<number, Map<string, MarkEntry>>>();
  for (const m of marksRes.rows) {
    let s = byStudent.get(m.student_id);
    if (!s) byStudent.set(m.student_id, (s = new Map()));
    let o = s.get(m.offering_id);
    if (!o) s.set(m.offering_id, (o = new Map()));
    o.set(m.code, m.flag ? { value: null, flag: m.flag } : { value: Number(m.value), flag: null });
  }
  const labels = rollLabels(studentsRes.rows.map((r) => ({ studentId: r.student_id, regNo: r.reg_no })));
  const students: ClassMarksStudent[] = studentsRes.rows.map((r) => ({
    studentId: r.student_id,
    regNo: r.reg_no,
    name: r.name,
    roll: labels.get(r.student_id)!,
    current: r.current,
    subjects: new Map(
      subjects.map((sub) => {
        const marks = byStudent.get(r.student_id)?.get(sub.offeringId) ?? new Map<string, MarkEntry>();
        return [sub.offeringId, { marks, result: computeSubjectResult(sub.parts, marks, sub.formula) }];
      }),
    ),
  }));
  return { subjects, students };
}

export const STATUS_LABEL: Record<AssessmentStatus, string> = { DRAFT: "Draft", SUBMITTED: "Waiting for HOD", PUBLISHED: "Published" };

/** The assessment row for a part, created on first use (safe if two people open it at once). */
export async function getOrCreateAssessment(offeringId: number, part: Pick<PartRef, "schemeComponentId" | "maxMarks">): Promise<number> {
  const db = getDb();
  await db.execute(sql`
    INSERT INTO assessment (offering_id, scheme_component_id, max_marks)
    VALUES (${offeringId}, ${part.schemeComponentId}, ${part.maxMarks})
    ON CONFLICT ON CONSTRAINT assessment_offering_component DO NOTHING`);
  const { rows } = await db.execute<{ id: number }>(sql`SELECT id FROM assessment WHERE offering_id = ${offeringId} AND scheme_component_id = ${part.schemeComponentId}`);
  return rows[0].id;
}

/** Find the part (and its assessment) for an assessment id. */
export async function getAssessmentContext(assessmentId: number) {
  const { rows } = await getDb().execute<{ offering_id: number; scheme_component_id: number }>(sql`SELECT offering_id, scheme_component_id FROM assessment WHERE id = ${assessmentId}`);
  if (!rows[0]) return null;
  const ctx = await getOfferingMarks(rows[0].offering_id);
  const part = ctx?.parts.find((p) => p.schemeComponentId === rows[0].scheme_component_id);
  if (!ctx || !part || !part.assessment) return null;
  return { ctx, part: part as PartRef & { assessment: NonNullable<PartRef["assessment"]> } };
}
