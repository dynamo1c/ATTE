import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/**
 * For uptime monitors: 200 when the app can reach the database, 503 otherwise.
 * Public, so it says nothing beyond up/down and the message backlog size.
 */
export async function GET() {
  const started = Date.now();
  try {
    const { rows } = await getDb().execute<{ backlog: number; stuck: number }>(sql`
      SELECT count(*) FILTER (WHERE status = 'QUEUED' AND scheduled_for < now() - interval '30 minutes')::int AS backlog,
             count(*) FILTER (WHERE status = 'SENDING' AND updated_at < now() - interval '15 minutes')::int AS stuck
      FROM notification WHERE status IN ('QUEUED', 'SENDING')`);
    // Overdue messages mean the scheduled job (npm run notify:run) has stopped: worth an alert.
    const jobOk = rows[0].backlog === 0 && rows[0].stuck === 0;
    return Response.json({ ok: true, db: "up", messagesJob: jobOk ? "ok" : "behind", ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("Health check failed", e);
    return Response.json({ ok: false, db: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
