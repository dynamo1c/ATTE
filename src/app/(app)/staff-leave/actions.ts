"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { staffLeave } from "@/db/schema";
import { canDecideStaffLeave, leaveDecidedBy } from "@/lib/auth/permissions";
import { todayIn } from "@/lib/domain/dates";
import { canCancelStaffLeave, checkStaffLeave } from "@/lib/domain/staff-leave";
import { date, int, oneOf, optionalText, text } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";
import { getApplicant } from "@/server/staff-leave-data";

export const applyStaffLeave = formAction(
  z.object({
    type: oneOf(["CASUAL", "MEDICAL", "EARNED", "ON_DUTY", "OTHER"], "Leave type"),
    fromDate: date("First day"),
    toDate: date("Last day"),
    part: oneOf(["FULL", "FN", "AN"], "Full or half day"),
    reason: text("Reason", 300),
  }),
  async (input, { me }) => {
    const problems = checkStaffLeave(input, todayIn());
    if (Object.keys(problems).length) {
      throw new UserError(Object.values(problems)[0], Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, [v]])));
    }
    // HODs, office, principal and admin need no approval: recorded as approved with no decider.
    const recorded = leaveDecidedBy(await getApplicant(me.id)) === "NONE";
    // Overlap with another open leave is refused by the database (staff_leave_no_overlap).
    await getDb().transaction(async (tx) => {
      const [row] = await tx
        .insert(staffLeave)
        .values({ staffId: me.id, ...input, status: recorded ? "APPROVED" : "PENDING" })
        .returning();
      await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "staff_leave", entityId: row.id, after: row });
    });
    revalidatePath("/staff-leave");
    revalidatePath("/");
    return { ok: true, message: recorded ? "Recorded. Your classes on those days are listed for a substitute." : "Applied. You'll see the decision here." };
  },
);

export const decideStaffLeave = formAction(
  z.object({ id: int("Leave"), decision: oneOf(["APPROVED", "REJECTED"], "Decision"), note: optionalText(300) }),
  async ({ id, decision, note }, { me }) => {
    const db = getDb();
    const [row] = await db.select().from(staffLeave).where(eq(staffLeave.id, id));
    if (!row) throw new UserError("This leave no longer exists.");
    ensure(canDecideStaffLeave(me.actor, await getApplicant(row.staffId)), "You can't decide this person's leave.");
    if (decision === "REJECTED" && !note) throw new UserError("Say why it is rejected.", { note: ["Required when rejecting"] });
    await db.transaction(async (tx) => {
      const done = await tx
        .update(staffLeave)
        .set({ status: decision, decidedBy: me.id, decidedAt: new Date(), decisionNote: note })
        .where(and(eq(staffLeave.id, id), eq(staffLeave.status, "PENDING")))
        .returning({ id: staffLeave.id });
      if (!done.length) throw new UserError("Already decided or cancelled.");
      await audit(tx, { actorStaffId: me.id, action: decision === "APPROVED" ? "APPROVE" : "REJECT", entity: "staff_leave", entityId: id, before: row, reason: note });
    });
    revalidatePath("/staff-leave");
    revalidatePath("/");
    return { ok: true, message: decision === "APPROVED" ? "Approved. Their classes on those days are listed for a substitute." : "Rejected." };
  },
);

export const cancelStaffLeave = formAction(z.object({ id: int("Leave") }), async ({ id }, { me }) => {
  const db = getDb();
  const [row] = await db.select().from(staffLeave).where(eq(staffLeave.id, id));
  if (!row) throw new UserError("This leave no longer exists.");
  ensure(row.staffId === me.id, "Only the person who applied can cancel it.");
  if (!canCancelStaffLeave(row, todayIn())) throw new UserError("Leave that has started or was decided against can't be cancelled.");
  await db.transaction(async (tx) => {
    const done = await tx
      .update(staffLeave)
      .set({ status: "CANCELLED" })
      .where(and(eq(staffLeave.id, id), inArray(staffLeave.status, ["PENDING", "APPROVED"])))
      .returning({ id: staffLeave.id });
    if (!done.length) throw new UserError("Already cancelled.");
    await audit(tx, { actorStaffId: me.id, action: "CANCEL", entity: "staff_leave", entityId: id, before: row });
  });
  revalidatePath("/staff-leave");
  revalidatePath("/");
  return { ok: true, message: "Cancelled." };
});
