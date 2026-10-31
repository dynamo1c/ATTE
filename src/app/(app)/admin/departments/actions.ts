"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { department } from "@/db/schema";
import { isAdmin } from "@/lib/auth/permissions";
import { checkbox, int, text } from "@/lib/forms";
import { formAction } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";

export const saveDepartment = formAction(z.object({ id: int("Department"), name: text("Name", 120), active: checkbox() }), async ({ id, ...values }, { me }) => {
  ensure(isAdmin(me.actor));
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(department).where(eq(department.id, id));
    await tx.update(department).set(values).where(eq(department.id, id));
    await audit(tx, { actorStaffId: me.id, action: "UPDATE", entity: "department", entityId: id, before, after: values });
  });
  revalidatePath("/admin/departments");
  return { ok: true, message: "Saved." };
});
