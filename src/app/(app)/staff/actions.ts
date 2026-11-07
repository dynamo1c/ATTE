"use server";

import { and, count, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { classGroup, roleGrant, staff } from "@/db/schema";
import { canAddStaff, canGrantRole, canManageStaffMember, hodDepartmentIds, isAdmin, type Actor, type Role } from "@/lib/auth/permissions";
import { generateTempPassword, hashPassword } from "@/lib/auth/password";
import { checkbox, int, oneOf, optionalInt, optionalText, phone, text } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";
import { revokeSessions } from "@/server/session";

const ROLES = ["ADMIN", "PRINCIPAL", "OFFICE", "HOD", "FACULTY", "CLASS_TEACHER"] as const;

/** The person being changed, as far as permissions go. */
async function loadTarget(staffId: number) {
  const [person] = await getDb().select({ id: staff.id, departmentId: staff.departmentId }).from(staff).where(eq(staff.id, staffId));
  if (!person) throw new UserError("Staff member not found.");
  const grants = await getDb().select({ role: roleGrant.role }).from(roleGrant).where(eq(roleGrant.staffId, staffId));
  return { staffId, departmentId: person.departmentId, roles: grants.map((g) => g.role as Role) };
}

async function ensureCanManage(actor: Actor, staffId: number) {
  ensure(canManageStaffMember(actor, await loadTarget(staffId)), "Only the admin, or the HOD of their department, can change this staff member.");
}

/** An HOD keeps staff inside their own department; the admin may put anyone anywhere. */
function ensureDepartmentAllowed(actor: Actor, departmentId: number | null) {
  if (isAdmin(actor)) return;
  if (departmentId === null || !hodDepartmentIds(actor).includes(departmentId)) {
    throw new UserError("As HOD you can add staff only to your own department.", { departmentId: ["Choose your department"] });
  }
}

const profileFields = {
  name: text("Name", 120),
  phone: phone("Mobile number"),
  email: optionalText(200).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email"),
  departmentId: optionalInt(),
  designation: optionalText(100),
};

export const createStaff = formAction(z.object({ ...profileFields, makeFaculty: checkbox() }), async (input, { me }) => {
  ensure(canAddStaff(me.actor), "Only the admin or an HOD can add staff.");
  ensureDepartmentAllowed(me.actor, input.departmentId ?? null);
  // Staff an HOD adds always teach in that department.
  if (!isAdmin(me.actor)) input.makeFaculty = true;
  const temp = generateTempPassword();
  const passwordHash = await hashPassword(temp);
  const { makeFaculty, ...profile } = input;
  const id = await getDb().transaction(async (tx) => {
    const [row] = await tx.insert(staff).values({ ...profile, passwordHash, mustChangePassword: true }).returning({ id: staff.id });
    if (makeFaculty) await tx.insert(roleGrant).values({ staffId: row.id, role: "FACULTY", departmentId: profile.departmentId });
    await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "staff", entityId: row.id, after: { ...profile, makeFaculty } });
    return row.id;
  });
  revalidatePath("/staff");
  return {
    ok: true,
    message: `${profile.name} added.`,
    reveal: { label: "Temporary password", value: temp },
    link: { href: `/staff/${id}`, label: "Open profile to add roles →" },
  };
});

export const updateStaff = formAction(z.object({ id: int("Staff"), ...profileFields }), async ({ id, ...profile }, { me }) => {
  await ensureCanManage(me.actor, id);
  ensureDepartmentAllowed(me.actor, profile.departmentId ?? null);
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(staff).where(eq(staff.id, id));
    if (!before) throw new UserError("Staff member not found.");
    await tx.update(staff).set(profile).where(eq(staff.id, id));
    await audit(tx, { actorStaffId: me.id, action: "UPDATE", entity: "staff", entityId: id, before: { ...before, passwordHash: undefined }, after: profile });
  });
  revalidatePath(`/staff/${id}`);
  return { ok: true, message: "Saved." };
});

async function activeAdminCount(excludingStaffId: number) {
  const [r] = await getDb()
    .select({ n: count() })
    .from(roleGrant)
    .innerJoin(staff, eq(staff.id, roleGrant.staffId))
    .where(and(eq(roleGrant.role, "ADMIN"), eq(staff.active, true), ne(staff.id, excludingStaffId)));
  return r.n;
}

export const setStaffActive = formAction(z.object({ id: int("Staff"), active: oneOf(["true", "false"], "status") }), async ({ id, active }, { me }) => {
  await ensureCanManage(me.actor, id);
  const makeActive = active === "true";
  if (!makeActive) {
    if (id === me.id) throw new UserError("You can't deactivate your own account.");
    const [isAdmin] = await getDb().select({ n: count() }).from(roleGrant).where(and(eq(roleGrant.staffId, id), eq(roleGrant.role, "ADMIN")));
    if (isAdmin.n > 0 && (await activeAdminCount(id)) === 0) throw new UserError("This is the last active admin. Make someone else admin first.");
  }
  await getDb().transaction(async (tx) => {
    await tx.update(staff).set({ active: makeActive }).where(eq(staff.id, id));
    await audit(tx, { actorStaffId: me.id, action: makeActive ? "ACTIVATE" : "DEACTIVATE", entity: "staff", entityId: id });
  });
  if (!makeActive) await revokeSessions(id);
  revalidatePath(`/staff/${id}`);
  return { ok: true, message: makeActive ? "Account re-activated." : "Account deactivated and signed out everywhere." };
});

export const resetStaffPassword = formAction(z.object({ id: int("Staff") }), async ({ id }, { me }) => {
  await ensureCanManage(me.actor, id);
  if (id === me.id) throw new UserError("Use “Change password” for your own account.");
  const temp = generateTempPassword();
  const passwordHash = await hashPassword(temp);
  await getDb().transaction(async (tx) => {
    await tx.update(staff).set({ passwordHash, mustChangePassword: true }).where(eq(staff.id, id));
    await audit(tx, { actorStaffId: me.id, action: "PASSWORD_RESET", entity: "staff", entityId: id });
  });
  await revokeSessions(id);
  return { ok: true, message: "Password reset. They are signed out everywhere.", reveal: { label: "Temporary password", value: temp } };
});

export const grantRole = formAction(
  z.object({ staffId: int("Staff"), role: oneOf(ROLES, "Role"), departmentId: optionalInt(), classGroupId: optionalInt() }),
  async ({ staffId, role, departmentId, classGroupId }, { me }) => {
    await ensureCanManage(me.actor, staffId);
    // Normalise scope fields to exactly what each role needs (the DB check enforces this too).
    const scope =
      role === "ADMIN" || role === "PRINCIPAL" || role === "OFFICE"
        ? { departmentId: null, classGroupId: null }
        : role === "HOD"
          ? { departmentId, classGroupId: null }
          : role === "CLASS_TEACHER"
            ? { departmentId: null, classGroupId }
            : { departmentId, classGroupId: null };
    if (role === "HOD" && !scope.departmentId) throw new UserError("Choose the department.", { departmentId: ["Required for HOD"] });
    if (role === "CLASS_TEACHER" && !scope.classGroupId) throw new UserError("Choose the class.", { classGroupId: ["Required for class teacher"] });
    if (role === "FACULTY" && !scope.departmentId && !isAdmin(me.actor)) throw new UserError("Choose the department.", { departmentId: ["Required"] });
    let classDept: number | null = null;
    if (scope.classGroupId) {
      const [c] = await getDb().select({ id: classGroup.id, departmentId: classGroup.departmentId }).from(classGroup).where(eq(classGroup.id, scope.classGroupId));
      if (!c) throw new UserError("Class not found.");
      classDept = c.departmentId;
    }
    ensure(canGrantRole(me.actor, { role, ...scope }, classDept), "As HOD you can give only the Faculty role in your department, or class teacher of one of its classes.");
    await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(roleGrant).values({ staffId, role, ...scope }).returning({ id: roleGrant.id });
      await audit(tx, { actorStaffId: me.id, action: "GRANT_ROLE", entity: "role_grant", entityId: row.id, after: { staffId, role, ...scope } });
    });
    revalidatePath(`/staff/${staffId}`);
    return { ok: true, message: "Role added." };
  },
);

export const revokeRole = formAction(z.object({ grantId: int("Role") }), async ({ grantId }, { me }) => {
  const db = getDb();
  const [g] = await db.select().from(roleGrant).where(eq(roleGrant.id, grantId));
  if (!g) throw new UserError("That role was already removed.");
  await ensureCanManage(me.actor, g.staffId);
  let classDept: number | null = null;
  if (g.classGroupId) {
    const [c] = await db.select({ departmentId: classGroup.departmentId }).from(classGroup).where(eq(classGroup.id, g.classGroupId));
    classDept = c?.departmentId ?? null;
  }
  ensure(canGrantRole(me.actor, g, classDept), "As HOD you can remove only Faculty or class teacher roles in your department.");
  if (g.role === "ADMIN" && (await activeAdminCount(g.staffId)) === 0) throw new UserError("This is the last admin. Make someone else admin first.");
  await db.transaction(async (tx) => {
    await tx.delete(roleGrant).where(eq(roleGrant.id, grantId));
    await audit(tx, { actorStaffId: me.id, action: "REVOKE_ROLE", entity: "role_grant", entityId: grantId, before: g });
  });
  revalidatePath(`/staff/${g.staffId}`);
  return { ok: true, message: "Role removed." };
});
