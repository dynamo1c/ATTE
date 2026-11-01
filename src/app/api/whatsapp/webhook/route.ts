/**
 * WhatsApp Cloud API webhook: Meta calls this with delivery statuses (sent → delivered → read / failed).
 * Configure in the Meta app: callback URL = <PUBLIC_BASE_URL>/api/whatsapp/webhook,
 * verify token = WHATSAPP_VERIFY_TOKEN; requests are checked against WHATSAPP_APP_SECRET.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { CRITICAL, type Trigger } from "@/lib/notify/rules";
import { parseStatuses, shouldApply, verifySignature } from "@/lib/notify/webhook";
import { queueSmsFallback, type Claimed } from "@/server/notify/worker";

const NOT_ON_WHATSAPP = 131026;

/** Meta's one-time subscription check. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response("Too large", { status: 413 });
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)) return new Response("Bad signature", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const db = getDb();
  for (const u of parseStatuses(body)) {
    await db.transaction(async (tx) => {
      const { rows } = await tx.execute<Claimed & { status: string; channel: string }>(sql`
        SELECT n.id, n.dedupe_key, n.trigger::text AS trigger, n.student_id, n.parent_contact_id, n.phone, n.channel::text AS channel, n.payload, n.attempts, n.status::text AS status,
               (SELECT pc.language::text FROM parent_contact pc WHERE pc.id = n.parent_contact_id) AS language
        FROM notification n WHERE n.provider_message_id = ${u.providerMessageId} FOR UPDATE`);
      const m = rows[0];
      if (!m || !shouldApply(m.status, u.status)) return;
      await tx.execute(sql`
        UPDATE notification SET status = ${u.status}, updated_at = now(), last_error = ${u.status === "FAILED" ? u.error : null}
        WHERE id = ${m.id}`);
      if (u.status === "FAILED" && u.errorCode === NOT_ON_WHATSAPP && m.channel === "WHATSAPP" && CRITICAL.has(m.trigger as Trigger)) await queueSmsFallback(tx, m);
    });
  }
  // Always 200 once verified: Meta retries anything else for days.
  return new Response("OK", { status: 200 });
}
