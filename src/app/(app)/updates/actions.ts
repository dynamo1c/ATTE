"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { classGroup, collegeUpdate, department } from "@/db/schema";
import { canPublishUpdates, canPublishUpdateTo } from "@/lib/auth/permissions";
import { dedupeKey } from "@/lib/notify/rules";
import { checkbox, int, optionalText, text } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";
import { enqueueForStudents, type Draft } from "@/server/notify/outbox";
import { getCurrentTerm } from "@/server/queries";
import { audienceStudentIds, AUDIENCE, parseAudience, updateMessageText } from "@/server/updates";

export const publishUpdate = formAction(
  z.object({
    audience: z.string().regex(AUDIENCE, "Choose who it is for"),
    title: text("Title", 120),
    bodyEn: text("English text", 900),
    bodyKn: optionalText(900),
    sendWhatsApp: checkbox(),
  }),
  async ({ audience, title, bodyEn, bodyKn, sendWhatsApp }, { me }) => {
    ensure(canPublishUpdates(me.actor), "Only the office, admin or an HOD can publish updates.");
    const term = await getCurrentTerm();
    if (!term) throw new UserError("No term is set up.");
    const scope = parseAudience(audience);
    const db = getDb();
    // The audience's department: null for the whole college.
    let audienceDept: number | null = null;
    if (scope.departmentId) {
      const [d] = await db.select({ id: department.id }).from(department).where(eq(department.id, scope.departmentId));
      if (!d) throw new UserError("That department no longer exists.");
      audienceDept = d.id;
    }
    if (scope.classGroupId) {
      const [c] = await db
        .select({ id: classGroup.id, departmentId: classGroup.departmentId })
        .from(classGroup)
        .where(and(eq(classGroup.id, scope.classGroupId), eq(classGroup.termId, term.id)));
      if (!c) throw new UserError("That class is not in the current term.");
      audienceDept = c.departmentId;
    }
    ensure(canPublishUpdateTo(me.actor, audienceDept), "An HOD can publish updates only for their own department or its classes.");
    const studentIds = sendWhatsApp ? await audienceStudentIds(db, term.id, scope) : [];

    const { id, queued } = await db.transaction(async (tx) => {
      const [row] = await tx.insert(collegeUpdate).values({ title, bodyEn, bodyKn, ...scope, sendWhatsApp, publishedBy: me.id }).returning();
      let n = 0;
      if (studentIds.length) {
        const drafts: Draft[] = studentIds.map((studentId) => ({
          trigger: "BROADCAST",
          studentId,
          data: { kind: "BROADCAST", textEn: updateMessageText(title, bodyEn), textKn: updateMessageText(title, bodyKn ?? bodyEn) },
          key: (contactId) => dedupeKey.update(row.id, contactId),
        }));
        n = await enqueueForStudents(tx, drafts, { createdBy: me.id });
        await tx.update(collegeUpdate).set({ messages: n }).where(eq(collegeUpdate.id, row.id));
      }
      await audit(tx, { actorStaffId: me.id, action: "PUBLISH", entity: "college_update", entityId: row.id, after: { ...row, messages: n } });
      return { id: row.id, queued: n };
    });
    revalidatePath("/updates");
    revalidatePath("/messages");
    return {
      ok: true,
      message: sendWhatsApp
        ? `Published (#${id}). ${queued} WhatsApp message${queued === 1 ? "" : "s"} queued for parents with consent; they go out in the next send run (8 am – 9 pm).`
        : `Published (#${id}) on the parent portal. No WhatsApp messages.`,
    };
  },
);

export const withdrawUpdate = formAction(z.object({ id: int("Update") }), async ({ id }, { me }) => {
  ensure(canPublishUpdates(me.actor), "Only the office, admin or an HOD can withdraw updates.");
  const db = getDb();
  const [target] = await db
    .select({ departmentId: collegeUpdate.departmentId, classDept: classGroup.departmentId })
    .from(collegeUpdate)
    .leftJoin(classGroup, eq(classGroup.id, collegeUpdate.classGroupId))
    .where(eq(collegeUpdate.id, id));
  if (!target) throw new UserError("This update no longer exists.");
  ensure(canPublishUpdateTo(me.actor, target.departmentId ?? target.classDept ?? null), "An HOD can withdraw only their own department's updates.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(collegeUpdate)
      .set({ withdrawnAt: new Date(), withdrawnBy: me.id })
      .where(and(eq(collegeUpdate.id, id), isNull(collegeUpdate.withdrawnAt)))
      .returning();
    if (!row) throw new UserError("Already withdrawn.");
    await audit(tx, { actorStaffId: me.id, action: "WITHDRAW", entity: "college_update", entityId: id, before: { title: row.title } });
  });
  revalidatePath("/updates");
  return { ok: true, message: "Withdrawn from the parent portal. Messages already sent can't be recalled." };
});
