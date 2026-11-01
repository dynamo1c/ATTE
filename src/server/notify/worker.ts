/**
 * Sends queued messages (docs/PLAN.md §8.3).
 *
 * - Rows are claimed with FOR UPDATE SKIP LOCKED, so two runs at once never send the same row.
 * - Temporary errors retry with backoff (1, 4, 16, 64 min), then FAILED.
 * - "Not on WhatsApp" for a critical message → an SMS copy is queued (same transaction as the failure).
 * - A row stuck in SENDING (process killed mid-send) goes back to the queue after 10 minutes.
 *   That can, rarely, send one message twice; losing an alert would be worse.
 *
 * No "server-only" import: `npm run notify:run` uses this.
 */
import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { notification } from "@/db/schema";
import { CRITICAL, dedupeKey, MAX_ATTEMPTS, retryDelayMinutes, sendableAt, type Trigger } from "@/lib/notify/rules";
import { renderSms, type MessageData } from "@/lib/notify/templates";
import type { Providers } from "./providers";

const STUCK_MINUTES = 10;

export interface SendSummary {
  sent: number;
  failed: number;
  retrying: number;
  skipped: number;
  fallbacks: number;
}

export type Claimed = {
  id: number;
  dedupe_key: string;
  trigger: Trigger;
  student_id: number | null;
  parent_contact_id: number | null;
  phone: string;
  channel: "WHATSAPP" | "SMS";
  payload: { data: MessageData; text: string };
  attempts: number;
  language: "EN" | "KN" | "BOTH" | null;
};

export async function processOutbox(db: DbOrTx, providers: Providers, opts: { now?: Date; limit?: number } = {}): Promise<SendSummary> {
  const now = opts.now ?? new Date();
  const summary: SendSummary = { sent: 0, failed: 0, retrying: 0, skipped: 0, fallbacks: 0 };

  await db.execute(sql`
    UPDATE notification SET status = 'QUEUED', updated_at = now(), last_error = 'Interrupted while sending; retried'
    WHERE status = 'SENDING' AND updated_at < ${now}::timestamptz - make_interval(mins => ${STUCK_MINUTES})`);

  const { rows } = await db.execute<Claimed>(sql`
    WITH picked AS (
      SELECT id FROM notification
      WHERE status = 'QUEUED' AND scheduled_for <= ${now}::timestamptz
      ORDER BY scheduled_for, id
      LIMIT ${opts.limit ?? 200}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification n SET status = 'SENDING', attempts = n.attempts + 1, updated_at = now()
    FROM picked WHERE n.id = picked.id
    RETURNING n.id, n.dedupe_key, n.trigger::text AS trigger, n.student_id, n.parent_contact_id, n.phone, n.channel::text AS channel, n.payload, n.attempts,
      (SELECT pc.language::text FROM parent_contact pc WHERE pc.id = n.parent_contact_id) AS language`);

  for (const m of rows) {
    if (providers.allowedNumbers && !providers.allowedNumbers.has(m.phone)) {
      await db.update(notification).set({ status: "SKIPPED", lastError: "Not in NOTIFY_ALLOWED_NUMBERS (test mode)", updatedAt: new Date() }).where(eq(notification.id, m.id));
      summary.skipped++;
      continue;
    }
    const provider = m.channel === "WHATSAPP" ? providers.whatsapp : providers.sms;
    let res: Awaited<ReturnType<typeof provider.send>>;
    try {
      res = await provider.send({ id: m.id, phone: m.phone, channel: m.channel, text: m.payload.text });
    } catch (e) {
      res = { ok: false, permanent: false, error: `Provider crashed: ${(e as Error).message}` };
    }

    if (res.ok) {
      await db
        .update(notification)
        .set({ status: "SENT", provider: provider.name, providerMessageId: res.providerMessageId, sentAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(notification.id, m.id));
      summary.sent++;
      continue;
    }

    if (!res.permanent && m.attempts < MAX_ATTEMPTS) {
      const retryAt = new Date(now.getTime() + retryDelayMinutes(m.attempts) * 60_000);
      await db.update(notification).set({ status: "QUEUED", scheduledFor: retryAt, provider: provider.name, lastError: res.error, updatedAt: new Date() }).where(eq(notification.id, m.id));
      summary.retrying++;
      continue;
    }

    const fallback = res.notOnWhatsApp === true && m.channel === "WHATSAPP" && CRITICAL.has(m.trigger);
    await db.transaction(async (tx) => {
      await tx.update(notification).set({ status: "FAILED", provider: provider.name, lastError: res.error, updatedAt: new Date() }).where(eq(notification.id, m.id));
      if (fallback) summary.fallbacks += await queueSmsFallback(tx, m);
    });
    summary.failed++;
  }
  return summary;
}

/** Queue an SMS copy of a WhatsApp message that could not be delivered (critical messages only). Returns 1 if added. */
export async function queueSmsFallback(
  tx: Pick<DbOrTx, "insert">,
  m: Pick<Claimed, "id" | "dedupe_key" | "trigger" | "student_id" | "parent_contact_id" | "phone" | "payload" | "language">,
): Promise<number> {
  const added = await tx
    .insert(notification)
    .values({
      dedupeKey: dedupeKey.smsFallback(m.dedupe_key),
      trigger: m.trigger,
      studentId: m.student_id,
      parentContactId: m.parent_contact_id,
      phone: m.phone,
      channel: "SMS",
      template: m.payload.data.kind,
      payload: { data: m.payload.data, text: renderSms(m.payload.data, m.language ?? "BOTH") },
      scheduledFor: sendableAt(new Date(), m.trigger),
      fallbackOf: m.id,
    })
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning({ id: notification.id });
  return added.length;
}
