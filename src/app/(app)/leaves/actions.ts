"use server";

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { leaveNotice, student } from "@/db/schema";
import { canApproveForClass, canRecordLeave } from "@/lib/auth/permissions";
import { addDays } from "@/lib/domain/dates";
import { normalizeRegNo } from "@/lib/domain/regNo";
import { date, int, oneOf, optionalText, text } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";
import { getCurrentTerm } from "@/server/queries";
import { getStudent } from "@/server/student-data";

const MAX_DAYS = 60;

async function studentClass(studentId: number) {
  const term = await getCurrentTerm();
  const s = await getStudent(studentId, term?.id ?? null);
  if (!s?.membership) throw new UserError("This student is not in a class this term.");
  return { s, classRef: { id: s.membership.classGroupId, departmentId: s.membership.classDepartmentId } };
}

export const createLeave = formAction(
  z.object({
    regNo: text("Register number", 20).transform(normalizeRegNo),
    type: oneOf(["MEDICAL", "ON_DUTY", "PERSONAL", "OTHER"], "Type"),
    fromDate: date("From"),
    toDate: date("To"),
    reason: text("Reason", 300),
  }),
  async (input, { me }) => {
    if (input.toDate < input.fromDate) throw new UserError("“To” must be on or after “From”.", { toDate: ["Before the start date"] });
    if (addDays(input.fromDate, MAX_DAYS) < input.toDate) throw new UserError(`A notice can cover at most ${MAX_DAYS} days.`, { toDate: ["Too long"] });
    const db = getDb();
    const [st] = await db.select({ id: student.id }).from(student).where(eq(student.regNo, input.regNo));
    if (!st) throw new UserError("No student with that register number.", { regNo: ["Not found"] });
    const { s, classRef } = await studentClass(st.id);
    ensure(canRecordLeave(me.actor, classRef), "You can only record leave for students of your own class or department.");

    const overlapping = await db
      .select({ id: leaveNotice.id })
      .from(leaveNotice)
      .where(and(eq(leaveNotice.studentId, s.id), inArray(leaveNotice.status, ["PENDING", "APPROVED"]), lte(leaveNotice.fromDate, input.toDate), gte(leaveNotice.toDate, input.fromDate)));
    if (overlapping.length) throw new UserError(`${s.name} already has leave covering some of these days. Edit or remove that one first.`);

    const autoApprove = canApproveForClass(me.actor, classRef);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(leaveNotice)
        .values({
          studentId: s.id,
          type: input.type,
          fromDate: input.fromDate,
          toDate: input.toDate,
          reason: input.reason,
          createdBy: me.id,
          status: autoApprove ? "APPROVED" : "PENDING",
          approvedBy: autoApprove ? me.id : null,
          approvedAt: autoApprove ? new Date() : null,
        })
        .returning();
      await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "leave_notice", entityId: row.id, after: row });
    });
    revalidatePath("/leaves");
    return { ok: true, message: autoApprove ? `Recorded and approved for ${s.name}.` : `Recorded for ${s.name}. Waiting for HOD approval.` };
  },
);

export const decideLeave = formAction(z.object({ id: int("Notice"), decision: oneOf(["APPROVED", "REJECTED"], "Decision") }), async ({ id, decision }, { me }) => {
  const db = getDb();
  const [row] = await db.select().from(leaveNotice).where(eq(leaveNotice.id, id));
  if (!row || row.status !== "PENDING") throw new UserError("Already decided.");
  const { classRef } = await studentClass(row.studentId);
  ensure(canApproveForClass(me.actor, classRef), "Only the HOD or admin can approve leave.");
  await db.transaction(async (tx) => {
    const done = await tx
      .update(leaveNotice)
      .set({ status: decision, approvedBy: me.id, approvedAt: new Date() })
      .where(and(eq(leaveNotice.id, id), eq(leaveNotice.status, "PENDING")))
      .returning({ id: leaveNotice.id });
    if (!done.length) throw new UserError("Already decided.");
    await audit(tx, { actorStaffId: me.id, action: decision === "APPROVED" ? "APPROVE" : "REJECT", entity: "leave_notice", entityId: id, before: row });
  });
  revalidatePath("/leaves");
  return { ok: true, message: decision === "APPROVED" ? "Approved. Attendance % now applies the leave rule." : "Rejected." };
});

export const withdrawLeave = formAction(z.object({ id: int("Notice"), note: optionalText(200) }), async ({ id }, { me }) => {
  const db = getDb();
  const [row] = await db.select().from(leaveNotice).where(eq(leaveNotice.id, id));
  if (!row) throw new UserError("Already removed.");
  const { classRef } = await studentClass(row.studentId);
  const approver = canApproveForClass(me.actor, classRef);
  ensure(approver || (row.createdBy === me.id && row.status === "PENDING"), "Only the HOD/admin can remove an approved notice.");
  await db.transaction(async (tx) => {
    await tx.delete(leaveNotice).where(eq(leaveNotice.id, id));
    await audit(tx, { actorStaffId: me.id, action: "DELETE", entity: "leave_notice", entityId: id, before: row });
  });
  revalidatePath("/leaves");
  return { ok: true, message: "Removed." };
});
