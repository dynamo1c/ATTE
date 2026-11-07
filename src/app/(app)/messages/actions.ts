"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { notification } from "@/db/schema";
import { canManageOutbox } from "@/lib/auth/permissions";
import { int, phone } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";
import { providersFor } from "@/server/notify/providers";
import { runScan } from "@/server/notify/scan";
import { processOutbox } from "@/server/notify/worker";

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
    providers = await providersFor(getDb());
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

/**
 * Setup check: one WhatsApp message to a number of your choice, through the outbox like every other
 * message, then the sender runs at once and the result is shown. Not tied to a student.
 */
export const sendTestMessage = formAction(z.object({ phone: phone("Mobile number") }), async ({ phone: to }, { me }) => {
  ensure(canManageOutbox(me.actor), "Only the admin can send test messages.");
  const db = getDb();
  let providers;
  try {
    providers = await providersFor(db);
  } catch (e) {
    throw new UserError(`Message provider is not set up: ${(e as Error).message}`);
  }
  if (providers.allowedNumbers && !providers.allowedNumbers.has(to)) {
    throw new UserError(`${to} is not in NOTIFY_ALLOWED_NUMBERS, so it would be skipped. Add it to .env and restart the app.`, { phone: ["Not in the allowed numbers"] });
  }
  const text = `MEI Polytechnic – test message\nWhatsApp from the attendance app is working (sent by ${me.name}).`;
  const [row] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(notification)
      .values({
        dedupeKey: `TEST:${randomUUID()}`,
        trigger: "BROADCAST",
        phone: to,
        channel: "WHATSAPP",
        template: "TEST",
        payload: { data: { kind: "BROADCAST", textEn: text, textKn: text }, text },
        scheduledFor: new Date(),
        createdBy: me.id,
      })
      .returning({ id: notification.id });
    await audit(tx, { actorStaffId: me.id, action: "TEST_MESSAGE", entity: "notification", entityId: inserted[0].id, after: { phone: to } });
    return inserted;
  });
  for (let i = 0; i < 20; i++) {
    const s = await processOutbox(db, providers, { limit: 250 });
    if (s.sent + s.failed + s.retrying + s.skipped === 0) break;
  }
  const [after] = await db.select({ status: notification.status, lastError: notification.lastError }).from(notification).where(eq(notification.id, row.id));
  revalidatePath("/messages");
  if (after.status === "SENT") return { ok: true, message: `Sent to ${to} via ${providers.whatsapp.name}.${providers.real ? " Check the phone." : " (Mock sender: nothing really left the server.)"}` };
  throw new UserError(`Not sent (${after.status.toLowerCase()}): ${after.lastError ?? "no reason given"}`);
});
