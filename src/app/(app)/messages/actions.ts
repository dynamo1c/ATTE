"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { notification } from "@/db/schema";
import { canBroadcast, canManageOutbox } from "@/lib/auth/permissions";
import { dedupeKey } from "@/lib/notify/rules";
import { int, text } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";
import { enqueueForStudents, type Draft } from "@/server/notify/outbox";
import { providersFromEnv } from "@/server/notify/providers";
import { runScan } from "@/server/notify/scan";
import { processOutbox } from "@/server/notify/worker";
import { getCurrentTerm } from "@/server/queries";

export const retryMessage = formAction(z.object({ id: int("Message") }), async ({ id }, { me }) => {
  ensure(canManageOutbox(me.actor), "Only the admin can retry messages.");
  await getDb().transaction(async (tx) => {
    const done = await tx
      .update(notification)
      .set({ status: "QUEUED", attempts: 0, scheduledFor: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(notification.id, id), inArray(notification.status, ["FAILED", "SKIPPED"]), ne(notification.trigger, "LOGIN_OTP")))
      .returning({ id: notification.id });
    if (!done.length) throw new UserError("Only failed or skipped messages can be retried. Login codes can't be resent: the parent asks for a new one.");
    await audit(tx, { actorStaffId: me.id, action: "RETRY", entity: "notification", entityId: id });
  });
  revalidatePath("/messages");
  return { ok: true, message: "Queued again. It goes out with the next send run." };
});

export const cancelMessage = formAction(z.object({ id: int("Message") }), async ({ id }, { me }) => {
  ensure(canManageOutbox(me.actor), "Only the admin can cancel messages.");
  await getDb().transaction(async (tx) => {
    const done = await tx
      .update(notification)
      .set({ status: "SKIPPED", lastError: `Cancelled by ${me.name}`, updatedAt: new Date() })
      .where(and(eq(notification.id, id), eq(notification.status, "QUEUED")))
      .returning({ id: notification.id });
    if (!done.length) throw new UserError("This message is no longer waiting (already sent or cancelled).");
    await audit(tx, { actorStaffId: me.id, action: "CANCEL", entity: "notification", entityId: id });
  });
  revalidatePath("/messages");
  return { ok: true, message: "Cancelled." };
});

/** What the scheduled job does, on demand (for the demo, or after fixing a provider problem). */
export const runNow = formAction(z.object({}), async (_input, { me }) => {
  ensure(canManageOutbox(me.actor), "Only the admin can run the sender.");
  let providers;
  try {
    providers = providersFromEnv();
  } catch (e) {
    throw new UserError(`Message provider is not set up: ${(e as Error).message}`);
  }
  const db = getDb();
  const scan = await runScan(db);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < 20; i++) {
    const s = await processOutbox(db, providers, { limit: 250 });
    sent += s.sent;
    failed += s.failed;
    skipped += s.skipped;
    if (s.sent + s.failed + s.retrying + s.skipped === 0) break;
  }
  const queued = Object.values(scan.queued).reduce((a, b) => a + (b ?? 0), 0);
  revalidatePath("/messages");
  return { ok: true, message: `Checked ${scan.students} students: ${queued} new message${queued === 1 ? "" : "s"}. Sent ${sent}${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped (test mode)` : ""} via ${providers.whatsapp.name}.` };
});

const AUDIENCE = /^(college|dept:\d{1,9}|class:\d{1,9})$/;

export const sendBroadcast = formAction(
  z.object({
    audience: z.string().regex(AUDIENCE, "Choose who receives it"),
    textEn: text("English text", 600),
    textKn: text("Kannada text", 600),
  }),
  async ({ audience, textEn, textKn }, { me }) => {
    ensure(canBroadcast(me.actor), "Only the principal or admin can send notices to parents.");
    const term = await getCurrentTerm();
    if (!term) throw new UserError("No term is set up.");
    const [kind, idRaw] = audience.split(":");
    const filter = kind === "dept" ? sql`AND cg.department_id = ${Number(idRaw)}` : kind === "class" ? sql`AND cg.id = ${Number(idRaw)}` : sql``;
    const db = getDb();
    const { rows } = await db.execute<{ id: number }>(sql`
      SELECT s.id FROM class_membership m
      JOIN student s ON s.id = m.student_id
      JOIN class_group cg ON cg.id = m.class_group_id
      WHERE m.term_id = ${term.id} AND m.left_on IS NULL AND s.status IN ('ACTIVE', 'DETAINED') ${filter}`);
    if (!rows.length) throw new UserError("No current students in that group.");
    const broadcastId = randomUUID();
    const drafts: Draft[] = rows.map((r) => ({
      trigger: "BROADCAST",
      studentId: r.id,
      data: { kind: "BROADCAST", textEn, textKn },
      key: (cid) => dedupeKey.broadcast(broadcastId, cid),
    }));
    const queued = await db.transaction(async (tx) => {
      const n = await enqueueForStudents(tx, drafts, { createdBy: me.id });
      await audit(tx, { actorStaffId: me.id, action: "BROADCAST", entity: "notification", entityId: broadcastId, after: { audience, textEn, textKn, students: rows.length, messages: n } });
      return n;
    });
    revalidatePath("/messages");
    return { ok: true, message: `Notice queued: ${queued} message${queued === 1 ? "" : "s"} to parents of ${rows.length} students. Numbers without consent are left out.` };
  },
);
