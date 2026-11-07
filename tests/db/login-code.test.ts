/**
 * Parent login codes against the seeded database: the real code reaches the provider, the database
 * only ever holds it masked, SMS fallback, test-mode skip, and the worker never resends them.
 * Rolled back, so demo data is never changed.
 */
import "dotenv/config";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, createPool, type DbTx } from "@/db/client";
import { MASKED_CODE, sendLoginCode } from "@/server/notify/login-code";
import { MockProvider, type OutgoingMessage, type Providers } from "@/server/notify/providers";
import { processOutbox } from "@/server/notify/worker";

const url = process.env.DATABASE_URL;
const pool = url ? createPool(url) : null;
afterAll(async () => pool?.end());

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

class Recording extends MockProvider {
  sent: OutgoingMessage[] = [];
  constructor(fail: Set<string> = new Set()) {
    super(fail);
  }
  override async send(m: OutgoingMessage) {
    this.sent.push(m);
    return super.send(m);
  }
}

describe("parent login code", () => {
  it("sends the real code, stores it masked, falls back to SMS, never resends", async (ctx) => {
    const contact = pool ? (await pool.query("SELECT id, student_id, phone FROM parent_contact ORDER BY id LIMIT 1").catch(() => null))?.rows[0] : null;
    if (!contact) ctx.skip();
    await inRollback(async (tx) => {
      const to = { contactId: contact.id, studentId: contact.student_id, phone: contact.phone, language: "BOTH" as const, whatsappOk: true };

      const p = new Recording();
      const providers: Providers = { whatsapp: p, sms: p, allowedNumbers: null, real: false };
      expect(await sendLoginCode(tx, providers, 900001, to, "042913")).toEqual({ sent: true, channel: "WHATSAPP" });
      expect(p.sent[0].text).toContain("042913");
      const stored = await tx.execute<{ text: string; data: string; status: string }>(sql`SELECT payload->>'text' AS text, payload::text AS data, status::text FROM notification WHERE dedupe_key = 'OTP:900001'`);
      expect(stored.rows[0].status).toBe("SENT");
      expect(stored.rows[0].data).not.toContain("042913");
      expect(stored.rows[0].text).toContain(MASKED_CODE);

      // Not on WhatsApp → SMS straight away.
      const f = new Recording(new Set([contact.phone]));
      expect(await sendLoginCode(tx, { whatsapp: f, sms: f, allowedNumbers: null, real: false }, 900002, to, "111222")).toEqual({ sent: true, channel: "SMS" });
      expect(f.sent.map((m) => m.channel)).toEqual(["WHATSAPP", "SMS"]);
      expect(f.sent[1].text).toContain("111222");

      // Test mode: a number outside the allowed list is skipped, nothing sent.
      const s = new Recording();
      expect((await sendLoginCode(tx, { whatsapp: s, sms: s, allowedNumbers: new Set(["+919999999999"]), real: false }, 900003, to, "333444")).sent).toBe(false);
      expect(s.sent).toHaveLength(0);

      // A code interrupted mid-send is failed, not queued again with the masked text.
      await tx.execute(sql`UPDATE notification SET status = 'SENDING', updated_at = now() - interval '1 hour' WHERE dedupe_key = 'OTP:900001'`);
      await tx.execute(sql`UPDATE notification SET status = 'SKIPPED' WHERE status = 'QUEUED'`);
      const w = new Recording();
      await processOutbox(tx, { whatsapp: w, sms: w, allowedNumbers: null, real: false });
      expect(w.sent).toHaveLength(0);
      const after = await tx.execute<{ status: string }>(sql`SELECT status::text FROM notification WHERE dedupe_key = 'OTP:900001'`);
      expect(after.rows[0].status).toBe("FAILED");
    });
  });
});
