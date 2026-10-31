import "server-only";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { classGroup, courseOffering, roleGrant, staff, teachingAssignment } from "@/db/schema";
import type { Actor } from "@/lib/auth/permissions";
import { readSessionStaffId } from "./session";

export interface CurrentStaff {
  id: number;
  name: string;
  phone: string;
  designation: string | null;
  departmentId: number | null;
  mustChangePassword: boolean;
  actor: Actor;
}

/** The logged-in staff member for this request (memoised per request). */
export const getCurrentStaff = cache(async (): Promise<CurrentStaff | null> => {
  const staffId = await readSessionStaffId();
  if (staffId === null) return null;
  const db = getDb();
  const [me] = await db.select().from(staff).where(and(eq(staff.id, staffId), eq(staff.active, true))).limit(1);
  if (!me) return null;
  const [grants, teaching] = await Promise.all([
    db.select({ role: roleGrant.role, departmentId: roleGrant.departmentId, classGroupId: roleGrant.classGroupId }).from(roleGrant).where(eq(roleGrant.staffId, me.id)),
    db
      .selectDistinct({ classGroupId: classGroup.id })
      .from(teachingAssignment)
      .innerJoin(courseOffering, eq(courseOffering.id, teachingAssignment.offeringId))
      .innerJoin(classGroup, eq(classGroup.id, courseOffering.classGroupId))
      .where(eq(teachingAssignment.staffId, me.id)),
  ]);
  return {
    id: me.id,
    name: me.name,
    phone: me.phone,
    designation: me.designation,
    departmentId: me.departmentId,
    mustChangePassword: me.mustChangePassword,
    actor: { staffId: me.id, grants, teachingClassIds: teaching.map((t) => t.classGroupId) },
  };
});

/** Use at the top of every protected page and action. */
export async function requireStaff(opts: { allowPasswordChange?: boolean } = {}): Promise<CurrentStaff> {
  const me = await getCurrentStaff();
  if (!me) redirect("/login");
  if (me.mustChangePassword && !opts.allowPasswordChange) redirect("/change-password");
  return me;
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** For actions: throw unless allowed. */
export function ensure(allowed: boolean, message?: string): asserts allowed {
  if (!allowed) throw new ForbiddenError(message);
}
