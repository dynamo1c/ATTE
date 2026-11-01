/**
 * Scheduled job: queue due parent messages, then send what is queued.
 *   npm run notify:run              scan + send
 *   npm run notify:run -- --scan    only queue (nothing is sent)
 *   npm run notify:run -- --send    only send what is already queued
 * Schedule every 15 minutes (Windows Task Scheduler / cron). Safe to run any number of times.
 */
import "dotenv/config";
import { createDb, createPool } from "@/db/client";
import { providersFromEnv } from "./providers";
import { runScan } from "./scan";
import { processOutbox } from "./worker";

async function main() {
  const args = new Set(process.argv.slice(2));
  const scan = !args.has("--send");
  const send = !args.has("--scan");
  const pool = createPool();
  try {
    const db = createDb(pool);
    if (scan) {
      const r = await runScan(db);
      const queued = Object.entries(r.queued).map(([k, v]) => `${k}=${v}`).join(", ") || "nothing new";
      console.log(`Scan: ${r.students} students checked${r.week ? `, weekly summary for ${r.week.from}–${r.week.to}` : ""}. Queued: ${queued}.`);
    }
    if (send) {
      const providers = providersFromEnv();
      let total = { sent: 0, failed: 0, retrying: 0, skipped: 0, fallbacks: 0 };
      // Drain in batches so one run clears a weekly-summary burst.
      for (let i = 0; i < 50; i++) {
        const s = await processOutbox(db, providers, { limit: 200 });
        total = { sent: total.sent + s.sent, failed: total.failed + s.failed, retrying: total.retrying + s.retrying, skipped: total.skipped + s.skipped, fallbacks: total.fallbacks + s.fallbacks };
        if (s.sent + s.failed + s.retrying + s.skipped === 0) break;
      }
      console.log(`Send (${providers.whatsapp.name}): ${total.sent} sent, ${total.retrying} to retry, ${total.failed} failed, ${total.fallbacks} SMS fallbacks, ${total.skipped} skipped.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
