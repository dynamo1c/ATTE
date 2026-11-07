import { describe, expect, it } from "vitest";
import type { ReadRow } from "@/lib/sheet-read";
import { dateCell, readColumns } from "./columns";
import { planStaff, type StaffContext } from "./staff";
import { matchScheme, planSubjects, type SubjectContext } from "./subjects";
import { planStudents, type StudentContext } from "./students";
import { planTimetable, type TimetableContext } from "./timetable";

/** Rows as in a sheet: first array is the header, line numbers from 1. */
const sheet = (...rows: string[][]): ReadRow[] => rows.map((cells, i) => ({ line: i + 1, cells }));
const messages = (issues: { message: string }[]) => issues.map((i) => i.message).join("\n");

const departments = [
  { id: 1, code: "CS" },
  { id: 2, code: "ME" },
];

describe("readColumns", () => {
  const cols = [
    { key: "a", label: "Register no", aliases: ["Reg no"], required: true, help: "", example: "" },
    { key: "b", label: "Name", required: true, help: "", example: "" },
  ] as const;

  it("finds the heading row under a title, matching headings loosely", () => {
    const r = readColumns(sheet(["Students of CS"], ["reg. NO.", " name ", "Remarks"], ["204CS25001", "Ravi"]), cols);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.line, x.get("a"), x.get("b")])).toEqual([[3, "204CS25001", "Ravi"]]);
    expect(messages(r.warnings)).toContain("“Remarks” is not used");
  });

  it("reports missing and repeated columns, and files with no rows", () => {
    expect(messages(readColumns(sheet(["Name", "Reg no", "Name"]), cols).errors)).toContain("“Name” appears twice");
    expect(messages(readColumns(sheet(["Hello", "World"]), cols).errors)).toContain("No heading row");
    expect(messages(readColumns(sheet(["Reg no", "Name"]), cols).errors)).toContain("no rows");
  });
});

describe("dateCell", () => {
  it("reads Indian day-first dates, ISO dates and Excel serials", () => {
    expect(dateCell("14/05/2008", "D")).toEqual({ ok: true, value: "2008-05-14" });
    expect(dateCell("5-6-2008", "D")).toEqual({ ok: true, value: "2008-06-05" });
    expect(dateCell("2008-05-14", "D")).toEqual({ ok: true, value: "2008-05-14" });
    expect(dateCell("39582", "D")).toEqual({ ok: true, value: "2008-05-14" });
    expect(dateCell("14-May-2008", "D")).toEqual({ ok: true, value: "2008-05-14" });
    expect(dateCell("5 June 2008", "D")).toEqual({ ok: true, value: "2008-06-05" });
  });
  it("refuses impossible dates and US order", () => {
    expect(dateCell("31/02/2008", "D").ok).toBe(false);
    expect(dateCell("05/14/2008", "D").ok).toBe(false);
    expect(dateCell("May 14", "D").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("planStaff", () => {
  const ctx: StaffContext = {
    departments,
    classes: [{ id: 10, departmentId: 1, departmentCode: "CS", semester: 3, classTeachers: [] }],
    staff: [{ id: 5, name: "Old Name", phone: "+919845000005", email: null, departmentId: 1, designation: "Lecturer", active: true, grants: [{ role: "FACULTY", departmentId: 1, classGroupId: null }] }],
  };
  const head = ["Name", "Mobile", "Department", "Designation", "Roles", "Class teacher of"];

  it("creates new people as faculty, updates filled cells only, and adds roles", () => {
    const plan = planStaff(sheet(head, ["Asha K", "98450 00001", "cs", "", "", ""], ["New Name", "+91 98450 00005", "", "", "HOD", "3"]), ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.ops[0]).toMatchObject({ kind: "create", values: { name: "Asha K", phone: "+919845000001", departmentId: 1 }, grants: [{ role: "FACULTY", departmentId: 1 }] });
    expect(plan.ops[1]).toMatchObject({ kind: "update", id: 5, set: { name: "New Name" }, grants: [{ role: "HOD", departmentId: 1 }, { role: "CLASS_TEACHER", classGroupId: 10 }] });
    expect(plan.ops[1].kind === "update" && plan.ops[1].set).not.toHaveProperty("designation");
  });

  it("reports unchanged rows as the same and does nothing for them", () => {
    const plan = planStaff(sheet(head, ["Old Name", "9845000005", "CS", "Lecturer", "Faculty", ""]), ctx);
    expect(plan.items[0].action).toBe("same");
    expect(plan.ops).toEqual([]);
  });

  it("lists every problem in a row and duplicate mobiles", () => {
    const plan = planStaff(sheet(head, ["", "12345", "XX", "", "Boss", "9"], ["A", "9845000001", "", "", "", ""], ["B", "98450-00001", "", "", "HOD", ""]), ctx);
    const text = messages(plan.errors);
    expect(text).toContain("Name is empty");
    expect(text).toContain("Mobile:");
    expect(text).toContain("Department “XX”");
    expect(text).toContain("Role “Boss”");
    expect(text).toContain("Class teacher of “9”");
    expect(text).toContain("HOD needs a department");
    expect(text).toContain("Mobile 9845000001 is also on row 3");
  });

  it("warns before making someone an admin", () => {
    expect(messages(planStaff(sheet(head, ["Raj", "9845000009", "", "", "Admin", ""]), ctx).warnings)).toContain("Admin");
  });
});

// ---------------------------------------------------------------------------

describe("planSubjects", () => {
  const schemes = [
    { id: 1, name: "Main subject, theory final exam" },
    { id: 2, name: "Main subject, practical final exam" },
    { id: 3, name: "Minor subject (English / Kannada / EVS), no final" },
  ];
  const ctx: SubjectContext = {
    departments,
    schemes,
    courses: [{ id: 7, code: "20CS31P", departmentId: 1, semester: 3, shortName: "DSP", name: "DSP", kind: "INTEGRATED", schemeId: 1 }],
    classes: [{ id: 10, departmentId: 1, semester: 3, courseIds: [] }],
  };
  const head = ["Department", "Semester", "Subject code", "Short name", "Full name", "Type", "Marks scheme"];

  it("matches schemes by name or by distinctive words", () => {
    expect(matchScheme("Minor", schemes)).toMatchObject({ id: 3 });
    expect(matchScheme("practical final", schemes)).toMatchObject({ id: 2 });
    expect(matchScheme("main subject", schemes)).toBe("many");
    expect(matchScheme("nothing", schemes)).toBeNull();
  });

  it("creates new subjects, renames existing ones and gives them to this term's class", () => {
    const plan = planSubjects(sheet(head, ["CS", "3", "20cs32p", "CN", "Computer Networks", "Integrated", "Practical final"], ["CS", "3", "20CS31P", "DSP", "Data Structures with Python", "Integrated", "Theory"]), ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.ops[0]).toMatchObject({ kind: "create", values: { code: "20CS32P", schemeId: 2, kind: "INTEGRATED" }, offerTo: 10 });
    expect(plan.ops[1]).toMatchObject({ kind: "update", id: 7, set: { name: "Data Structures with Python" }, offerTo: 10 });
  });

  it("refuses changes to protected fields and repeated codes / short names", () => {
    const plan = planSubjects(
      sheet(head, ["CS", "3", "20CS31P", "DSP", "DSP", "Theory only", "Minor"], ["CS", "3", "X1", "DSP", "x", "Integrated", "Theory"], ["ME", "1", "M1", "M", "m", "Lab", "Practical"], ["ME", "1", "M1", "N", "n", "Lab", "Practical"]),
      ctx,
    );
    const text = messages(plan.errors);
    expect(text).toContain("20CS31P already exists with a different type");
    expect(text).toContain("CS Sem 3 already has a subject called DSP");
    expect(text).toContain("Subject ME M1 is also on row 4");
  });

  it("allows the same official code once per department (shared subjects like Maths)", () => {
    const plan = planSubjects(sheet(head, ["CS", "3", "25SC11I", "MATHS", "Engineering Mathematics-I", "Integrated", "Theory"], ["ME", "3", "25SC11I", "MATHS", "Engineering Mathematics-I", "Integrated", "Theory"]), ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.ops.map((o) => o.kind)).toEqual(["create", "create"]);
  });
});

// ---------------------------------------------------------------------------

describe("planStudents", () => {
  const ctx: StudentContext = {
    collegeCode: "204",
    departments,
    classes: [
      { id: 10, departmentId: 1, departmentCode: "CS", semester: 3 },
      { id: 11, departmentId: 1, departmentCode: "CS", semester: 5 },
    ],
    students: [
      {
        id: 50,
        regNo: "204CS25001",
        name: "Ravi",
        gender: "MALE",
        dateOfBirth: null,
        lateralEntry: false,
        status: "ACTIVE",
        membership: { classGroupId: 10, batch: "B1" },
        contacts: [{ id: 900, phone: "+919845000100", name: null, relation: "FATHER", language: "BOTH", whatsappOk: true, consentAt: null, optedOutAt: null }],
      },
      { id: 51, regNo: "204CS24001", name: "Kiran", gender: null, dateOfBirth: null, lateralEntry: false, status: "ACTIVE", membership: null, contacts: [] },
    ],
  };
  const head = ["Register no", "Name", "Semester", "Batch", "Date of birth", "Parent 1 relation", "Parent 1 mobile", "Parent 1 language", "Parent 2 relation", "Parent 2 mobile", "Consent"];

  it("creates a student in the class with parents and consent", () => {
    const plan = planStudents(sheet(head, ["204 cs 25 002", "Asha", "3", "2", "14/05/2008", "Mother", "9845000200", "Kannada", "Father", "9845000201", "Signed admission form"]), ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.ops[0]).toMatchObject({
      studentId: null,
      create: { regNo: "204CS25002", departmentId: 1, admissionYear: 2025, dateOfBirth: "2008-05-14" },
      join: { classGroupId: 10, batch: "B2" },
      addContacts: [{ phone: "+919845000200", relation: "MOTHER", language: "KN" }, { phone: "+919845000201", relation: "FATHER", language: "BOTH" }],
      consent: "Signed admission form",
    });
  });

  it("updates an existing student, adds a number and records consent for a saved one", () => {
    const plan = planStudents(sheet(head, ["204CS25001", "Ravi Kumar", "3", "B1", "", "Father", "9845000100", "", "Mother", "9845000101", "Signed form"]), ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.ops[0]).toMatchObject({ studentId: 50, update: { set: { name: "Ravi Kumar" } }, join: null, addContacts: [{ phone: "+919845000101" }], consentContactIds: [900] });
  });

  it("puts an existing student with no class this term into the class (next term's list)", () => {
    const plan = planStudents(sheet(head, ["204CS24001", "Kiran", "5", "B1", "", "Father", "9845000300", "", "", "", ""]), ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.ops[0]).toMatchObject({ studentId: 51, join: { classGroupId: 11, batch: "B1" } });
    expect(messages(plan.warnings)).toContain("no consent");
  });

  it("refuses moving class or batch, bad register numbers, missing parents and duplicates", () => {
    const plan = planStudents(
      sheet(
        head,
        ["204CS25001", "Ravi", "5", "B1", "", "Father", "9845000100", "", "", "", ""],
        ["204CS25001", "Ravi", "3", "B2", "", "Father", "9845000100", "", "", "", ""],
        ["205CS25009", "X", "3", "B1", "", "Father", "9845000400", "", "", "", ""],
        ["204CS25010", "Y", "3", "B1", "", "", "", "", "", "", ""],
        ["204CS25011", "Z", "3", "B1", "", "Father", "9845000500", "", "Mother", "9845000500", ""],
        ["204CS25011", "Z", "3", "B3", "31/02/2008", "Uncle", "9845000500", "", "", "", ""],
      ),
      ctx,
    );
    const text = messages(plan.errors);
    expect(text).toContain("already in CS Sem 3 this term");
    expect(text).toContain("is in B1, the file says B2");
    expect(text).toContain("College code must be 204");
    expect(text).toContain("No parent mobile");
    expect(text).toContain("same as Parent 1");
    expect(text).toContain("Batch “B3”");
    expect(text).toContain("not a real date");
    expect(text).toContain("relation “Uncle”");
    expect(text).toContain("Register number 204CS25011 is also on row 6");
    expect(text).toContain("Register number 204CS25001 is also on row 2");
  });
});

// ---------------------------------------------------------------------------

describe("planTimetable", () => {
  const base: TimetableContext = {
    effectiveFrom: "2026-08-17",
    today: "2026-08-10",
    term: { startsOn: "2026-08-17", endsOn: "2026-12-31" },
    periods: [1, 2, 3, 4, 5, 6, 7],
    departments,
    classes: [
      { id: 10, departmentId: 1, departmentCode: "CS", semester: 3, versions: [], sessionsFrom: 0, sessionsEver: 0, offerings: [{ offeringId: 100, courseId: 7 }] },
      { id: 11, departmentId: 1, departmentCode: "CS", semester: 5, versions: [], sessionsFrom: 0, sessionsEver: 0, offerings: [] },
    ],
    courses: [
      { id: 7, departmentId: 1, semester: 3, code: "20CS31P", shortName: "DSP", kind: "INTEGRATED" },
      { id: 8, departmentId: 1, semester: 3, code: "20KA31T", shortName: "KANNADA", kind: "THEORY_ONLY" },
      { id: 9, departmentId: 1, semester: 5, code: "20CS51P", shortName: "CC", kind: "INTEGRATED" },
    ],
    staff: [
      { id: 1, name: "Asha", phone: "+919845000001", active: true },
      { id: 2, name: "Bala", phone: "+919845000002", active: true },
    ],
    assignments: [{ offeringId: 100, component: "THEORY", batchScope: "ALL", staffId: 2 }],
    busy: [],
  };
  const head = ["Department", "Semester", "Day", "From period", "To period", "Subject", "Part", "Batch", "Teacher mobile"];

  it("builds a class timetable, offering new subjects and assigning teachers", () => {
    const plan = planTimetable(
      sheet(head, ["CS", "3", "Mon", "1", "", "dsp", "Theory", "", ""], ["CS", "3", "Mon", "2", "4", "DSP", "Lab", "B1", "9845000001"], ["CS", "3", "Mon", "2", "4", "Kannada", "", "B2", "9845000002"], ["CS", "3", "Tue", "5", "", "Activity", "", "", ""]),
      base,
    );
    expect(messages(plan.errors)).toBe("");
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({ classId: 10, replaceVersionId: null, offerCourseIds: [8], assign: [{ courseId: 7, component: "PRACTICAL", batchScope: "B1", staffId: 1 }, { courseId: 8, component: "THEORY", batchScope: "B2", staffId: 2 }] });
    expect(plan.ops[0].slots.map((s) => [s.weekday, s.startPeriod, s.endPeriod, s.kind, s.component, s.batchScope])).toEqual([
      [1, 1, 1, "CLASS", "THEORY", "ALL"],
      [1, 2, 4, "CLASS", "PRACTICAL", "B1"],
      [1, 2, 4, "CLASS", "THEORY", "B2"],
      [2, 5, 5, "ACTIVITY", null, "ALL"],
    ]);
  });

  it("refuses student clashes, unknown subjects and missing parts", () => {
    const plan = planTimetable(sheet(head, ["CS", "3", "Mon", "1", "2", "DSP", "Theory", "", ""], ["CS", "3", "Mon", "2", "", "DSP", "Lab", "B1", ""], ["CS", "3", "Fri", "1", "", "MATHS", "", "", ""], ["CS", "3", "Fri", "2", "", "DSP", "", "", ""], ["CS", "3", "Sun", "9", "", "DSP", "Theory", "", ""]), base);
    const text = messages(plan.errors);
    expect(text).toContain("clashes with row 2");
    expect(text).toContain("“MATHS” is not a CS Sem 3 subject");
    expect(text).toContain("Theory or Lab");
    expect(text).toContain("Day “Sun”");
    expect(text).toContain("From period must be a number from 1 to 7");
  });

  it("refuses a teacher in two classes at once, in the file or against other classes", () => {
    const inFile = planTimetable(sheet(head, ["CS", "3", "Wed", "1", "", "DSP", "Theory", "", ""], ["CS", "5", "Wed", "1", "", "CC", "Theory", "", "9845000002"]), base);
    expect(messages(inFile.errors)).toContain("Bala would teach CC to CS Sem 5 and DSP to CS Sem 3 (row 2)");
    const other = planTimetable(sheet(head, ["CS", "3", "Wed", "1", "", "DSP", "Theory", "", ""]), { ...base, busy: [{ classId: 99, label: "ME Sem 1", weekday: 3, startPeriod: 1, endPeriod: 2, staffId: 2, subject: "MATHS" }] });
    expect(messages(other.errors)).toContain("Bala would teach DSP to CS Sem 3 and MATHS to ME Sem 1 at the same time");
  });

  it("keeps recorded classes' timetable: replace only unused versions, new ones start tomorrow", () => {
    const row = ["CS", "3", "Mon", "1", "", "DSP", "Theory", "", ""];
    const used = { ...base.classes[0], versions: [{ id: 3, effectiveFrom: "2026-08-17", sessions: 40 }], sessionsFrom: 40, sessionsEver: 40 };
    expect(messages(planTimetable(sheet(head, row), { ...base, classes: [used] }).errors)).toContain("already has 40 classes recorded");
    const unused = { ...base.classes[0], versions: [{ id: 3, effectiveFrom: "2026-08-17", sessions: 0 }] };
    expect(planTimetable(sheet(head, row), { ...base, classes: [unused] }).ops[0].replaceVersionId).toBe(3);
    const started = { ...base.classes[0], versions: [{ id: 3, effectiveFrom: "2026-08-17", sessions: 40 }], sessionsFrom: 0, sessionsEver: 40 };
    expect(messages(planTimetable(sheet(head, row), { ...base, effectiveFrom: "2026-09-01", today: "2026-09-01", classes: [started] }).errors)).toContain("tomorrow (2026-09-02)");
    expect(planTimetable(sheet(head, row), { ...base, effectiveFrom: "2026-09-02", today: "2026-09-01", classes: [started] }).errors).toEqual([]);
  });

  it("warns about periods with no teacher", () => {
    expect(messages(planTimetable(sheet(head, ["CS", "3", "Mon", "1", "", "DSP", "Lab", "B2", ""]), base).warnings)).toContain("no teacher for DSP lab B2");
  });
});
