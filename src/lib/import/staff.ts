/**
 * Staff import: one row per person, matched by mobile number (their login).
 * New people get an account with a temporary password; existing people get their details updated
 * where a cell is filled. Roles are only ever added, never removed (that stays a deliberate click).
 */
import type { Role } from "@/lib/auth/permissions";
import { changeLine, duplicates, emptyPlan, mobile, readColumns, RowReader, textCell, type Column, type Plan } from "./columns";
import type { ReadRow } from "@/lib/sheet-read";

export const STAFF_COLUMNS = [
  { key: "name", label: "Name", required: true, help: "Full name as it should appear on screens.", example: "Dr. Kavitha R" },
  { key: "mobile", label: "Mobile", aliases: ["Mobile number", "Phone", "Phone number", "Mobile no"], required: true, help: "10-digit mobile. This is their login.", example: "98450 12345" },
  { key: "department", label: "Department", aliases: ["Dept"], help: "Department code: CE, CS, EE, EC, EI, ME, CG. Blank for principal / office.", example: "CS" },
  { key: "designation", label: "Designation", help: "e.g. Lecturer, Senior Lecturer, HOD.", example: "Senior Lecturer" },
  { key: "email", label: "Email", aliases: ["Email id", "E-mail"], help: "Optional.", example: "kavitha@example.com" },
  { key: "roles", label: "Roles", aliases: ["Role"], help: "Faculty, HOD, Principal, Admin; several separated by commas. Blank = Faculty for new people.", example: "Faculty, HOD" },
  { key: "classTeacher", label: "Class teacher of", aliases: ["Class teacher"], help: "Semester they are class teacher of this term, e.g. 3 (their department) or CS 3.", example: "3" },
] as const satisfies readonly Column[];

type Key = (typeof STAFF_COLUMNS)[number]["key"];

export interface GrantSpec {
  role: Role;
  departmentId: number | null;
  classGroupId: number | null;
}

export interface StaffContext {
  departments: readonly { id: number; code: string }[];
  /** Classes of the term being set up. */
  classes: readonly { id: number; departmentId: number; departmentCode: string; semester: number; classTeachers: readonly number[] }[];
  staff: readonly {
    id: number;
    name: string;
    phone: string;
    email: string | null;
    departmentId: number | null;
    designation: string | null;
    active: boolean;
    grants: readonly GrantSpec[];
  }[];
}

export interface StaffValues {
  name: string;
  phone: string;
  email: string | null;
  departmentId: number | null;
  designation: string | null;
}

export type StaffOp =
  | { kind: "create"; line: number; values: StaffValues; grants: GrantSpec[] }
  | { kind: "update"; line: number; id: number; set: Partial<StaffValues>; before: Partial<StaffValues>; grants: GrantSpec[] };

const ROLE_WORDS: Record<string, Role> = {
  faculty: "FACULTY",
  teacher: "FACULTY",
  lecturer: "FACULTY",
  staff: "FACULTY",
  hod: "HOD",
  head: "HOD",
  headofdepartment: "HOD",
  principal: "PRINCIPAL",
  admin: "ADMIN",
  administrator: "ADMIN",
};

export const ROLE_NAME: Record<Role, string> = { FACULTY: "Faculty", HOD: "HOD", PRINCIPAL: "Principal", ADMIN: "Admin", CLASS_TEACHER: "Class teacher" };

export function planStaff(file: readonly ReadRow[], ctx: StaffContext): Plan<StaffOp> {
  const plan = emptyPlan<StaffOp>();
  const { rows, errors, warnings } = readColumns<Key>(file, STAFF_COLUMNS);
  plan.errors.push(...errors);
  plan.warnings.push(...warnings);
  if (errors.length) return plan;

  const deptByCode = new Map(ctx.departments.map((d) => [d.code, d]));
  const deptCode = new Map(ctx.departments.map((d) => [d.id, d.code]));
  const byPhone = new Map(ctx.staff.map((s) => [s.phone, s]));
  const hodOf = new Map<number, number[]>();
  for (const s of ctx.staff) for (const g of s.grants) if (g.role === "HOD" && g.departmentId) hodOf.set(g.departmentId, [...(hodOf.get(g.departmentId) ?? []), s.id]);
  const phones: { line: number; key: string | undefined }[] = [];

  for (const row of rows) {
    const r = new RowReader();
    const name = r.take(textCell(row.get("name"), "Name", 120, true));
    const phone = row.get("mobile") ? r.take(mobile(row.get("mobile"), "Mobile")) : (r.errors.push("Mobile is empty."), undefined);
    phones.push({ line: row.line, key: phone });
    const existing = phone ? byPhone.get(phone) : undefined;

    let departmentId: number | null | undefined = null;
    const deptRaw = row.get("department").toUpperCase();
    if (deptRaw) {
      const d = deptByCode.get(deptRaw);
      if (!d) r.errors.push(`Department “${row.get("department")}” is not one of ${[...deptByCode.keys()].join(", ")}.`);
      departmentId = d?.id;
    }
    const designation = r.take(textCell(row.get("designation"), "Designation", 100, false));
    const email = r.take(textCell(row.get("email"), "Email", 200, false));
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) r.errors.push(`Email “${email}” is not a valid address.`);

    // Department the roles apply to: the file's, else what is already saved.
    const effectiveDept = deptRaw ? departmentId : (existing?.departmentId ?? null);
    const roles = new Set<Role>();
    const rolesRaw = row.get("roles");
    for (const part of rolesRaw.split(/[,;/+&]|\band\b/i).map((p) => p.trim()).filter(Boolean)) {
      const role = ROLE_WORDS[part.toLowerCase().replace(/[^a-z]/g, "")];
      if (!role) r.errors.push(`Role “${part}” is not one of Faculty, HOD, Principal, Admin.`);
      else roles.add(role);
    }
    if (!rolesRaw && !existing) roles.add("FACULTY");
    if (roles.has("HOD") && !effectiveDept) r.errors.push("HOD needs a department.");

    const grants: GrantSpec[] = [];
    const has = (g: GrantSpec) =>
      existing?.grants.some((e) => e.role === g.role && (g.role === "FACULTY" || (e.departmentId === g.departmentId && e.classGroupId === g.classGroupId))) ?? false;
    for (const role of roles) {
      const g: GrantSpec = role === "HOD" || role === "FACULTY" ? { role, departmentId: effectiveDept ?? null, classGroupId: null } : { role, departmentId: null, classGroupId: null };
      if (!has(g)) grants.push(g);
    }

    const ctRaw = row.get("classTeacher").toUpperCase().replace(/\s+/g, " ");
    if (ctRaw) {
      const m = /^([A-Z]{2})?\s*(?:SEM(?:ESTER)?)?\s*([1-6])$/.exec(ctRaw);
      const dept = m?.[1] ? deptByCode.get(m[1])?.id : effectiveDept;
      if (!m) r.errors.push(`Class teacher of “${row.get("classTeacher")}”: write the semester, e.g. 3 or CS 3.`);
      else if (!dept) r.errors.push(m[1] ? `Department ${m[1]} does not exist.` : "Class teacher needs a department: fill Department or write e.g. CS 3.");
      else {
        const cls = ctx.classes.find((c) => c.departmentId === dept && c.semester === Number(m[2]));
        if (!cls) r.errors.push(`There is no ${deptCode.get(dept)} Sem ${m[2]} class this term.`);
        else {
          const g: GrantSpec = { role: "CLASS_TEACHER", departmentId: null, classGroupId: cls.id };
          if (!has(g)) {
            grants.push(g);
            const others = cls.classTeachers.filter((id) => id !== existing?.id);
            if (others.length) plan.warnings.push({ line: row.line, message: `${deptCode.get(dept)} Sem ${cls.semester} already has a class teacher; ${name ?? "this person"} will be a second one.` });
          }
        }
      }
    }

    if (r.errors.length || !name || !phone || departmentId === undefined) {
      plan.errors.push(...r.errors.map((message) => ({ line: row.line, message })));
      continue;
    }

    for (const g of grants) {
      if (g.role === "HOD" && (hodOf.get(g.departmentId!) ?? []).some((id) => id !== existing?.id)) {
        plan.warnings.push({ line: row.line, message: `${deptCode.get(g.departmentId!)} already has an HOD; ${name} will be another.` });
      }
      if (g.role === "ADMIN") plan.warnings.push({ line: row.line, message: `${name} will be made an Admin (can change everything).` });
    }
    const scope = (g: GrantSpec) => {
      if (g.role === "HOD") return ` (${deptCode.get(g.departmentId!)})`;
      const c = ctx.classes.find((x) => x.id === g.classGroupId);
      return c ? ` (${c.departmentCode} Sem ${c.semester})` : "";
    };
    const grantText = grants.map((g) => `+ ${ROLE_NAME[g.role]}${scope(g)}`);

    if (!existing) {
      const values: StaffValues = { name, phone, email: email ?? null, departmentId, designation: designation ?? null };
      plan.ops.push({ kind: "create", line: row.line, values, grants });
      plan.items.push({ line: row.line, action: "create", label: name, changes: [deptCode.get(departmentId!) ?? "No department", ...grantText] });
      continue;
    }

    // Blank cells leave what is saved; only filled cells change things.
    const set: Partial<StaffValues> = {};
    const before: Partial<StaffValues> = {};
    const changes: string[] = [];
    const maybe = <F extends keyof StaffValues>(field: F, label: string, value: StaffValues[F] | null | undefined, show = (v: unknown) => v) => {
      if (value === null || value === undefined || value === existing[field]) return;
      set[field] = value;
      before[field] = existing[field];
      changes.push(changeLine(label, show(existing[field]), show(value)));
    };
    maybe("name", "Name", name);
    maybe("departmentId", "Department", deptRaw ? departmentId : undefined, (v) => deptCode.get(v as number) ?? null);
    maybe("designation", "Designation", designation);
    maybe("email", "Email", email);
    if (!existing.active) plan.warnings.push({ line: row.line, message: `${existing.name}'s account is deactivated. Import does not re-activate it; do that on their page if needed.` });
    const action = changes.length || grants.length ? "update" : "same";
    if (action === "update") plan.ops.push({ kind: "update", line: row.line, id: existing.id, set, before, grants });
    plan.items.push({ line: row.line, action, label: existing.name, changes: [...changes, ...grantText] });
  }

  plan.errors.push(...duplicates(phones, (p) => `Mobile ${p.slice(3)}`));
  return plan;
}
