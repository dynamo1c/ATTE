import { describe, expect, it } from "vitest";
import {
  canAddStaff,
  canApproveForClass,
  canDecideStaffLeave,
  canGrantRole,
  canManageStaffMember,
  canPublishUpdateTo,
  canViewClassStatus,
  coverDepartmentIds,
  canEditCalendar,
  canEditLockedAttendance,
  canEnterMarks,
  canMarkSession,
  canManageClass,
  canManageClassStudents,
  canManageDepartment,
  canManageOutbox,
  canManageSettings,
  canPublishMarks,
  canViewClass,
  canViewCompliance,
  canViewMessages,
  navFor,
  canViewAudit,
  canImport,
  canPublishUpdates,
  canRecordLeave,
  leaveDecidedBy,
  seesWholeCollege,
  staffLeaveScope,
  visibleDepartmentIds,
  type Actor,
  type Grant,
} from "./permissions";

const actor = (grants: Grant[], teachingClassIds: number[] = []): Actor => ({ staffId: 1, grants, teachingClassIds });
const g = (role: Grant["role"], departmentId: number | null = null, classGroupId: number | null = null): Grant => ({ role, departmentId, classGroupId });

const admin = actor([g("ADMIN")]);
const principal = actor([g("PRINCIPAL")]);
const hodCs = actor([g("HOD", 2), g("FACULTY", 2)]);
const classTeacher = actor([g("FACULTY", 2), g("CLASS_TEACHER", null, 20)], [20, 21]);
const faculty = actor([g("FACULTY", 2)], [21]);
const office = actor([g("OFFICE")]);
const labels = (a: Actor) => navFor(a).map((n) => n.label);
const csSem3 = { id: 20, departmentId: 2 };
const csSem5 = { id: 21, departmentId: 2 };
const meSem3 = { id: 30, departmentId: 6 };

describe("permissions", () => {
  it("admin can do everything", () => {
    expect(canManageSettings(admin)).toBe(true);
    expect(canManageClass(admin, meSem3)).toBe(true);
    expect(canEditCalendar(admin, { kind: "COLLEGE" })).toBe(true);
    expect(visibleDepartmentIds(admin)).toBeNull();
  });

  it("principal sees everything and changes nothing in departments", () => {
    expect(canViewClass(principal, meSem3)).toBe(true);
    expect(canManageClass(principal, meSem3)).toBe(false);
    expect(canManageSettings(principal)).toBe(false);
    expect(canEditCalendar(principal, { kind: "COLLEGE" })).toBe(false);
    expect(labels(principal)).toContain("Settings");
  });

  it("principal is view-only: no approvals, no updates, no marking", () => {
    const p = { ...principal, staffId: 9 };
    expect(canPublishUpdates(p)).toBe(false);
    expect(canPublishUpdateTo(p, null)).toBe(false);
    expect(canApproveForClass(p, csSem3)).toBe(false);
    expect(canPublishMarks(p, csSem3)).toBe(false);
    expect(canManageOutbox(p)).toBe(false);
    expect(canAddStaff(p)).toBe(false);
    for (const applicant of [
      { staffId: 50, departmentId: 2, isHod: false, senior: false },
      { staffId: 51, departmentId: null, isHod: false, senior: false },
      { staffId: 52, departmentId: 2, isHod: true, senior: true },
    ]) expect(canDecideStaffLeave(p, applicant)).toBe(false);
    expect(labels(p)).not.toContain("Updates");
    expect(labels(p)).toContain("Staff leave");
  });

  it("office keeps the calendar, updates and student records, never attendance or marks", () => {
    expect(seesWholeCollege(office)).toBe(true);
    expect(canEditCalendar(office, { kind: "COLLEGE" })).toBe(true);
    expect(canPublishUpdates(office)).toBe(true);
    expect(canManageClassStudents(office, meSem3)).toBe(true);
    expect(canRecordLeave(office, meSem3)).toBe(false);
    expect(canManageClass(office, meSem3)).toBe(false);
    expect(canMarkSession(office, { classRef: csSem3, assignedStaffIds: [] })).toBe(false);
    expect(canPublishUpdateTo(office, null)).toBe(true);
    expect(canViewClass(office, csSem3)).toBe(true); // sees marks and attendance, read only
    expect(canEnterMarks(office, { classRef: csSem3, isFinal: false, assignedStaffIds: [] })).toBe(false);
    expect(canPublishMarks(office, csSem3)).toBe(false);
    expect(canViewAudit(office)).toBe(false);
    expect(canManageSettings(office)).toBe(false);
    const nav = labels(office);
    expect(nav).toContain("Updates");
    expect(nav).toContain("Students");
    expect(nav).not.toContain("Attendance");
    expect(nav).not.toContain("Settings");
    expect(nav).not.toContain("Audit log");
  });

  it("staff leave: teachers to their HOD, common pool to the admin, senior roles need no approval", () => {
    const teacherCs = { staffId: 50, departmentId: 2, isHod: false, senior: false };
    const poolTeacher = { staffId: 53, departmentId: null, isHod: false, senior: false };
    const hodApplicant = { staffId: 51, departmentId: 2, isHod: true, senior: true };
    const officeApplicant = { staffId: 52, departmentId: null, isHod: false, senior: true };
    expect(leaveDecidedBy(teacherCs)).toBe("HOD");
    expect(leaveDecidedBy(poolTeacher)).toBe("ADMIN");
    expect(leaveDecidedBy(hodApplicant)).toBe("NONE");
    expect(leaveDecidedBy(officeApplicant)).toBe("NONE");
    const hod = { ...hodCs, staffId: 51 };
    const hodMe = actor([g("HOD", 6)]);
    expect(canDecideStaffLeave(hod, teacherCs)).toBe(true);
    expect(canDecideStaffLeave(hodMe, teacherCs)).toBe(false);
    expect(canDecideStaffLeave(hod, poolTeacher)).toBe(false);
    expect(canDecideStaffLeave(hod, hodApplicant)).toBe(false); // own leave
    expect(canDecideStaffLeave({ ...admin, staffId: 9 }, teacherCs)).toBe(true);
    expect(canDecideStaffLeave({ ...admin, staffId: 9 }, poolTeacher)).toBe(true);
    expect(canDecideStaffLeave({ ...admin, staffId: 9 }, hodApplicant)).toBe(false); // nothing to decide
    expect(canDecideStaffLeave({ ...office, staffId: 9 }, teacherCs)).toBe(false);
    expect([admin, principal, hodCs, faculty, office].map(staffLeaveScope)).toEqual(["ALL", "ALL", "DEPARTMENTS", "OWN", "ALL"]);
    expect(labels(faculty)).toContain("My leave");
    expect(labels(hodCs)).toContain("Staff leave");
  });

  it("HOD manages only their own department", () => {
    expect(canManageDepartment(hodCs, 2)).toBe(true);
    expect(canManageDepartment(hodCs, 6)).toBe(false);
    expect(canManageClass(hodCs, csSem3)).toBe(true);
    expect(canViewClass(hodCs, meSem3)).toBe(false);
    expect(canEditCalendar(hodCs, { kind: "DEPARTMENT", departmentId: 2 })).toBe(false);
    expect(visibleDepartmentIds(hodCs)).toEqual([2]);
  });

  it("class teacher manages own class students only", () => {
    expect(canManageClassStudents(classTeacher, csSem3)).toBe(true);
    expect(canManageClassStudents(classTeacher, csSem5)).toBe(false);
    expect(canManageClass(classTeacher, csSem3)).toBe(false);
    expect(canViewClass(classTeacher, csSem5)).toBe(true); // teaches there
  });

  it("faculty only views classes they teach", () => {
    expect(canViewClass(faculty, csSem5)).toBe(true);
    expect(canViewClass(faculty, csSem3)).toBe(false);
    expect(canManageClassStudents(faculty, csSem5)).toBe(false);
    expect(canEditCalendar(faculty, { kind: "CLASS", classRef: csSem5 })).toBe(false);
  });

  it("a saved class stays with the person who saved it, the subject teacher, the HOD and the admin", () => {
    const saved = { classRef: csSem3, assignedStaffIds: [77], markedBy: 88 };
    expect(canMarkSession(faculty, saved)).toBe(false); // another substitute
    expect(canMarkSession({ ...faculty, staffId: 88 }, saved)).toBe(true); // saved it
    expect(canMarkSession({ ...faculty, staffId: 77 }, saved)).toBe(true); // subject teacher
    expect(canMarkSession(hodCs, saved)).toBe(true);
    expect(canMarkSession(admin, saved)).toBe(true);
    expect(canMarkSession(faculty, { ...saved, markedBy: null })).toBe(true); // not taken yet
  });

  it("department today: faculty and HOD of a department, all for admin", () => {
    expect(coverDepartmentIds(faculty)).toEqual([2]);
    expect(coverDepartmentIds(hodCs)).toEqual([2]);
    expect(coverDepartmentIds(admin)).toBeNull();
    expect(coverDepartmentIds(principal)).toEqual([]);
    expect(coverDepartmentIds(office)).toEqual([]);
    expect(labels(faculty)).toContain("Department today");
    expect(labels(principal)).not.toContain("Department today");
  });

  it("class teacher sees their class's status page; others of the department don't", () => {
    expect(canViewClassStatus(classTeacher, csSem3)).toBe(true);
    expect(canViewClassStatus(classTeacher, csSem5)).toBe(false);
    expect(canViewClassStatus(faculty, csSem3)).toBe(false);
    expect(canViewClassStatus(hodCs, csSem3)).toBe(true);
    expect(labels(classTeacher)).toContain("My class");
    expect(labels(faculty)).not.toContain("My class");
  });

  it("HOD publishes updates for their own department only", () => {
    expect(canPublishUpdates(hodCs)).toBe(true);
    expect(canPublishUpdateTo(hodCs, 2)).toBe(true);
    expect(canPublishUpdateTo(hodCs, 6)).toBe(false);
    expect(canPublishUpdateTo(hodCs, null)).toBe(false); // whole college
    expect(canPublishUpdates(faculty)).toBe(false);
  });

  it("HOD adds and edits own-department faculty, never senior roles", () => {
    const hod = { ...hodCs, staffId: 51 };
    expect(canAddStaff(hod)).toBe(true);
    expect(canAddStaff(faculty)).toBe(false);
    expect(canManageStaffMember(hod, { staffId: 60, departmentId: 2, roles: ["FACULTY"] })).toBe(true);
    expect(canManageStaffMember(hod, { staffId: 61, departmentId: 6, roles: ["FACULTY"] })).toBe(false);
    expect(canManageStaffMember(hod, { staffId: 62, departmentId: 2, roles: ["FACULTY", "OFFICE"] })).toBe(false);
    expect(canManageStaffMember(hod, { staffId: 51, departmentId: 2, roles: ["HOD"] })).toBe(false);
    expect(canManageStaffMember(hod, { staffId: 63, departmentId: null, roles: ["FACULTY"] })).toBe(false);
    expect(canGrantRole(hod, g("FACULTY", 2))).toBe(true);
    expect(canGrantRole(hod, g("FACULTY", 6))).toBe(false);
    expect(canGrantRole(hod, g("CLASS_TEACHER", null, 20), 2)).toBe(true);
    expect(canGrantRole(hod, g("CLASS_TEACHER", null, 30), 6)).toBe(false);
    for (const r of ["HOD", "ADMIN", "PRINCIPAL", "OFFICE"] as const) expect(canGrantRole(hod, g(r, 2))).toBe(false);
    expect(canGrantRole(admin, g("HOD", 2))).toBe(true);
    expect(labels(faculty)).toContain("Staff");
  });

  it("marking: assigned teacher, department substitute, HOD, admin — not principal or other departments", () => {
    const session = { classRef: csSem3, assignedStaffIds: [77] };
    expect(canMarkSession(actor([g("FACULTY", 6)]), { ...session, assignedStaffIds: [1] })).toBe(true); // assigned (staffId 1)
    expect(canMarkSession(faculty, session)).toBe(true); // CS faculty as substitute
    expect(canMarkSession(actor([g("FACULTY", 6)]), session)).toBe(false); // ME faculty
    expect(canMarkSession(actor([g("FACULTY", null)]), session)).toBe(false); // common staff, not assigned
    expect(canMarkSession(principal, session)).toBe(false);
    expect(canMarkSession(hodCs, session)).toBe(true);
    expect(canEditLockedAttendance(faculty, csSem3)).toBe(false);
    expect(canEditLockedAttendance(hodCs, csSem3)).toBe(true);
  });

  it("builds navigation from roles", () => {
    expect(labels(admin)).toContain("Settings");
    expect(labels(admin)).toContain("Departments");
    expect(labels(principal)).not.toContain("Departments");
    expect(labels(hodCs)).toContain("Subjects");
    expect(labels(faculty)).toContain("Staff"); // everyone sees the staff list
    expect(labels(actor([g("FACULTY", 2)]))).not.toContain("Classes");
    expect(labels(faculty)).toContain("Reports");
    expect(labels(actor([g("FACULTY", 2)]))).not.toContain("Reports");
  });

  it("parent messages: who sees, sends notices, and manages the queue", () => {
    expect([admin, principal, hodCs, classTeacher, faculty].map(canViewMessages)).toEqual([true, true, true, true, false]);
    expect([admin, principal, hodCs, classTeacher, faculty].map(canPublishUpdates)).toEqual([true, false, true, false, false]);
    expect([admin, principal, hodCs].map(canManageOutbox)).toEqual([true, false, false]);
  });

  it("audit log: admin and principal only", () => {
    expect([admin, principal, hodCs, classTeacher, faculty].map(canViewAudit)).toEqual([true, true, false, false, false]);
    expect([admin, principal, hodCs, classTeacher, faculty].map(canImport)).toEqual([true, false, false, false, false]);
    expect(navFor(hodCs).map((n) => n.label)).not.toContain("Audit log");
  });

  it("marks: part teacher enters CIE, only HOD/admin enter finals and publish", () => {
    const teacher = { ...faculty, staffId: 42 };
    const otherTeacher = { ...faculty, staffId: 43 };
    const part = (isFinal: boolean) => ({ classRef: csSem3, isFinal, assignedStaffIds: [42] });
    expect(canEnterMarks(teacher, part(false))).toBe(true);
    expect(canEnterMarks(teacher, part(true))).toBe(false);
    expect(canEnterMarks(otherTeacher, part(false))).toBe(false);
    expect(canEnterMarks(hodCs, part(true))).toBe(true);
    expect(canEnterMarks(hodCs, { ...part(true), classRef: meSem3 })).toBe(false);
    expect(canEnterMarks({ ...principal, staffId: 7 }, part(false))).toBe(false);
    expect([admin, principal, hodCs, faculty].map((a) => canPublishMarks(a, csSem3))).toEqual([true, false, true, false]);
  });

  it("only HOD, principal and admin see who has not entered attendance", () => {
    expect(canViewCompliance(admin)).toBe(true);
    expect(canViewCompliance(principal)).toBe(true);
    expect(canViewCompliance(hodCs)).toBe(true);
    expect(canViewCompliance(classTeacher)).toBe(false);
    expect(canViewCompliance(faculty)).toBe(false);
  });
});
