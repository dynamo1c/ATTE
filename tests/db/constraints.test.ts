/**
 * Proves the database itself rejects bad data, independent of app code.
 * Needs a migrated + seeded database (npm run db:reset). Everything runs inside one
 * transaction that is rolled back, so the data is never changed.
 */
import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
const client = url ? new Client({ connectionString: url }) : null;
let seeded = false;

beforeAll(async () => {
  if (!client) return;
  await client.connect();
  const r = await client.query("SELECT to_regclass('public.college_settings') IS NOT NULL AS ok");
  seeded = r.rows[0].ok && (await client.query("SELECT 1 FROM college_settings")).rowCount === 1;
  await client.query("BEGIN");
});

afterAll(async () => {
  if (!client) return;
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
});

async function one<T = Record<string, unknown>>(query: string): Promise<T> {
  const r = await client!.query(query);
  if (r.rowCount === 0) throw new Error(`No row for: ${query}`);
  return r.rows[0] as T;
}

/** Runs a statement in a savepoint and returns the Postgres error code (or null if it succeeded). */
async function errorCode(query: string, params: unknown[] = []): Promise<string | null> {
  await client!.query("SAVEPOINT t");
  try {
    await client!.query(query, params);
    await client!.query("RELEASE SAVEPOINT t");
    return null;
  } catch (e) {
    await client!.query("ROLLBACK TO SAVEPOINT t");
    return (e as { code?: string }).code ?? "unknown";
  }
}

const UNIQUE = "23505";
const CHECK = "23514";
const FK = "23503";

describe.skipIf(!url)("database constraints", () => {
  it("has seeded data to test against", () => {
    expect(seeded, "run `npm run db:reset` first").toBe(true);
  });

  it("rejects a second attendance mark for the same student and session", async () => {
    const r = await one<{ session_id: number; student_id: number; marked_by: number }>("SELECT session_id, student_id, marked_by FROM attendance_record LIMIT 1");
    expect(await errorCode("INSERT INTO attendance_record (session_id, student_id, status, marked_by) VALUES ($1, $2, 'PRESENT', $3)", [r.session_id, r.student_id, r.marked_by])).toBe(UNIQUE);
  });

  it("rejects malformed register numbers", async () => {
    const d = await one<{ id: number }>("SELECT id FROM department LIMIT 1");
    for (const reg of ["204CS2501", "204cs25012", "2O4CS25012"]) {
      expect(await errorCode("INSERT INTO student (reg_no, name, department_id, admission_year) VALUES ($1, 'X', $2, 2025)", [reg, d.id])).toBe(CHECK);
    }
  });

  it("rejects duplicate register numbers", async () => {
    const s = await one<{ reg_no: string; department_id: number }>("SELECT reg_no, department_id FROM student LIMIT 1");
    expect(await errorCode("INSERT INTO student (reg_no, name, department_id, admission_year) VALUES ($1, 'X', $2, 2025)", [s.reg_no, s.department_id])).toBe(UNIQUE);
  });

  it("rejects non-normalised phone numbers", async () => {
    const s = await one<{ id: number }>("SELECT id FROM student LIMIT 1");
    for (const phone of ["9845012345", "+915845012345", "+91984501234"]) {
      expect(await errorCode("INSERT INTO parent_contact (student_id, relation, phone) VALUES ($1, 'FATHER', $2)", [s.id, phone])).toBe(CHECK);
    }
  });

  it("rejects role grants with the wrong scope", async () => {
    const st = await one<{ id: number }>("SELECT id FROM staff LIMIT 1");
    const cg = await one<{ id: number }>("SELECT id FROM class_group LIMIT 1");
    expect(await errorCode("INSERT INTO role_grant (staff_id, role) VALUES ($1, 'HOD')", [st.id])).toBe(CHECK);
    expect(await errorCode("INSERT INTO role_grant (staff_id, role) VALUES ($1, 'CLASS_TEACHER')", [st.id])).toBe(CHECK);
    expect(await errorCode("INSERT INTO role_grant (staff_id, role, class_group_id) VALUES ($1, 'ADMIN', $2)", [st.id, cg.id])).toBe(CHECK);
  });

  it("allows only one class per student per term", async () => {
    const m = await one<{ student_id: number; term_id: number; class_group_id: number }>("SELECT student_id, term_id, class_group_id FROM class_membership LIMIT 1");
    const other = await one<{ id: number }>(`SELECT id FROM class_group WHERE term_id = ${m.term_id} AND id <> ${m.class_group_id} LIMIT 1`);
    expect(await errorCode("INSERT INTO class_membership (student_id, class_group_id, term_id, joined_on) VALUES ($1, $2, $3, '2026-09-01')", [m.student_id, other.id, m.term_id])).toBe(UNIQUE);
  });

  it("rejects a membership whose term does not match its class", async () => {
    const s = await one<{ id: number }>("SELECT id FROM student LIMIT 1");
    const cg = await one<{ id: number; term_id: number }>("SELECT id, term_id FROM class_group LIMIT 1");
    expect(await errorCode("INSERT INTO class_membership (student_id, class_group_id, term_id, joined_on) VALUES ($1, $2, $3, '2026-09-01')", [s.id, cg.id, cg.term_id + 999])).toBe(FK);
  });

  it("rejects marks above max, negative marks, and value+flag together", async () => {
    const a = await one<{ id: number; max_marks: string }>("SELECT id, max_marks FROM assessment WHERE NOT EXISTS (SELECT 1 FROM mark WHERE assessment_id = assessment.id) LIMIT 1");
    const s = await one<{ id: number }>("SELECT id FROM student LIMIT 1");
    const st = await one<{ id: number }>("SELECT id FROM staff LIMIT 1");
    const insert = "INSERT INTO mark (assessment_id, max_marks, student_id, value, flag, entered_by) VALUES ($1, $2, $3, $4, $5, $6)";
    expect(await errorCode(insert, [a.id, a.max_marks, s.id, Number(a.max_marks) + 1, null, st.id])).toBe(CHECK);
    expect(await errorCode(insert, [a.id, a.max_marks, s.id, -1, null, st.id])).toBe(CHECK);
    expect(await errorCode(insert, [a.id, a.max_marks, s.id, 10, "AB", st.id])).toBe(CHECK);
    expect(await errorCode(insert, [a.id, a.max_marks, s.id, null, null, st.id])).toBe(CHECK);
    // max_marks must match the assessment's own max (composite FK) — no sneaking past the range check.
    expect(await errorCode(insert, [a.id, Number(a.max_marks) * 10, s.id, Number(a.max_marks) + 1, null, st.id])).toBe(FK);
    expect(await errorCode(insert, [a.id, a.max_marks, s.id, null, "AB", st.id])).toBeNull();
  });

  it("rejects a HELD session with no marker", async () => {
    const o = await one<{ id: number }>("SELECT id FROM course_offering LIMIT 1");
    expect(await errorCode("INSERT INTO class_session (offering_id, component, batch_scope, date, start_period, end_period, source, status) VALUES ($1, 'THEORY', 'ALL', '2026-11-02', 1, 1, 'EXTRA', 'HELD')", [o.id])).toBe(CHECK);
  });

  it("rejects generating the same timetable session twice", async () => {
    const cs = await one<{ offering_id: number; slot_id: number; date: string }>("SELECT offering_id, slot_id, to_char(date, 'YYYY-MM-DD') AS date FROM class_session WHERE slot_id IS NOT NULL LIMIT 1");
    expect(await errorCode("INSERT INTO class_session (offering_id, component, batch_scope, date, start_period, end_period, source, slot_id) VALUES ($1, 'THEORY', 'ALL', $2, 1, 1, 'TIMETABLE', $3)", [cs.offering_id, cs.date, cs.slot_id])).toBe(UNIQUE);
  });

  it("rejects class slots without a subject and activity slots with one", async () => {
    const v = await one<{ id: number }>("SELECT id FROM timetable_version LIMIT 1");
    const o = await one<{ id: number }>("SELECT id FROM course_offering LIMIT 1");
    expect(await errorCode("INSERT INTO timetable_slot (version_id, weekday, start_period, end_period, kind) VALUES ($1, 1, 1, 1, 'CLASS')", [v.id])).toBe(CHECK);
    expect(await errorCode("INSERT INTO timetable_slot (version_id, weekday, start_period, end_period, kind, offering_id, component) VALUES ($1, 1, 1, 1, 'ACTIVITY', $2, 'THEORY')", [v.id, o.id])).toBe(CHECK);
    expect(await errorCode("INSERT INTO timetable_slot (version_id, weekday, start_period, end_period, kind) VALUES ($1, 1, 3, 2, 'ACTIVITY')", [v.id])).toBe(CHECK);
  });

  it("keeps college settings a single row with sane thresholds", async () => {
    expect(await errorCode("INSERT INTO college_settings (id, college_code, name) VALUES (2, '204', 'X')")).toBe(CHECK);
    expect(await errorCode("UPDATE college_settings SET attendance_min_pct = 80, attendance_warn_pct = 70")).toBe(CHECK);
    expect(await errorCode("UPDATE college_settings SET attendance_min_pct = 101")).toBe(CHECK);
  });

  it("rejects leave with end before start, and approved leave without approver", async () => {
    const s = await one<{ id: number }>("SELECT id FROM student LIMIT 1");
    const st = await one<{ id: number }>("SELECT id FROM staff LIMIT 1");
    expect(await errorCode("INSERT INTO leave_notice (student_id, type, from_date, to_date, created_by) VALUES ($1, 'MEDICAL', '2026-10-10', '2026-10-09', $2)", [s.id, st.id])).toBe(CHECK);
    expect(await errorCode("INSERT INTO leave_notice (student_id, type, from_date, to_date, created_by, status) VALUES ($1, 'MEDICAL', '2026-10-10', '2026-10-10', $2, 'APPROVED')", [s.id, st.id])).toBe(CHECK);
  });

  it("staff leave: no overlapping open leave, half days split the day, nobody decides their own", async () => {
    const st = await one<{ id: number }>("SELECT id FROM staff s WHERE NOT EXISTS (SELECT 1 FROM staff_leave l WHERE l.staff_id = s.id) LIMIT 1");
    const ins = (from: string, to: string, part = "FULL", status = "PENDING") =>
      errorCode("INSERT INTO staff_leave (staff_id, type, from_date, to_date, part, reason, status) VALUES ($1, 'CASUAL', $2, $3, $4, 'x', $5)", [st.id, from, to, part, status]);
    expect(await ins("2027-01-11", "2027-01-12")).toBeNull();
    expect(await ins("2027-01-12", "2027-01-13")).toBe("23P01"); // overlaps the open leave
    expect(await ins("2027-01-14", "2027-01-14", "FN")).toBeNull();
    expect(await ins("2027-01-14", "2027-01-14", "AN")).toBeNull(); // the other half of the same day
    expect(await ins("2027-01-14", "2027-01-14", "FN")).toBe("23P01");
    expect(await ins("2027-01-15", "2027-01-16", "FN")).toBe(CHECK); // half day over two dates
    expect(await ins("2027-01-12", "2027-01-12", "FULL", "CANCELLED")).toBeNull(); // cancelled leave never blocks
    expect(await ins("2027-01-20", "2027-01-20", "FULL", "APPROVED")).toBe(CHECK); // approved needs who decided
    expect(
      await errorCode("INSERT INTO staff_leave (staff_id, type, from_date, to_date, reason, status, decided_by, decided_at) VALUES ($1, 'CASUAL', '2027-02-01', '2027-02-01', 'x', 'APPROVED', $1, now())", [st.id]),
    ).toBe(CHECK);
    expect(await errorCode("INSERT INTO staff_leave (staff_id, type, from_date, to_date, reason) VALUES ($1, 'CASUAL', '2027-02-02', '2027-02-02', '  ')", [st.id])).toBe(CHECK);
  });

  it("allows one subject per code per department (shared codes across departments)", async () => {
    const c = await one<{ department_id: number; code: string; scheme_id: number }>("SELECT department_id, code, scheme_id FROM course WHERE code = '25SC11I' LIMIT 1");
    const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM course WHERE code = '25SC11I'");
    expect(n.n).toBeGreaterThan(1);
    expect(await errorCode("INSERT INTO course (department_id, semester, code, short_name, name, kind, scheme_id) VALUES ($1, 1, $2, 'M2', 'x', 'INTEGRATED', $3)", [c.department_id, c.code, c.scheme_id])).toBe(UNIQUE);
  });

  it("office is a college-wide role; college updates have one audience", async () => {
    const st = await one<{ id: number; department_id: number }>("SELECT s.id, d.id AS department_id FROM staff s CROSS JOIN department d LIMIT 1");
    expect(await errorCode("INSERT INTO role_grant (staff_id, role, department_id) VALUES ($1, 'OFFICE', $2)", [st.id, st.department_id])).toBe(CHECK);
    const cg = await one<{ id: number }>("SELECT id FROM class_group LIMIT 1");
    expect(await errorCode("INSERT INTO college_update (title, body_en, department_id, class_group_id, published_by) VALUES ('t', 'b', $2, $3, $1)", [st.id, st.department_id, cg.id])).toBe(CHECK);
    expect(await errorCode("INSERT INTO college_update (title, body_en, published_by) VALUES (' ', 'b', $1)", [st.id])).toBe(CHECK);
  });

  it("keeps the audit log append-only", async () => {
    expect(await errorCode("UPDATE audit_log SET action = 'X'")).toBe("42501");
    expect(await errorCode("DELETE FROM audit_log")).toBe("42501");
  });
});
