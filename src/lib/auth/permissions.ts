/**
 * Who may do what. Pure functions over role grants, so every rule is unit-tested.
 * Server code must call these on EVERY read and write — UI hiding is never protection.
 *
 * ADMIN          everything
 * PRINCIPAL      view everything; edit college calendar
 * HOD            manage own department (courses, classes, timetables, teaching, dept calendar, students)
 * CLASS_TEACHER  manage own class's students and parent contacts; view its timetable
 * FACULTY        view classes they teach
 */
export type Role = "ADMIN" | "PRINCIPAL" | "HOD" | "FACULTY" | "CLASS_TEACHER";

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
/** Sees every department (read-only for principal). */
export const seesWholeCollege = (a: Actor) => isAdmin(a) || isPrincipal(a);

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
  return canManageClass(a, c) || classTeacherClassIds(a).includes(c.id);
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
  return canManageClassStudents(a, c);
}

export type CalendarScope = { kind: "COLLEGE" } | { kind: "DEPARTMENT"; departmentId: number } | { kind: "CLASS"; classRef: ClassRef };

export function canEditCalendar(a: Actor, scope: CalendarScope) {
  if (isAdmin(a)) return true;
  if (scope.kind === "COLLEGE") return isPrincipal(a);
  if (scope.kind === "DEPARTMENT") return isPrincipal(a) || hodDepartmentIds(a).includes(scope.departmentId);
  return isPrincipal(a) || canManageClass(a, scope.classRef);
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

/** Send a notice to parents (college, department or class). */
export function canBroadcast(a: Actor) {
  return isAdmin(a) || isPrincipal(a);
}

/** Retry / cancel messages and run the sender by hand. */
/** Read the audit log (who changed what): admin and principal. */
export function canViewAudit(a: Actor) {
  return seesWholeCollege(a);
}

export function canManageOutbox(a: Actor) {
  return isAdmin(a);
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
  if (canViewStaffList(a)) items.push({ href: "/staff", label: "Staff" });
  if (isAdmin(a)) items.push({ href: "/admin/departments", label: "Departments" });
  if (seesWholeCollege(a)) items.push({ href: "/admin/settings", label: "Settings" });
  if (canViewAudit(a)) items.push({ href: "/admin/audit", label: "Audit log" });
  return items;
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  PRINCIPAL: "Principal",
  HOD: "HOD",
  FACULTY: "Faculty",
  CLASS_TEACHER: "Class teacher",
};
