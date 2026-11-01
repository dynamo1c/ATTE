/**
 * Nightly job: create today's (and any missed) class sessions for every class.
 *   npm run sessions:generate
 * Schedule it daily at ~00:30 IST (Windows Task Scheduler / cron). Safe to run repeatedly.
 */
import "dotenv/config";
import { todayIn } from "@/lib/domain/dates";
import { generateSessions } from "@/server/generate-sessions";
import { createDb, createPool } from "./client";

async function main() {
  const pool = createPool();
  try {
    const until = process.env.GENERATE_UNTIL || todayIn();
    const created = await generateSessions(createDb(pool), { until });
    console.log(`Sessions generated up to ${until}: ${created} new.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
