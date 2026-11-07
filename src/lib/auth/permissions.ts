/**
 * Who may do what. Pure functions over role grants, so every rule is unit-tested.
 * Server code must call these on EVERY read and write — UI hiding is never protection.
 *
 * ADMIN          everything
 * PRINCIPAL      view everything; decides HODs' leave; publishes college updates
 * OFFICE         college calendar, college updates, students and parent numbers college-wide; views every
 *                report; never attendance or marks
 * HOD            manage own department (courses, classes, timetables, teaching, students); decides teachers' leave
 * CLASS_TEACHER  manage own class's students and parent contacts; view its timetable
 * FACULTY        view classes they teach
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

export function canViewStaffList(a: Actor) {
  return seesWholeCollege(a) || hodDepartmentIds(a).length > 0;
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
 * Who may take attendance for a class session: its assigned teacher(s), any faculty of the
 * class's department (substitute), the HOD, or the admin. Principal is view-only.
 */
export function canMarkSession(a: Actor, s: { classRef: ClassRef; assignedStaffIds: readonly number[] }) {
  if (isAdmin(a) || hodDepartmentIds(a).includes(s.classRef.departmentId)) return true;
  if (s.assignedStaffIds.includes(a.staffId)) return true;
  return a.grants.some((g) => g.role === "FACULTY" && g.departmentId === s.classRef.departmentId);
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
 * Enter marks for one part of a subject: the teacher(s) of that part (theory tests + activity: theory
 * teacher; practical tests: lab teacher), the HOD, or the admin. Final exam marks: HOD / admin only.
 */
export function canEnterMarks(a: Actor, p: { classRef: ClassRef; isFinal: boolean; assignedStaffIds: readonly number[] }) {
  if (isAdmin(a) || hodDepartmentIds(a).includes(p.classRef.departmentId)) return true;
  return !p.isFinal && p.assignedStaffIds.includes(a.staffId);
}

/** Publish marks to students and parents, send back, or reopen published marks. */
export function canPublishMarks(a: Actor, c: ClassRef) {
  return isAdmin(a) || hodDepartmentIds(a).includes(c.departmentId);
}

/** "Not yet entered" report per teacher: whole college, or the HOD's departments. */
export function canViewCompliance(a: Actor) {
  return seesWholeCollege(a) || hodDepartmentIds(a).length > 0;
}

/** See parent messages: whole college, HOD's departments, class teacher's class. */
export function canViewMessages(a: Actor) {
  return seesWholeCollege(a) || hodDepartmentIds(a).length > 0 || classTeacherClassIds(a).length > 0;
}

/** Publish a college update (portal + WhatsApp to parents) for the college, a department or a class. */
export function canPublishUpdates(a: Actor) {
  return isAdmin(a) || isPrincipal(a) || isOffice(a);
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
}

/**
 * Who decides a staff member's own leave: teachers → their HOD; HODs, and anyone without a department
 * (principal, office, common-pool staff) → the principal. The admin can decide any. Never your own.
 */
export function leaveDecidedBy(applicant: LeaveApplicant): "HOD" | "PRINCIPAL" {
  return applicant.isHod || applicant.departmentId === null ? "PRINCIPAL" : "HOD";
}

export function canDecideStaffLeave(a: Actor, applicant: LeaveApplicant) {
  if (a.staffId === applicant.staffId) return false;
  if (isAdmin(a)) return true;
  if (leaveDecidedBy(applicant) === "PRINCIPAL") return isPrincipal(a);
  return hodDepartmentIds(a).includes(applicant.departmentId!);
}

/** Whose staff leave someone may see besides their own: everyone (principal, admin) or their departments (HOD). */
export function staffLeaveScope(a: Actor): "ALL" | "DEPARTMENTS" | "OWN" {
  if (overseesCollege(a)) return "ALL";
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
  if (canViewStaffList(a)) items.push({ href: "/staff", label: "Staff" });
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
