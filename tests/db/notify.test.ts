/**
 * Parent messages end to end against the seeded database: scan → outbox → mock send → SMS fallback.
 * Needs `npm run db:reset` (seed up to at least 2026-10-31). Runs in one transaction that is rolled
 * back, so demo data is never changed.
 */
import "dotenv/config";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, createPool, type DbTx } from "@/db/client";
import { istInstant } from "@/lib/notify/rules";
import { runScan } from "@/server/notify/scan";
import { MockProvider } from "@/server/notify/providers";
import { processOutbox } from "@/server/notify/worker";

const url = process.env.DATABASE_URL;
const pool = url ? createPool(url) : null;
afterAll(async () => pool?.end());

async function seeded() {
  if (!pool) return false;
  const r = await pool.query("SELECT max(date)::text AS d FROM class_session WHERE status = 'HELD'").catch(() => null);
  return Boolean(r?.rows[0]?.d && r.rows[0].d >= "2026-10-31");
}

/** Run `fn` in a transaction and always roll it back. */
async function inRollback(fn: (tx: DbTx) => Promise<void>) {
  const db = createDb(pool!);
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
  }
}

const count = async (tx: DbTx, q: ReturnType<typeof sql>) => Number((await tx.execute<{ n: number }>(q)).rows[0].n);

describe("parent notifications", () => {
  it("scans, dedupes, respects consent, sends and falls back to SMS", async (ctx) => {
    if (!(await seeded())) ctx.skip();
    await inRollback(async (tx) => {
      await tx.execute(sql`DELETE FROM notification`);
      await tx.execute(sql`DELETE FROM student_alert_state`);
      const sundayEvening = istInstant("2026-11-01", 18, 0);

      const first = await runScan(tx, { now: sundayEvening });
      expect(first.week).toEqual({ from: "2026-10-26", to: "2026-10-31" });
      expect(first.queued.WEEKLY_SUMMARY ?? 0).toBeGreaterThan(1000);
      expect(first.queued.ATTENDANCE_SHORTAGE ?? 0).toBeGreaterThan(0);

      // DPDP: nothing queued for a number without consent.
      expect(await count(tx, sql`SELECT count(*)::int AS n FROM notification n JOIN parent_contact pc ON pc.id = n.parent_contact_id WHERE pc.consent_at IS NULL`)).toBe(0);
      // Former students get nothing.
      expect(await count(tx, sql`SELECT count(*)::int AS n FROM notification n JOIN student s ON s.id = n.student_id WHERE s.status = 'DROPPED'`)).toBe(0);
      // Bilingual parents get both languages in one WhatsApp message.
      const both = await tx.execute<{ text: string }>(sql`
        SELECT n.payload->>'text' AS text FROM notification n JOIN parent_contact pc ON pc.id = n.parent_contact_id
        WHERE pc.language = 'BOTH' AND n.channel = 'WHATSAPP' AND n.trigger = 'WEEKLY_SUMMARY' LIMIT 1`);
      expect(both.rows[0].text).toContain("Weekly attendance");
      expect(both.rows[0].text).toContain("ವಾರದ ಹಾಜರಾತಿ");

      // Running again adds nothing.
      const second = await runScan(tx, { now: sundayEvening });
      expect(Object.values(second.queued).reduce((a, b) => a + (b ?? 0), 0)).toBe(0);

      // Send with the mock; one parent of a shortage alert is "not on WhatsApp" → SMS copy.
      const target = await tx.execute<{ phone: string }>(sql`SELECT phone FROM notification WHERE trigger = 'ATTENDANCE_SHORTAGE' AND channel = 'WHATSAPP' LIMIT 1`);
      const mock = new MockProvider(new Set([target.rows[0].phone]));
      const providers = { whatsapp: mock, sms: mock, allowedNumbers: null };
      const sent = await processOutbox(tx, providers, { now: sundayEvening, limit: 100_000 });
      expect(sent.sent).toBeGreaterThan(1000);
      expect(sent.fallbacks).toBeGreaterThanOrEqual(1);
      const again = await processOutbox(tx, providers, { now: sundayEvening, limit: 100_000 });
      expect(again.sent).toBeGreaterThanOrEqual(1); // the SMS copies
      expect(await count(tx, sql`SELECT count(*)::int AS n FROM notification WHERE status IN ('QUEUED', 'SENDING')`)).toBe(0);
      expect(await count(tx, sql`SELECT count(*)::int AS n FROM notification WHERE channel = 'SMS' AND fallback_of IS NOT NULL AND status = 'SENT'`)).toBeGreaterThanOrEqual(1);

      // Test mode: numbers outside the allow-list are skipped, not sent.
      await tx.execute(sql`UPDATE notification SET status = 'QUEUED' WHERE id = (SELECT min(id) FROM notification)`);
      const limited = await processOutbox(tx, { ...providers, allowedNumbers: new Set(["+919999999999"]) }, { now: sundayEvening });
      expect(limited).toMatchObject({ sent: 0, skipped: 1 });
    });
  }, 120_000);

  it("quiet hours: a scan at night schedules for 8 am", async (ctx) => {
    if (!(await seeded())) ctx.skip();
    await inRollback(async (tx) => {
      await tx.execute(sql`DELETE FROM notification`);
      await tx.execute(sql`DELETE FROM student_alert_state`);
      const night = istInstant("2026-11-01", 22, 30);
      await runScan(tx, { now: night });
      const early = await count(tx, sql`SELECT count(*)::int AS n FROM notification WHERE scheduled_for < ${istInstant("2026-11-02", 8).toISOString()}::timestamptz`);
      expect(early).toBe(0);
      const sent = await processOutbox(tx, { whatsapp: new MockProvider(), sms: new MockProvider(), allowedNumbers: null }, { now: night });
      expect(sent.sent).toBe(0);
    });
  }, 120_000);
});
