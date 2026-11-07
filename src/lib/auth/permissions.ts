/**
 * Who may do what. Pure functions over role grants, so every rule is unit-tested.
 * Server code must call these on EVERY read and write — UI hiding is never protection.
 *
 * ADMIN          everything
 * PRINCIPAL      views everything (reports, overview, staff, messages, audit log); changes and approves nothing
 * OFFICE         college calendar, college updates, students and parent numbers college-wide; views every
 *                report (attendance and marks too) but never changes attendance or marks
 * HOD            manage own department (subjects, classes, timetables, teaching, students, its staff); decides
 *                student leave (and how it counts) and teachers' leave; updates for the department
 * CLASS_TEACHER  own class: students and parent contacts, leave / OD requests, the class's daily and weekly
 *                attendance status, marks entry status, shortage list
 * FACULTY        take attendance for any class of their department (substitutes); a class someone already
 *                saved stays with them, the subject teacher and the HOD
 *
 * HODs and class teachers teach their own subjects too: those rights come from teaching assignments.
 */
export type Role = "ADMIN" | "PRINCIPAL" | "HOD" | "FACULTY" | "CLASS_TEACHER" | "OFFICE";

export interface Grant {
  role: Role;
  departmentId: number | null;
  classGroupId: number | null;
}

export interface Actor {
  staffId: number;
  grants: readonly Grant[];
  /** Classes this person teaches (from teaching assignments). */
  teachingClassIds: readonly number[];
}

export interface ClassRef {
  id: number;
  departmentId: number;
}

const has = (a: Actor, role: Role) => a.grants.some((g) => g.role === role);

export const isAdmin = (a: Actor) => has(a, "ADMIN");
export const isPrincipal = (a: Actor) => has(a, "PRINCIPAL");
export const isOffice = (a: Actor) => has(a, "OFFICE");
/** Sees every department's classes, students and reports (read-only for principal and office). */
export const seesWholeCollege = (a: Actor) => isAdmin(a) || isPrincipal(a) || isOffice(a);
/** College-level oversight: settings view, audit log, the per-department overview. */
export const overseesCollege = (a: Actor) => isAdmin(a) || isPrincipal(a);

export function hodDepartmentIds(a: Actor): number[] {
  return a.grants.filter((g) => g.role === "HOD" && g.departmentId !== null).map((g) => g.departmentId!);
}

export function classTeacherClassIds(a: Actor): number[] {
  return a.grants.filter((g) => g.role === "CLASS_TEACHER" && g.classGroupId !== null).map((g) => g.classGroupId!);
}

export function canManageSettings(a: Actor) {
  return isAdmin(a);
}

export function canManageStaff(a: Actor) {
  return isAdmin(a);
}

/** Every staff member can see the staff list and profiles (name, department, roles, phone). */
export function canViewStaffList(_a: Actor) {
  return true;
}

/** Roles only the admin hands out; an HOD can't give or take them, or edit people who hold them. */
export const SENIOR_ROLES: readonly Role[] = ["ADMIN", "PRINCIPAL", "OFFICE", "HOD"];

/** Add a staff member: the admin (anyone), or an HOD (as faculty of their own department). */
export function canAddStaff(a: Actor) {
  return isAdmin(a) || hodDepartmentIds(a).length > 0;
}

/**
 * Edit a staff member's details, reset their password, deactivate them: the admin, or the HOD of their
 * department as long as they hold no senior role (and are not the HOD themselves).
 */
export function canManageStaffMember(a: Actor, target: { staffId: number; departmentId: number | null; roles: readonly Role[] }) {
  if (isAdmin(a)) return true;
  if (target.staffId === a.staffId || target.departmentId === null) return false;
  return hodDepartmentIds(a).includes(target.departmentId) && !target.roles.some((r) => SENIOR_ROLES.includes(r));
}

/**
 * Give or remove one role grant: the admin (any), or an HOD for FACULTY of their department or CLASS_TEACHER
 * of one of its classes. `classDepartmentId` is the department of `grant.classGroupId` (looked up by the caller).
 */
export function canGrantRole(a: Actor, grant: Grant, classDepartmentId: number | null = null) {
  if (isAdmin(a)) return true;
  const depts = hodDepartmentIds(a);
  if (grant.role === "FACULTY") return grant.departmentId !== null && depts.includes(grant.departmentId);
  if (grant.role === "CLASS_TEACHER") return classDepartmentId !== null && depts.includes(classDepartmentId);
  return false;
}

export function canManageDepartment(a: Actor, departmentId: number) {
  return isAdmin(a) || hodDepartmentIds(a).includes(departmentId);
}

export function canViewDepartment(a: Actor, departmentId: number) {
  return seesWholeCollege(a) || hodDepartmentIds(a).includes(departmentId);
}

/** Timetable, courses offered, teaching assignments. */
export function canManageClass(a: Actor, c: ClassRef) {
  return canManageDepartment(a, c.departmentId);
}

/** Student details and parent contacts. */
export function canManageClassStudents(a: Actor, c: ClassRef) {
  return canManageClass(a, c) || isOffice(a) || classTeacherClassIds(a).includes(c.id);
}

export function canViewClass(a: Actor, c: ClassRef) {
  return canViewDepartment(a, c.departmentId) || classTeacherClassIds(a).includes(c.id) || a.teachingClassIds.includes(c.id);
}

/**
 * Who may take attendance for a class session: its assigned teacher(s), the HOD, the admin, or any faculty
 * of the class's department (a substitute) while nobody has saved it yet. Once saved (`markedBy` set), a
 * substitute can't change it unless they saved it themselves. Principal and office are view-only.
 */
export function canMarkSession(a: Actor, s: { classRef: ClassRef; assignedStaffIds: readonly number[]; markedBy?: number | null }) {
  if (isAdmin(a) || hodDepartmentIds(a).includes(s.classRef.departmentId)) return true;
  if (s.assignedStaffIds.includes(a.staffId)) return true;
  if (s.markedBy != null) return s.markedBy === a.staffId;
  return isDepartmentFaculty(a, s.classRef.departmentId);
}

/** Faculty (or HOD) of this department: may open its timetable and cover any untaken class. */
export function isDepartmentFaculty(a: Actor, departmentId: number) {
  return hodDepartmentIds(a).includes(departmentId) || a.grants.some((g) => g.role === "FACULTY" && g.departmentId === departmentId);
}

/** Departments whose "today" timetable this person can open to cover classes (all for the admin = null). */
export function coverDepartmentIds(a: Actor): number[] | null {
  if (isAdmin(a)) return null;
  const ids = [...hodDepartmentIds(a), ...a.grants.filter((g) => g.role === "FACULTY" && g.departmentId !== null).map((g) => g.departmentId!)];
  return [...new Set(ids)];
}

/** The class teacher's "My class" page (attendance status, marks entry status, shortage). Also the HOD / admin. */
export function canViewClassStatus(a: Actor, c: ClassRef) {
  return classTeacherClassIds(a).includes(c.id) || canManageClass(a, c) || seesWholeCollege(a);
}

/** Change attendance after the edit window without a request (HOD/admin). */
export function canEditLockedAttendance(a: Actor, c: ClassRef) {
  return isAdmin(a) || hodDepartmentIds(a).includes(c.departmentId);
}

/** Approve late edit requests and leave notices for a class. */
export function canApproveForClass(a: Actor, c: ClassRef) {
  return canEditLockedAttendance(a, c);
}

/** Record leave / on-duty notices (approval may still be needed). */
export function canRecordLeave(a: Actor, c: ClassRef) {
  return canManageClass(a, c) || classTeacherClassIds(a).includes(c.id);
}

export type CalendarScope = { kind: "COLLEGE" } | { kind: "DEPARTMENT"; departmentId: number } | { kind: "CLASS"; classRef: ClassRef };

/** The office keeps the calendar (holidays, exams, events) for every scope; everyone else views it. */
export function canEditCalendar(a: Actor, _scope?: CalendarScope) {
  return isAdmin(a) || isOffice(a);
}

/**
 * Enter marks for one part of a subject, final exam included: the teacher(s) of that part (theory tests,
 * activity and theory final: theory teacher; practical tests and final: lab teacher), the HOD, or the admin.
 * The same people press "Done – show to parents" and correct marks afterwards. No approval step
 * (decided 2026-11-07).
 */
export function canEnterMarks(a: Actor, p: { classRef: ClassRef; assignedStaffIds: readonly number[] }) {
  if (isAdmin(a) || hodDepartmentIds(a).includes(p.classRef.departmentId)) return true;
  return p.assignedStaffIds.includes(a.staffId);
}

/** "Not yet entered" report per teacher: whole college, or the HOD's departments. */
export function canViewCompliance(a: Actor) {
  return seesWholeCollege(a) || hodDepartmentIds(a).length > 0;
}

/** See parent messages: whole college, HOD's departments, class teacher's class. */
export function canViewMessages(a: Actor) {
  return seesWholeCollege(a) || hodDepartmentIds(a).length > 0 || classTeacherClassIds(a).length > 0;
}

/** Open the Updates screen and publish: the office and admin (any audience) and HODs (own department). */
export function canPublishUpdates(a: Actor) {
  return isAdmin(a) || isOffice(a) || hodDepartmentIds(a).length > 0;
}

/**
 * Publish or withdraw an update for one audience. `departmentId` is the audience's department: null for the
 * whole college, the class's department for a class. HODs only for their own department.
 */
export function canPublishUpdateTo(a: Actor, departmentId: number | null) {
  if (isAdmin(a) || isOffice(a)) return true;
  return departmentId !== null && hodDepartmentIds(a).includes(departmentId);
}

/** Read the audit log (who changed what): admin and principal. */
export function canViewAudit(a: Actor) {
  return overseesCollege(a);
}

/** Load staff, subjects, students and timetables from Excel / CSV files: admin only. */
export function canImport(a: Actor) {
  return isAdmin(a);
}

/** Retry / cancel messages and run the sender by hand. */
export function canManageOutbox(a: Actor) {
  return isAdmin(a);
}

/** The person a staff leave belongs to, as far as deciding it goes. */
export interface LeaveApplicant {
  staffId: number;
  departmentId: number | null;
  /** Holds an HOD grant (for any department). */
  isHod: boolean;
  /** Holds a senior role (admin, principal, office, HOD): their leave needs no approval. */
  senior: boolean;
}

/**
 * Who decides a staff member's own leave:
 *  - teachers → the HOD of their department;
 *  - a teacher with no department (common pool) → the admin;
 *  - HODs, office staff, the principal and the admin → nobody: it is recorded as approved straight away.
 * The admin can decide any pending leave. Nobody decides their own. The principal decides none.
 */
export function leaveDecidedBy(applicant: LeaveApplicant): "HOD" | "ADMIN" | "NONE" {
  if (applicant.senior) return "NONE";
  return applicant.departmentId === null ? "ADMIN" : "HOD";
}

export function canDecideStaffLeave(a: Actor, applicant: LeaveApplicant) {
  if (a.staffId === applicant.staffId) return false;
  const by = leaveDecidedBy(applicant);
  if (by === "NONE") return false;
  if (isAdmin(a)) return true;
  return by === "HOD" && hodDepartmentIds(a).includes(applicant.departmentId!);
}

/** Whose staff leave someone may see besides their own: everyone (principal, admin, office) or their departments (HOD). */
export function staffLeaveScope(a: Actor): "ALL" | "DEPARTMENTS" | "OWN" {
  if (seesWholeCollege(a)) return "ALL";
  return hodDepartmentIds(a).length > 0 ? "DEPARTMENTS" : "OWN";
}

/** Department filter for list queries: null = all departments. */
export function visibleDepartmentIds(a: Actor): number[] | null {
  return seesWholeCollege(a) ? null : hodDepartmentIds(a);
}

export interface NavItem {
  href: string;
  label: string;
}

export function navFor(a: Actor): NavItem[] {
  const items: NavItem[] = [{ href: "/", label: "Dashboard" }];
  if (classTeacherClassIds(a).length > 0) items.push({ href: "/my-class", label: "My class" });
  const anyClass = seesWholeCollege(a) || hodDepartmentIds(a).length > 0 || classTeacherClassIds(a).length > 0 || a.teachingClassIds.length > 0;
  const marks = isAdmin(a) || hodDepartmentIds(a).length > 0 || a.teachingClassIds.length > 0 || a.grants.some((g) => g.role === "FACULTY" && g.departmentId !== null);
  if (marks) items.push({ href: "/attendance", label: "Attendance" });
  if (anyClass) items.push({ href: "/leaves", label: "Leave & OD" });
  if (anyClass) items.push({ href: "/marks", label: "Marks" });
  if (anyClass) items.push({ href: "/classes", label: "Classes" });
  if (anyClass) items.push({ href: "/students", label: "Students" });
  if (anyClass) items.push({ href: "/reports", label: "Reports" });
  if (canViewMessages(a)) items.push({ href: "/messages", label: "Messages" });
  if (seesWholeCollege(a) || hodDepartmentIds(a).length > 0) items.push({ href: "/courses", label: "Subjects" });
  items.push({ href: "/calendar", label: "Calendar" });
  if (canPublishUpdates(a)) items.push({ href: "/updates", label: "Updates" });
  items.push({ href: "/staff-leave", label: staffLeaveScope(a) === "OWN" ? "My leave" : "Staff leave" });
  items.push({ href: "/staff", label: "Staff" });
  if (isAdmin(a)) items.push({ href: "/admin/departments", label: "Departments" });
  if (overseesCollege(a)) items.push({ href: "/admin/settings", label: "Settings" });
  if (canViewAudit(a)) items.push({ href: "/admin/audit", label: "Audit log" });
  return items;
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  PRINCIPAL: "Principal",
  HOD: "HOD",
  FACULTY: "Faculty",
  CLASS_TEACHER: "Class teacher",
  OFFICE: "Office",
};
