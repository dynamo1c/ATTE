/**
 * WhatsApp Cloud API webhook helpers: signature check and delivery-status parsing. Pure, unit-tested.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta signs the raw body with the app secret: header "X-Hub-Signature-256: sha256=<hex>". */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type DeliveryStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface StatusUpdate {
  providerMessageId: string;
  status: DeliveryStatus;
  errorCode: number | null;
  error: string | null;
}

const MAP: Record<string, DeliveryStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/** Pull status updates out of a webhook body; anything unexpected is ignored, never thrown. */
export function parseStatuses(body: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const entries = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown } })?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses) {
        const id = (s as { id?: unknown })?.id;
        const status = MAP[String((s as { status?: unknown })?.status)];
        if (typeof id !== "string" || !id || !status) continue;
        const err = (s as { errors?: { code?: unknown; title?: unknown; message?: unknown }[] }).errors?.[0];
        out.push({
          providerMessageId: id,
          status,
          errorCode: typeof err?.code === "number" ? err.code : null,
          error: err ? String(err.message ?? err.title ?? "Delivery failed").slice(0, 500) : null,
        });
      }
    }
  }
  return out;
}

const ORDER: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };

/**
 * Status updates can arrive late or out of order. Only move forward (sent → delivered → read);
 * "failed" applies only to a message not yet delivered.
 */
export function shouldApply(current: string, incoming: DeliveryStatus): boolean {
  if (!(current in ORDER)) return false; // QUEUED / SENDING / FAILED / SKIPPED: not ours to change
  if (incoming === "FAILED") return current === "SENT";
  return ORDER[incoming] > ORDER[current];
}
