import { describe, expect, it } from "vitest";
import {
  canEditCalendar,
  canEditLockedAttendance,
  canMarkSession,
  canManageClass,
  canManageClassStudents,
  canManageDepartment,
  canManageSettings,
  canViewClass,
  navFor,
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

  it("principal sees everything but manages only the calendar", () => {
    expect(canViewClass(principal, meSem3)).toBe(true);
    expect(canManageClass(principal, meSem3)).toBe(false);
    expect(canManageSettings(principal)).toBe(false);
    expect(canEditCalendar(principal, { kind: "COLLEGE" })).toBe(true);
  });

  it("HOD manages only their own department", () => {
    expect(canManageDepartment(hodCs, 2)).toBe(true);
    expect(canManageDepartment(hodCs, 6)).toBe(false);
    expect(canManageClass(hodCs, csSem3)).toBe(true);
    expect(canViewClass(hodCs, meSem3)).toBe(false);
    expect(canEditCalendar(hodCs, { kind: "DEPARTMENT", departmentId: 2 })).toBe(true);
    expect(canEditCalendar(hodCs, { kind: "DEPARTMENT", departmentId: 6 })).toBe(false);
    expect(canEditCalendar(hodCs, { kind: "COLLEGE" })).toBe(false);
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
    const labels = (a: Actor) => navFor(a).map((n) => n.label);
    expect(labels(admin)).toContain("Settings");
    expect(labels(admin)).toContain("Departments");
    expect(labels(principal)).not.toContain("Departments");
    expect(labels(hodCs)).toContain("Subjects");
    expect(labels(faculty)).not.toContain("Staff");
    expect(labels(actor([g("FACULTY", 2)]))).not.toContain("Classes");
  });
});
