/**
 * Deletes expired sign-in data. Run by the scheduled job (`npm run notify:run`).
 * Login attempts and used codes are kept a while as a security log.
 *
 * No "server-only" import: the scheduled job imports this.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

export async function purgeAuth(db: Pick<DbOrTx, "execute">, now = new Date()): Promise<number> {
  let n = 0;
  for (const q of [
    sql`DELETE FROM staff_session WHERE expires_at < ${now}::timestamptz`,
    sql`DELETE FROM parent_session WHERE expires_at < ${now}::timestamptz`,
    sql`DELETE FROM parent_otp WHERE created_at < ${now}::timestamptz - interval '30 days'`,
    sql`DELETE FROM login_attempt WHERE at < ${now}::timestamptz - interval '180 days'`,
  ]) {
    n += (await db.execute(q)).rowCount ?? 0;
  }
  return n;
}
